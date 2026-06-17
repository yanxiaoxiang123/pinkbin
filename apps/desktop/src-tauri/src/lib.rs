use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime};

use include_dir::{include_dir, Dir};
use pinkbin_advisor::{
    advise as advise_provider, AdvisorRequest, AdvisorResponse, Provider, SecretString,
};
use pinkbin_executor::{Action, Plan, UndoEntry};
use pinkbin_scaffold::{
    compile_all, detect_compiled, expand_env, load_dir, parse_toml, CompiledScaffold,
    RecycleGranularity, Scaffold,
};
use pinkbin_scanner::{scan_with_stats, Node, ScanOptions, ScanStats, SCAN_CANCELLED};
use pinkbin_walker::{
    find_matching_dirs, mtime_older_than, path_passes_env, path_passes_wxid,
    pinkbin_walker,
};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_keyring::KeyringExt;

/// The single keyring slot the app uses. The frontend treats this as an
/// opaque id — only the service/user name is shipped in IPC; the secret
/// value lives in the OS credential manager (Windows Credential Manager /
/// macOS Keychain / Linux libsecret), never in the webview's localStorage.
const KEYRING_SERVICE: &str = "com.pinkbin.desktop";
const ADVISOR_KEY_ACCOUNT: &str = "pinkbin:advisor-key";

// ── Structured command error ────────────────────────────────────────────────

/// Typed error for Tauri IPC commands. Replaces `Result<T, String>` so the
/// frontend can branch on error kind instead of parsing human-readable strings.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(tag = "kind", content = "message")]
pub enum CommandError {
    NotFound(String),
    PermissionDenied(String),
    Io(String),
    Cancelled(String),
    InvalidInput(String),
    ScaffoldNotFound(String),
    ScopeNotFound(String),
    Other(String),
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(m) => write!(f, "{m}"),
            Self::PermissionDenied(m) => write!(f, "{m}"),
            Self::Io(m) => write!(f, "{m}"),
            Self::Cancelled(m) => write!(f, "{m}"),
            Self::InvalidInput(m) => write!(f, "{m}"),
            Self::ScaffoldNotFound(m) => write!(f, "{m}"),
            Self::ScopeNotFound(m) => write!(f, "{m}"),
            Self::Other(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for CommandError {}

impl From<String> for CommandError {
    fn from(s: String) -> Self {
        // Heuristic: classify common error substrings. This is intentionally
        // lossy — the enum is the preferred path, this is a compat shim for
        // the many `.map_err(CommandError::from)` call sites.
        let lower = s.to_lowercase();
        if lower.contains("not found") || lower.contains("does not exist") {
            Self::NotFound(s)
        } else if lower.contains("permission") || lower.contains("access denied") || lower.contains("admin") {
            Self::PermissionDenied(s)
        } else if lower.contains("cancel") {
            Self::Cancelled(s)
        } else {
            Self::Other(s)
        }
    }
}

impl From<anyhow::Error> for CommandError {
    fn from(e: anyhow::Error) -> Self {
        Self::from(e.to_string())
    }
}

impl From<tokio::task::JoinError> for CommandError {
    fn from(e: tokio::task::JoinError) -> Self {
        Self::Other(e.to_string())
    }
}

impl From<std::io::Error> for CommandError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

impl From<globset::Error> for CommandError {
    fn from(e: globset::Error) -> Self {
        Self::InvalidInput(e.to_string())
    }
}

impl From<&str> for CommandError {
    fn from(s: &str) -> Self {
        Self::from(s.to_string())
    }
}

// Compile-time embed of repo-root scaffolds/. Used as the lowest-priority
// fallback in load_all_scaffolds so a portable raw exe (no resource_dir,
// arbitrary cwd) still ships with all packaged scaffolds.
static EMBEDDED_SCAFFOLDS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../../scaffolds");

#[derive(serde::Serialize, Clone)]
struct ScanProgressEvent {
    files_seen: u64,
    bytes_seen: u64,
    current_path: String,
}

struct AppState {
    scaffolds: RwLock<Vec<Scaffold>>,
    advisor: Mutex<Option<Provider>>,
    quarantine_root: PathBuf,
    undo_log: PathBuf,
    /// Map of active job_id → cancel flag. Set to `true` to request
    /// early termination of a running `execute_scope` / `execute_plan`.
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Cache of compiled scope globs. Key is the raw glob string from the
    /// scaffold TOML; value is the compiled GlobSet. Lazily populated on
    /// first use — avoids recompiling the same glob on every
    /// `find_scope_for_path` / `execute_scope` / `execute_plan` call.
    compiled_scopes: Mutex<HashMap<String, globset::GlobSet>>,
}

#[tauri::command]
async fn scan_path(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    scan_id: Option<String>,
) -> Result<Node, CommandError> {
    let p = PathBuf::from(&path);
    let app_for_progress = app.clone();
    let app_for_stats = app.clone();
    let cmd_t0 = std::time::Instant::now();

    // Register cancel flag in the shared jobs map so `cancel_job` can set it.
    let cancel_flag: Option<Arc<AtomicBool>> = scan_id.as_ref().map(|sid| {
        state
            .jobs
            .lock()
            .unwrap()
            .entry(sid.clone())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .clone()
    });

    // Compile scaffolds outside spawn_blocking so we don't carry the AppState
    // RwLock read guard is !Send, so compile outside spawn_blocking and
    // drop the guard before entering the blocking thread.
    let compiled = compile_all(&state.scaffolds.read().unwrap());
    let cancel_for_blocking = cancel_flag.clone();

    let result = tokio::task::spawn_blocking(move || {
        let last_progress_emit = std::sync::atomic::AtomicU64::new(0);
        let scan_result = scan_with_stats(p, ScanOptions::default(), |progress| {
            // Throttle progress events to ~50ms to avoid saturating the
            // frontend's React main thread with thousands of IPC calls/sec.
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let last = last_progress_emit.load(std::sync::atomic::Ordering::Relaxed);
            if now_ms.saturating_sub(last) < 50 {
                return;
            }
            last_progress_emit.store(now_ms, std::sync::atomic::Ordering::Relaxed);
            let _ = app_for_progress.emit(
                "scan-progress",
                ScanProgressEvent {
                    files_seen: progress.files_seen,
                    bytes_seen: progress.bytes_seen,
                    current_path: progress.current_path.clone(),
                },
            );
        }, cancel_for_blocking);
        // After the scan returns, walk the tree once to fill scaffold_id and
        // apply the depth-based breadth caps that the frontend's tagScaffolds
        // used to apply. Doing both here in one pass with pre-compiled
        // GlobSets replaces the previous per-directory IPC storm.
        let tag_t0 = std::time::Instant::now();
        scan_result.map(|(mut node, stats)| {
            tag_and_truncate(&mut node, &compiled, 0);
            (node, stats, tag_t0.elapsed().as_millis() as u64)
        })
    })
    .await
    .map_err(CommandError::from)?;

    // Clean up the jobs map entry.
    if let Some(sid) = &scan_id {
        state.jobs.lock().unwrap().remove(sid);
    }

    match result {
        Ok((node, stats, tag_ms)) => {
            let cmd_ms = cmd_t0.elapsed().as_millis() as u64;
            tracing::info!(
                "scan_path: cmd_ms={} scanner_ms={} tag_ms={} overhead={}ms",
                cmd_ms,
                stats.total_ms,
                tag_ms,
                cmd_ms.saturating_sub(stats.total_ms).saturating_sub(tag_ms),
            );
            let _ = app_for_stats.emit(
                "scan-stats",
                &ScanStatsEvent::from((cmd_ms, tag_ms, &stats)),
            );
            Ok(node)
        }
        Err(e) => {
            let msg = e.to_string();
            if msg == SCAN_CANCELLED {
                // Emit a final "cancelled" status so the frontend can react.
                let _ = app_for_stats.emit("scan-cancelled", ());
            }
            Err(msg.into())
        }
    }
}

/// Walks `node` in place, filling `scaffold_id` for directories and truncating
/// each level's children to the same depth-based caps the old frontend
/// `tagScaffolds` applied (depth<2 → 100, depth<4 → 50, else → 20).
///
/// Order matters: we recurse into ALL children first to propagate scaffold tags
/// fully, then apply a tag-aware truncation that keeps any subtree containing a
/// match before falling back to "biggest N" by size. Without this, a deep
/// scaffold target (e.g. `C:\Users\<u>\Documents\xwechat_files`) or one nested
/// inside a populated install dir (`Weixin\<v>\WeChatPlayer.bin`) could be
/// truncated out at deeper scan roots where the cap shrinks to 20.
fn tag_and_truncate(node: &mut Node, compiled: &[CompiledScaffold], depth: usize) {
    if node.is_dir {
        node.scaffold_id = detect_compiled(compiled, std::path::Path::new(&*node.path));
    }
    for c in &mut node.children {
        tag_and_truncate(c, compiled, depth + 1);
    }

    // Pre-compute tagged_descendant in post-order: after children are
    // processed, each child's scaffold_id + tagged_descendant is final.
    // This avoids O(N²) subtree traversal during truncation partitioning.
    node.tagged_descendant = node.scaffold_id.is_some()
        || node.children.iter().any(|c| c.tagged_descendant);

    let cap = if depth < 2 {
        100
    } else if depth < 4 {
        50
    } else {
        20
    };
    if node.children.len() > cap {
        let (tagged, rest): (Vec<Node>, Vec<Node>) =
            node.children.drain(..).partition(|c| c.tagged_descendant);
        let mut survivors: Vec<Node> = tagged.into_iter().take(cap).collect();
        let need = cap.saturating_sub(survivors.len());
        survivors.extend(rest.into_iter().take(need));
        // Restore size-desc order for display (partition mixed tagged in front).
        survivors.sort_by_key(|c| std::cmp::Reverse(c.size));
        node.children = survivors;
    }
}

#[derive(serde::Serialize, Clone)]
struct ScanStatsEvent {
    mode: String,
    mft_attempted: bool,
    mft_succeeded: bool,
    mft_ms: u64,
    mft_failure_reason: Option<String>,
    walk_ms: u64,
    build_tree_ms: u64,
    /// Time inside `scan_with_stats` (mft_ms + walk_ms + build_tree_ms + overhead).
    scanner_total_ms: u64,
    /// Time spent in the post-scan tag-and-truncate pass (replaces frontend tagScaffolds).
    tag_ms: u64,
    /// Time inside the `scan_path` command (scanner_total_ms + tag_ms + spawn_blocking overhead).
    cmd_total_ms: u64,
    files_seen: u64,
    bytes_seen: u64,
    dirs_in_acc: u64,
}

impl From<(u64, u64, &ScanStats)> for ScanStatsEvent {
    fn from((cmd_ms, tag_ms, s): (u64, u64, &ScanStats)) -> Self {
        Self {
            mode: s.mode.clone(),
            mft_attempted: s.mft_attempted,
            mft_succeeded: s.mft_succeeded,
            mft_ms: s.mft_ms,
            mft_failure_reason: s.mft_failure_reason.clone(),
            walk_ms: s.walk_ms,
            build_tree_ms: s.build_tree_ms,
            scanner_total_ms: s.total_ms,
            tag_ms,
            cmd_total_ms: cmd_ms,
            files_seen: s.files_seen,
            bytes_seen: s.bytes_seen,
            dirs_in_acc: s.dirs_in_acc,
        }
    }
}

#[tauri::command]
async fn list_scaffolds(state: State<'_, AppState>) -> Result<Vec<Scaffold>, CommandError> {
    Ok(state.scaffolds.read().unwrap().clone())
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}


#[derive(serde::Serialize, Clone)]
struct VolumeInfo {
    total_bytes: u64,
    used_bytes: u64,
    free_bytes: u64,
}

#[tauri::command]
fn volume_info(path: String) -> Result<VolumeInfo, CommandError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let mut wide: Vec<u16> = std::ffi::OsStr::new(&path).encode_wide().collect();
        // Trim to drive root for the Win32 API.
        let root: Vec<u16> = if wide.len() >= 2 && wide[1] == b':' as u16 {
            vec![wide[0], wide[1], b'\\' as u16, 0]
        } else {
            wide.push(0);
            wide
        };
        let mut free_to_caller: u64 = 0;
        let mut total: u64 = 0;
        let mut total_free: u64 = 0;
        // SAFETY: calling documented Win32 API with valid wide-char buffers.
        let ok = unsafe {
            #[link(name = "kernel32")]
            extern "system" {
                fn GetDiskFreeSpaceExW(
                    lpDirectoryName: *const u16,
                    lpFreeBytesAvailable: *mut u64,
                    lpTotalNumberOfBytes: *mut u64,
                    lpTotalNumberOfFreeBytes: *mut u64,
                ) -> i32;
            }
            GetDiskFreeSpaceExW(
                root.as_ptr(),
                &mut free_to_caller,
                &mut total,
                &mut total_free,
            )
        };
        if ok == 0 {
            return Err("GetDiskFreeSpaceExW failed".into());
        }
        Ok(VolumeInfo {
            total_bytes: total,
            used_bytes: total.saturating_sub(total_free),
            free_bytes: total_free,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("volume_info only implemented on Windows".into())
    }
}

#[derive(serde::Serialize, Clone)]
struct ScopeSize {
    scope_id: String,
    /// Bytes that would be cleaned at the current `scope_days` setting (i.e.
    /// files matching the glob AND older than retention). This is what the
    /// "X 待清理" pill in the modal renders.
    bytes: u64,
    file_count: u64,
    /// Bytes inside the scope **regardless of retention** — useful so the UI
    /// can show "你共有 12 GB 视频，0 GB 超过 90 天可清". Without this the
    /// modal can't distinguish "scope is empty" from "everything is within
    /// retention" (which used to render as a misleading "空").
    total_bytes: u64,
    total_files: u64,
}

/// Walk `root_path` and tally how many bytes / files each `[[scope]]` glob
/// True when `path`'s first `wxid_*` segment is in `allow`. Paths with no
/// `wxid_*` segment always pass. `None` or an empty allow-list disables.
/// Provided by pinkbin-walker crate.

fn compile_scope_set(glob: &str) -> Result<globset::GlobSet, CommandError> {
    let pattern = expand_env(glob);
    let g = globset::GlobBuilder::new(&pattern)
        .literal_separator(false)
        .case_insensitive(true)
        .build()
        .map_err(|e| format!("invalid glob {glob:?}: {e}"))?;
    let mut b = globset::GlobSetBuilder::new();
    b.add(g);
    b.build().map_err(CommandError::from)
}

/// Cached version of `compile_scope_set`. Looks up the compiled GlobSet in
/// the cache first; on miss, compiles and stores it. The cache key is the
/// raw glob string (before env expansion) so identical globs across
/// different scaffolds share one compiled entry.
fn compile_scope_set_cached(
    glob: &str,
    cache: &Mutex<HashMap<String, globset::GlobSet>>,
) -> Result<globset::GlobSet, CommandError> {
    {
        let c = cache.lock().unwrap();
        if let Some(set) = c.get(glob) {
            return Ok(set.clone());
        }
    }
    let set = compile_scope_set(glob)?;
    cache.lock().unwrap().insert(glob.to_string(), set.clone());
    Ok(set)
}

/// Walk `root` and return paths matching `set`, subject to filters.
/// Directory-granularity scopes delegate to `find_matching_dirs`.
fn resolve_scope_paths(
    root: &Path,
    set: &globset::GlobSet,
    granularity: RecycleGranularity,
    wxid_filter: Option<&[String]>,
    env_filter: Option<&[String]>,
    older_than_days: Option<u32>,
) -> Vec<PathBuf> {
    match granularity {
        RecycleGranularity::Directory => {
            find_matching_dirs(root, set, wxid_filter, env_filter, older_than_days)
        }
        RecycleGranularity::File => {
            let mut out = Vec::new();
            for entry in pinkbin_walker(root).into_iter().flatten() {
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
                // Hoist lightweight filter checks before the metadata syscall.
                if !path_passes_wxid(&path, wxid_filter)
                    || !path_passes_env(&path, env_filter)
                {
                    continue;
                }
                let metadata = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if !mtime_older_than(&metadata, older_than_days) {
                    continue;
                }
                let s = path.to_string_lossy().replace('\\', "/");
                if set.is_match(&s) {
                    out.push(path);
                }
            }
            out
        }
    }
}

/// Return per-scope sizes for all scopes in `scaffold_id`. Files matching
/// multiple scopes are counted once per matching scope (the same physical
/// bytes — overlap means cleaning either scope reclaims them).
#[tauri::command]
async fn scope_sizes(
    state: State<'_, AppState>,
    scaffold_id: String,
    root_paths: Vec<String>,
    scope_days: Option<HashMap<String, u32>>,
    wxid_filter: Option<Vec<String>>,
    env_filter: Option<Vec<String>>,
) -> Result<Vec<ScopeSize>, CommandError> {
    let scaffold = state
        .scaffolds
        .read()
        .unwrap()
        .iter()
        .find(|s| s.id == scaffold_id)
        .cloned()
        .ok_or_else(|| format!("scaffold not found: {scaffold_id}"))?;

    // Partition scopes by granularity. File scopes share one walk; directory
    // scopes each get find_matching_dirs + per-dir size sum. Mixed-granularity
    // scaffolds walk twice but each walk only does its own work.
    struct ScopeBuild {
        id: String,
        set: globset::GlobSet,
        granularity: RecycleGranularity,
    }
    let mut builds: Vec<ScopeBuild> = Vec::with_capacity(scaffold.scopes.len());
    for sc in &scaffold.scopes {
        let set = compile_scope_set_cached(&sc.glob, &state.compiled_scopes)
            .map_err(|e| format!("scope `{}`: {e}", sc.id))?;
        builds.push(ScopeBuild {
            id: sc.id.clone(),
            set,
            granularity: sc.recycle_granularity,
        });
    }

    let wxid_filter_owned = wxid_filter;
    let env_filter_owned = env_filter;
    let scope_days_owned = scope_days;
    tokio::task::spawn_blocking(move || -> Vec<ScopeSize> {
        let mut results: Vec<ScopeSize> = Vec::with_capacity(builds.len());
        let file_indices: Vec<usize> = builds
            .iter()
            .enumerate()
            .filter(|(_, b)| b.granularity == RecycleGranularity::File)
            .map(|(i, _)| i)
            .collect();
        let dir_indices: Vec<usize> = builds
            .iter()
            .enumerate()
            .filter(|(_, b)| b.granularity == RecycleGranularity::Directory)
            .map(|(i, _)| i)
            .collect();

        let mut tally: Vec<(u64, u64)> = vec![(0, 0); builds.len()];
        let mut total: Vec<(u64, u64)> = vec![(0, 0); builds.len()];

        for root_path in &root_paths {
            let root = PathBuf::from(root_path);

        // ── File scopes: single walk per root, tally across all file scopes.
        if !file_indices.is_empty() {
            for entry in pinkbin_walker(&root).into_iter().flatten() {
                if !entry.file_type().is_file() {
                    continue;
                }
                let path = entry.path();
                if !path_passes_wxid(&path, wxid_filter_owned.as_deref())
                    || !path_passes_env(&path, env_filter_owned.as_deref())
                {
                    continue;
                }
                let metadata = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let path_str = path.to_string_lossy().replace('\\', "/");
                let size = metadata.len();
                for &i in &file_indices {
                    let b = &builds[i];
                    if !b.set.is_match(&path_str) {
                        continue;
                    }
                    total[i].0 = total[i].0.saturating_add(size);
                    total[i].1 = total[i].1.saturating_add(1);
                    let days = scope_days_owned
                        .as_ref()
                        .and_then(|m| m.get(&b.id).copied());
                    if !mtime_older_than(&metadata, days) {
                        continue;
                    }
                    tally[i].0 = tally[i].0.saturating_add(size);
                    tally[i].1 = tally[i].1.saturating_add(1);
                }
            }
        }

        // ── Directory scopes: each gets its own dir walk + size sum.
        for &i in &dir_indices {
            let b = &builds[i];
            let total_dirs = find_matching_dirs(
                &root,
                &b.set,
                wxid_filter_owned.as_deref(),
                env_filter_owned.as_deref(),
                None,
            );
            let mut t_bytes: u64 = 0;
            for d in &total_dirs {
                t_bytes = t_bytes.saturating_add(dir_size_excluding(d, &[]));
            }
            total[i].0 = total[i].0.saturating_add(t_bytes);
            total[i].1 = total[i].1.saturating_add(total_dirs.len() as u64);
            // Eligible: same but with retention applied.
            let days = scope_days_owned
                .as_ref()
                .and_then(|m| m.get(&b.id).copied());
            let dirs = find_matching_dirs(
                &root,
                &b.set,
                wxid_filter_owned.as_deref(),
                env_filter_owned.as_deref(),
                days,
            );
            let mut bytes: u64 = 0;
            let mut count: u64 = 0;
            for d in &dirs {
                bytes = bytes.saturating_add(dir_size_excluding(d, &[]));
                count = count.saturating_add(1);
            }
            tally[i].0 = tally[i].0.saturating_add(bytes);
            tally[i].1 = tally[i].1.saturating_add(count);
        }
        } // end for root_path

        // Build output preserving builds order.
        for (i, b) in builds.into_iter().enumerate() {
            results.push(ScopeSize {
                scope_id: b.id,
                bytes: tally[i].0,
                file_count: tally[i].1,
                total_bytes: total[i].0,
                total_files: total[i].1,
            });
        }
        results
    })
    .await
    .map_err(CommandError::from)
}

/// Shared tail of `execute_scope` / `execute_plan`: derive the executor
/// `Action` from scope metadata (never from the caller), build the `Plan`,
/// register the cancel flag, and run `execute_with_cancel` on a blocking
/// thread. Both callers resolve `matched` paths differently but the rest
/// was identical — this is the single source of truth for that logic.
async fn dispatch_execution(
    scope: &pinkbin_scaffold::Scope,
    matched: Vec<PathBuf>,
    reason: String,
    dry_run: bool,
    undo_log: PathBuf,
    quarantine_root: PathBuf,
    jobs: &Mutex<HashMap<String, Arc<AtomicBool>>>,
    job_id: Option<String>,
) -> Result<Vec<UndoEntry>, CommandError> {
    if matched.is_empty() {
        return Ok(Vec::new());
    }

    // Directory granularity is locked to Recycle — an entire directory removal
    // is high cost to undo; recoverability via Recycle Bin is non-negotiable.
    let action = if scope.recycle_granularity == RecycleGranularity::Directory {
        Action::Recycle
    } else {
        scope.mode
    };
    let plan = Plan {
        action,
        paths: matched,
        reason,
    };

    let cancel_flag: Option<Arc<AtomicBool>> = job_id.as_ref().map(|jid| {
        jobs.lock()
            .unwrap()
            .entry(jid.clone())
            .or_insert_with(|| Arc::new(AtomicBool::new(false)))
            .clone()
    });

    tokio::task::spawn_blocking(move || {
        pinkbin_executor::execute_with_cancel(
            &plan,
            dry_run,
            &undo_log,
            &quarantine_root,
            cancel_flag.as_deref(),
        )
    })
    .await
    .map_err(CommandError::from)?
    .map_err(CommandError::from)
}

/// Resolve a scaffold scope's glob to actual file paths under `root_path` and
/// run the executor on just those files. Use this instead of feeding the
/// matched root directly into `execute_plan` — the latter would delete the
/// whole folder, ignoring the scope's glob. `dry_run = true` returns what
/// would be touched without performing the action.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // every arg is a distinct user-facing knob; bundling into a struct is just shuffling
async fn execute_scope(
    state: State<'_, AppState>,
    scaffold_id: String,
    scope_id: String,
    root_path: String,
    dry_run: bool,
    older_than_days: Option<u32>,
    wxid_filter: Option<Vec<String>>,
    env_filter: Option<Vec<String>>,
    job_id: Option<String>,
) -> Result<Vec<UndoEntry>, CommandError> {
    let (scaffold, scope) = {
        let scaffolds = state.scaffolds.read().unwrap();
        let sc = scaffolds
            .iter()
            .find(|s| s.id == scaffold_id)
            .cloned()
            .ok_or_else(|| format!("scaffold not found: {scaffold_id}"))?;
        let scope = sc
            .scopes
            .iter()
            .find(|s| s.id == scope_id)
            .cloned()
            .ok_or_else(|| format!("scope not found: {scaffold_id}/{scope_id}"))?;
        (sc, scope)
    };

    let set = compile_scope_set_cached(&scope.glob, &state.compiled_scopes)
        .map_err(|e| format!("scope `{}`: {e}", scope.id))?;
    let root = PathBuf::from(&root_path);
    let granularity = scope.recycle_granularity;

    let matched: Vec<PathBuf> = tokio::task::spawn_blocking(move || {
        resolve_scope_paths(
            &root,
            &set,
            granularity,
            wxid_filter.as_deref(),
            env_filter.as_deref(),
            older_than_days,
        )
    })
    .await
    .map_err(CommandError::from)?;

    dispatch_execution(
        &scope,
        matched,
        format!("Pinkbin scaffold {}/{} (Studio)", scaffold.id, scope.id),
        dry_run,
        state.undo_log.clone(),
        state.quarantine_root.clone(),
        &state.jobs,
        job_id,
    )
    .await
}

/// Per-env metadata for the conda card's env list. `last_active_ts` is the
/// mtime of `<env>/conda-meta/history`, conda's own "last operation" timestamp
/// (install/remove/update). Pure `conda activate` does NOT update history —
/// "every-day-but-don't-install" envs may show stale; mode = recycle keeps
/// that recoverable. `default_checked` is the backend's recommendation
/// (!is_base && stale > 90d) that the UI uses to seed checkbox state.
#[derive(serde::Serialize, Clone)]
struct CondaEnv {
    name: String,
    path: String,
    size_bytes: u64,
    last_active_ts: Option<u64>,
    is_base: bool,
    default_checked: bool,
}

const CONDA_STALE_DAYS: u64 = 90;

#[tauri::command]
async fn list_conda_envs(conda_root: String) -> Result<Vec<CondaEnv>, CommandError> {
    let root = PathBuf::from(&conda_root);
    if !root.exists() {
        return Err(format!("conda root does not exist: {conda_root}").into());
    }
    tokio::task::spawn_blocking(move || -> Vec<CondaEnv> {
        let mut out = Vec::new();
        let now_secs = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let stale_cutoff_secs = CONDA_STALE_DAYS * 86_400;

        // Base env occupies <root>/ itself. Exclude envs/ and pkgs/ subtrees
        // when summing — those have their own scope cards and shouldn't be
        // double-counted in the base row's size.
        let envs_subdir = root.join("envs");
        let pkgs_subdir = root.join("pkgs");
        let base_history = root.join("conda-meta/history");
        let base_last = read_mtime_secs(&base_history);
        let base_size = dir_size_excluding(&root, &[envs_subdir.clone(), pkgs_subdir]);
        out.push(CondaEnv {
            name: "base".to_string(),
            path: root.to_string_lossy().replace('\\', "/"),
            size_bytes: base_size,
            last_active_ts: base_last,
            is_base: true,
            default_checked: false,
        });

        // User envs at <root>/envs/<name>/
        if let Ok(rd) = std::fs::read_dir(&envs_subdir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let name = match p.file_name() {
                    Some(n) => n.to_string_lossy().into_owned(),
                    None => continue,
                };
                let history = p.join("conda-meta/history");
                let last = read_mtime_secs(&history);
                let size = dir_size_excluding(&p, &[]);
                let default_checked = match last {
                    Some(ts) => now_secs.saturating_sub(ts) > stale_cutoff_secs,
                    // No history → no signal. Conservative: don't auto-select.
                    None => false,
                };
                out.push(CondaEnv {
                    name,
                    path: p.to_string_lossy().replace('\\', "/"),
                    size_bytes: size,
                    last_active_ts: last,
                    is_base: false,
                    default_checked,
                });
            }
        }
        out
    })
    .await
    .map_err(CommandError::from)
}

fn read_mtime_secs(p: &Path) -> Option<u64> {
    let md = std::fs::metadata(p).ok()?;
    let modified = md.modified().ok()?;
    modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

/// Recursive byte sum under `dir`, skipping any file whose path starts with
/// one of the `excludes` prefixes (after normalizing slashes + lowercasing).
/// Used to compute base env size without counting the envs/ + pkgs/ subtrees.
fn dir_size_excluding(dir: &Path, excludes: &[PathBuf]) -> u64 {
    let exclude_prefixes: Vec<String> = excludes
        .iter()
        .map(|p| p.to_string_lossy().replace('\\', "/").to_lowercase())
        .collect();
    let mut total: u64 = 0;
    for entry in pinkbin_walker(dir).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry
            .path()
            .to_string_lossy()
            .replace('\\', "/")
            .to_lowercase();
        if exclude_prefixes.iter().any(|e| p.starts_with(e)) {
            continue;
        }
        if let Ok(md) = entry.metadata() {
            total = total.saturating_add(md.len());
        }
    }
    total
}

#[tauri::command]
async fn advise(
    state: State<'_, AppState>,
    req: AdvisorRequest,
) -> Result<AdvisorResponse, CommandError> {
    let provider = state
        .advisor
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "advisor not configured — open Settings".to_string())?;
    advise_provider(&provider, &req)
        .await
        .map_err(CommandError::from)
}

/// Open the OS file manager and reveal `path`. On Windows this uses
/// `explorer.exe /select,...` for files (so the file is highlighted) or just
/// the directory itself for directories. On macOS it's `open -R`. On Linux
/// it's `xdg-open` of the parent directory (no portable "select" verb).
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), CommandError> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {path}").into());
    }
    #[cfg(target_os = "windows")]
    {
        if p.is_dir() {
            std::process::Command::new("explorer")
                .arg(p)
                .spawn()
                .map_err(CommandError::from)?;
        } else {
            std::process::Command::new("explorer")
                .arg(format!("/select,{}", p.display()))
                .spawn()
                .map_err(CommandError::from)?;
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(p)
            .spawn()
            .map_err(CommandError::from)?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if p.is_dir() {
            p.to_path_buf()
        } else {
            p.parent().unwrap_or(p).to_path_buf()
        };
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(CommandError::from)?;
        Ok(())
    }
}

/// `execute_plan` is the chat/quick-recycle entry point. Unlike `execute_scope`,
/// it does **not** walk a root to resolve paths — the caller passes pre-resolved
/// paths. To keep scaffold red-lines enforceable, the call must declare which
/// `scaffold_id` + `scope_id` it claims, and the backend re-checks every path
/// against the scope's compiled glob. A path that doesn't match is rejected.
/// The final `Action` is derived from the scope's declared mode, never from
/// the caller — so the frontend cannot upgrade recycle → delete.
#[tauri::command]
async fn execute_plan(
    state: State<'_, AppState>,
    scaffold_id: String,
    scope_id: String,
    paths: Vec<String>,
    reason: String,
    dry_run: bool,
    job_id: Option<String>,
) -> Result<Vec<UndoEntry>, CommandError> {
    let (scaffold, scope) = {
        let scaffolds = state.scaffolds.read().unwrap();
        let sc = scaffolds
            .iter()
            .find(|s| s.id == scaffold_id)
            .cloned()
            .ok_or_else(|| format!("scaffold not found: {scaffold_id}"))?;
        let scope = sc
            .scopes
            .iter()
            .find(|s| s.id == scope_id)
            .cloned()
            .ok_or_else(|| format!("scope not found: {scaffold_id}/{scope_id}"))?;
        (sc, scope)
    };

    let set = compile_scope_set_cached(&scope.glob, &state.compiled_scopes)
        .map_err(|e| format!("scope `{}`: {e}", scope.id))?;

    let mut matched: Vec<PathBuf> = Vec::with_capacity(paths.len());
    for p in paths {
        let pb = PathBuf::from(&p);
        let normalized = pb.to_string_lossy().replace('\\', "/");
        if !set.is_match(&normalized) {
            return Err(format!(
                "path `{p}` is outside scope `{}/{}` glob `{}` — refusing",
                scaffold.id, scope.id, scope.glob
            ).into());
        }
        matched.push(pb);
    }
    dispatch_execution(
        &scope,
        matched,
        format!("{reason} [via {}/{}]", scaffold.id, scope.id),
        dry_run,
        state.undo_log.clone(),
        state.quarantine_root.clone(),
        &state.jobs,
        job_id,
    )
    .await
}

/// Set the cancel flag for a running job identified by `job_id`. The
/// executor checks this flag between path iterations and stops early when
/// it sees `true`. Idempotent — cancelling a missing or already-completed
/// job is a no-op.
#[tauri::command]
fn cancel_job(state: State<'_, AppState>, job_id: String) -> Result<(), CommandError> {
    if let Some(flag) = state.jobs.lock().unwrap().get(&job_id).cloned() {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// Return every (scaffold_id, scope_id) whose compiled glob matches `path`.
/// Used by the chat panel to discover which scope(s) own a tree node before
/// calling `execute_plan`. The mode is included so callers can filter to
/// the action they intend (e.g. the chat only ever wants `recycle`).
#[derive(serde::Serialize, Clone)]
struct ScopeMatch {
    scaffold_id: String,
    scope_id: String,
    mode: String,
}

#[tauri::command]
async fn find_scope_for_path(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<ScopeMatch>, CommandError> {
    let scaffolds = state.scaffolds.read().unwrap();
    let normalized = PathBuf::from(&path)
        .to_string_lossy()
        .replace('\\', "/");
    let mut out = Vec::new();
    for s in scaffolds.iter() {
        for sc in &s.scopes {
            match compile_scope_set_cached(&sc.glob, &state.compiled_scopes) {
                Ok(set) if set.is_match(&normalized) => {
                    let mode = match sc.mode {
                        Action::Recycle => "recycle",
                        Action::Quarantine => "quarantine",
                        Action::Delete => "delete",
                    };
                    out.push(ScopeMatch {
                        scaffold_id: s.id.clone(),
                        scope_id: sc.id.clone(),
                        mode: mode.to_string(),
                    });
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!("scope {}/{}: bad glob: {e}", s.id, sc.id);
                }
            }
        }
    }
    Ok(out)
}

/// Inspect the Steam install (registry + default paths). Returns a full
/// inventory: every library root, every installed/ghost game, with
/// recommendation flags pre-computed in the backend per design doc §6.5.
/// Frontend never has to recompute the dormancy heuristic.
#[tauri::command]
async fn list_steam_games() -> Result<pinkbin_steam_inspector::SteamInventory, CommandError> {
    tokio::task::spawn_blocking(pinkbin_steam_inspector::inspect)
        .await
        .map_err(CommandError::from)?
        .map_err(|e| CommandError::from(format!("steam inspect failed: {e:#}")))
}

/// Lazily enumerate every Workshop item under one game's
/// `<library>/steamapps/workshop/content/<appid>/`. Each item entry includes
/// the recursive size and folder mtime — slow enough that we do this on
/// click rather than during the bulk inspect.
#[tauri::command]
async fn list_steam_workshop_items(
    library_root: String,
    appid: u32,
) -> Result<Vec<pinkbin_steam_inspector::WorkshopItem>, CommandError> {
    let path = PathBuf::from(library_root);
    tokio::task::spawn_blocking(move || pinkbin_steam_inspector::list_workshop_items(&path, appid))
        .await
        .map_err(CommandError::from)?
        .map_err(|e| CommandError::from(format!("workshop scan failed: {e:#}")))
}

/// Resolve workshop item IDs to human-readable titles via Steam's public
/// `ISteamRemoteStorage/GetPublishedFileDetails` endpoint. No API key, no
/// auth — just a batched POST. Returns ID → title for every item Steam
/// reports `result: 1` (OK); deleted/private items are simply absent from
/// the map and the frontend renders the bare ID as fallback.
///
/// Network resilience: in mainland China `api.steampowered.com` is often
/// reachable only through a proxy, so we honor the Windows system proxy
/// (`HKCU\...\Internet Settings\ProxyEnable + ProxyServer`) — most VPN
/// clients (Clash, V2RayN, Shadowrocket-PC, etc.) write that key when
/// they're on. One automatic retry with 800ms backoff smooths transient
/// flakes. Frontend caches successful results in localStorage so demos
/// don't need to re-fetch over an unstable connection.
///
/// Privacy: the IDs we send are the same ones the user already received
/// from Steam by virtue of subscribing. We're not sending paths, names of
/// other games, or anything Steam doesn't already have. This goes to
/// Steam directly — never to an LLM (where opaque numeric IDs would be
/// useless anyway).
#[tauri::command]
async fn fetch_workshop_titles(ids: Vec<u64>) -> Result<HashMap<u64, String>, CommandError> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }

    #[derive(serde::Deserialize)]
    struct Resp {
        response: RespInner,
    }
    #[derive(serde::Deserialize)]
    struct RespInner {
        #[serde(default)]
        publishedfiledetails: Vec<Item>,
    }
    #[derive(serde::Deserialize)]
    struct Item {
        publishedfileid: String,
        result: i32,
        #[serde(default)]
        title: Option<String>,
    }

    let mut form: Vec<(String, String)> = Vec::with_capacity(ids.len() + 1);
    form.push(("itemcount".to_string(), ids.len().to_string()));
    for (i, id) in ids.iter().enumerate() {
        form.push((format!("publishedfileids[{i}]"), id.to_string()));
    }

    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(10));
    if let Some(proxy_str) = system_https_proxy() {
        match reqwest::Proxy::all(&proxy_str) {
            Ok(p) => {
                tracing::info!("workshop title fetch: using system proxy {}", proxy_str);
                builder = builder.proxy(p);
            }
            Err(e) => {
                tracing::warn!(
                    "workshop title fetch: ignoring malformed system proxy {:?}: {}",
                    proxy_str,
                    e
                );
            }
        }
    }
    let client = builder
        .build()
        .map_err(|e| format!("steam api client build failed: {e}"))?;

    let url = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
    let mut last_err: Option<String> = None;
    let mut resp_opt: Option<reqwest::Response> = None;
    for attempt in 0..2u32 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(800)).await;
        }
        match client.post(url).form(&form).send().await {
            Ok(r) => {
                resp_opt = Some(r);
                last_err = None;
                break;
            }
            Err(e) => {
                tracing::warn!("workshop title fetch attempt {} failed: {}", attempt + 1, e);
                last_err = Some(e.to_string());
            }
        }
    }
    let resp = resp_opt.ok_or_else(|| {
        format!(
            "Steam 服务器无响应（重试 1 次后仍失败）: {}",
            last_err.unwrap_or_else(|| "unknown".to_string())
        )
    })?;
    if !resp.status().is_success() {
        return Err(format!("Steam 服务器返回 HTTP {}", resp.status()).into());
    }
    let parsed: Resp = resp
        .json()
        .await
        .map_err(|e| format!("Steam 服务器响应解析失败: {e}"))?;
    let mut out: HashMap<u64, String> = HashMap::new();
    for item in parsed.response.publishedfiledetails {
        if item.result != 1 {
            continue; // 9 = deleted, 16 = banned, etc. — fall back to ID display.
        }
        if let (Ok(id), Some(title)) = (item.publishedfileid.parse::<u64>(), item.title) {
            if !title.is_empty() {
                out.insert(id, title);
            }
        }
    }
    Ok(out)
}

/// Read the system HTTPS proxy if one is configured, normalized into a URL
/// reqwest can consume. Windows-only — on mac/linux reqwest already honors
/// `HTTPS_PROXY` env var by default, which is the standard convention.
#[cfg(windows)]
fn system_https_proxy() -> Option<String> {
    let raw = read_windows_proxy_server()?;
    parse_proxy_server(&raw)
}

#[cfg(not(windows))]
fn system_https_proxy() -> Option<String> {
    None
}

/// Read `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`
/// and return the `ProxyServer` REG_SZ value when `ProxyEnable` is non-zero.
/// Returns the raw string Steam-side parsing will normalize.
#[cfg(windows)]
fn read_windows_proxy_server() -> Option<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_DWORD,
        REG_SZ,
    };

    let subkey: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\0"
        .encode_utf16()
        .collect();

    unsafe {
        let mut hkey: HKEY = std::ptr::null_mut();
        if RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut hkey)
            != ERROR_SUCCESS
        {
            return None;
        }

        // ProxyEnable (DWORD) — 0 = disabled.
        let mut proxy_enable: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let mut ty: u32 = 0;
        let name: Vec<u16> = "ProxyEnable\0".encode_utf16().collect();
        let res = RegQueryValueExW(
            hkey,
            name.as_ptr(),
            std::ptr::null_mut(),
            &mut ty,
            &mut proxy_enable as *mut _ as *mut u8,
            &mut size,
        );
        if res != ERROR_SUCCESS || ty != REG_DWORD || proxy_enable == 0 {
            let _ = RegCloseKey(hkey);
            return None;
        }

        // ProxyServer (REG_SZ).
        let mut buf = [0u16; 512];
        let mut len = (buf.len() * 2) as u32;
        let mut ty: u32 = 0;
        let name: Vec<u16> = "ProxyServer\0".encode_utf16().collect();
        let res = RegQueryValueExW(
            hkey,
            name.as_ptr(),
            std::ptr::null_mut(),
            &mut ty,
            buf.as_mut_ptr() as *mut u8,
            &mut len,
        );
        let _ = RegCloseKey(hkey);
        if res != ERROR_SUCCESS || ty != REG_SZ {
            return None;
        }
        let u16_len = (len as usize / 2).saturating_sub(1);
        let s = OsString::from_wide(&buf[..u16_len]);
        s.to_str().map(|s| s.to_string())
    }
}

/// Normalize the IE `ProxyServer` value into a single URL reqwest can use.
/// Accepts the two formats Windows writes:
///   "127.0.0.1:7890"                                 → http://127.0.0.1:7890
///   "http=127.0.0.1:7890;https=127.0.0.1:7890;..."   → pick the https= entry
#[cfg(windows)]
fn parse_proxy_server(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let with_scheme = |s: &str| -> String {
        if s.starts_with("http://") || s.starts_with("https://") || s.starts_with("socks5://") {
            s.to_string()
        } else {
            format!("http://{s}")
        }
    };
    if raw.contains('=') {
        // Per-protocol form. Prefer https=, fall back to http=.
        let parts: Vec<&str> = raw.split(';').map(|p| p.trim()).collect();
        if let Some(p) = parts.iter().find_map(|p| p.strip_prefix("https=")) {
            return Some(with_scheme(p));
        }
        if let Some(p) = parts.iter().find_map(|p| p.strip_prefix("http=")) {
            return Some(with_scheme(p));
        }
        return None;
    }
    Some(with_scheme(raw))
}

#[cfg(all(test, windows))]
mod proxy_parse_tests {
    use super::parse_proxy_server;

    #[test]
    fn single_value_gets_http_scheme() {
        assert_eq!(
            parse_proxy_server("127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890"),
        );
    }

    #[test]
    fn already_scheme_kept_as_is() {
        assert_eq!(
            parse_proxy_server("http://10.0.0.1:8080").as_deref(),
            Some("http://10.0.0.1:8080"),
        );
    }

    #[test]
    fn per_protocol_prefers_https() {
        assert_eq!(
            parse_proxy_server("http=127.0.0.1:7890;https=127.0.0.1:7891;ftp=127.0.0.1:7892")
                .as_deref(),
            Some("http://127.0.0.1:7891"),
        );
    }

    #[test]
    fn per_protocol_falls_back_to_http_only() {
        assert_eq!(
            parse_proxy_server("http=127.0.0.1:7890;ftp=127.0.0.1:7891").as_deref(),
            Some("http://127.0.0.1:7890"),
        );
    }

    #[test]
    fn empty_returns_none() {
        assert_eq!(parse_proxy_server(""), None);
        assert_eq!(parse_proxy_server("   "), None);
    }
}

/// Hand off to Steam via its custom URI scheme. Action whitelist + numeric
/// id means the URL surface can't be poisoned by arbitrary frontend
/// strings — this is the only way a Steam Inspector destructive intent
/// (uninstall) leaves the app, and it's Steam itself that runs the action.
/// `id` is appid for game actions, or workshop file id for `url/CommunityFilePage`.
#[tauri::command]
fn open_steam_url(action: String, appid: u64) -> Result<(), CommandError> {
    // Whitelist actions; `url/CommunityFilePage` is the workshop-item page.
    let url = match action.as_str() {
        "uninstall" | "rungameid" | "validate" | "nav" => format!("steam://{action}/{appid}"),
        "workshop_page" => format!("steam://url/CommunityFilePage/{appid}"),
        other => return Err(format!("unsupported steam action: {other}").into()),
    };

    #[cfg(target_os = "windows")]
    {
        // `cmd /c start "" "<url>"` is the standard Windows recipe for
        // launching a registered URL handler without inheriting the parent
        // window. The empty `""` is the start command's required title arg.
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn()
            .map_err(CommandError::from)?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(CommandError::from)?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(CommandError::from)?;
        Ok(())
    }
}

#[tauri::command]
fn set_advisor(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: String,
    model: String,
    base_url: Option<String>,
) -> Result<(), CommandError> {
    // The API key is read from the OS credential store — it is no longer
    // shipped in this IPC payload. The frontend stores it via
    // `store_secret` (which uses tauri-plugin-keyring) and we look it up
    // here. This means the key never leaves the keychain + the backend's
    // process memory, instead of being persisted in the webview's
    // localStorage (which is a plaintext file on disk).
    let api_key = match app.keyring().get_password(KEYRING_SERVICE, ADVISOR_KEY_ACCOUNT) {
        Ok(Some(s)) => s,
        Ok(None) => {
            return Err(
                "advisor key not found in keychain. Open Settings and re-enter your API key."
                    .into(),
            )
        }
        Err(e) => return Err(format!("keychain read failed: {e}").into()),
    };

    let p = match provider.as_str() {
        "openai" => Provider::OpenAI {
            api_key: SecretString::new(api_key),
            model,
            base_url: base_url.unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
        },
        "anthropic" => Provider::Anthropic {
            api_key: SecretString::new(api_key),
            model,
            base_url: base_url.unwrap_or_else(|| "https://api.anthropic.com".to_string()),
        },
        "ollama" => Provider::Ollama {
            base_url: base_url.unwrap_or_else(|| "http://localhost:11434".to_string()),
            model,
        },
        "gemini" => Provider::Gemini {
            api_key: SecretString::new(api_key),
            model,
            base_url: base_url
                .unwrap_or_else(|| "https://generativelanguage.googleapis.com".to_string()),
        },
        "none" => {
            *state.advisor.lock().unwrap() = None;
            return Ok(());
        }
        other => return Err(format!("unknown provider: {other}").into()),
    };
    *state.advisor.lock().unwrap() = Some(p);
    Ok(())
}

// ── Keyring-backed secret store ──────────────────────────────────────────
//
// The webview can ask the backend to put a secret in the OS credential
// manager (`store_secret`), read it back (`load_secret`), or wipe it
// (`delete_secret`). The frontend never sees the keychain's internals
// beyond its own slot name; the actual secret value flows over IPC only
// on `store_secret` (when the user just typed it) and on `load_secret`
// (when an AI call needs to make a signed HTTP request from the webview).
//
// `load_secret` returns `Ok(None)` when the slot is empty so the frontend
// can distinguish "not configured" from "keychain error". `delete_secret`
// is idempotent — deleting a missing entry is a no-op, not an error.

#[tauri::command]
fn store_secret(
    app: AppHandle,
    account: String,
    secret: String,
) -> Result<(), CommandError> {
    app.keyring()
        .set_password(KEYRING_SERVICE, &account, &secret)
        .map_err(|e| CommandError::from(format!("keyring set `{account}`: {e}")))
}

#[tauri::command]
fn load_secret(app: AppHandle, account: String) -> Result<Option<String>, CommandError> {
    // `get_password` returns `Result<Option<String>>`: `Ok(None)` for a
    // missing slot, `Err` for genuine keychain errors. The webview needs
    // to be able to distinguish "not configured" from "keychain broken"
    // so we forward both.
    app.keyring()
        .get_password(KEYRING_SERVICE, &account)
        .map_err(|e| CommandError::from(format!("keyring get `{account}`: {e}")))
}

#[tauri::command]
fn delete_secret(app: AppHandle, account: String) -> Result<(), CommandError> {
    // Make this idempotent: deleting a missing entry returns
    // `Err(NoEntry)`, which we swallow. The Settings UI calls
    // `delete_secret` on "wipe" and the user shouldn't see a scary
    // error if the key was already gone.
    match app.keyring().delete_password(KEYRING_SERVICE, &account) {
        Ok(()) => Ok(()),
        Err(e) => {
            let msg = e.to_string();
            if msg.to_lowercase().contains("no entry") || msg.contains("NoSuch") {
                Ok(())
            } else {
                Err(format!("keyring delete `{account}`: {e}").into())
            }
        }
    }
}

/// Prune quarantine entries older than `ttl_days`. Returns a summary of
/// how many items and bytes were removed. `ttl_days = 0` removes everything.
#[tauri::command]
fn prune_quarantine_cmd(
    state: State<'_, AppState>,
    ttl_days: u32,
) -> Result<PruneResult, CommandError> {
    let root = state.quarantine_root.clone();
    let (count, bytes) =
        pinkbin_executor::prune_quarantine(&root, ttl_days).map_err(CommandError::from)?;
    Ok(PruneResult {
        removed_count: count,
        removed_bytes: bytes,
    })
}

#[derive(serde::Serialize, Clone)]
struct PruneResult {
    removed_count: u64,
    removed_bytes: u64,
}

/// Read the last entry from `undo.jsonl`. Returns `None` when the log is
/// empty or missing. The frontend uses this to show "撤销最近一次" with
/// the action's reason and a path hint for where to find deleted files.
/// Skips dry-run entries — the UI only wants to show real operations.
#[tauri::command]
fn last_undo_entry(state: State<'_, AppState>) -> Result<Option<UndoEntry>, CommandError> {
    use std::io::{BufRead, Seek, SeekFrom};
    let path = &state.undo_log;
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string().into()),
    };
    let size = file.metadata().map_err(CommandError::from)?.len();
    let skip = size.saturating_sub(4096);
    file.seek(SeekFrom::Start(skip)).map_err(CommandError::from)?;
    let reader = std::io::BufReader::new(file);
    let mut tail = String::new();
    for line in reader.lines() {
        tail.push_str(&line.map_err(CommandError::from)?);
        tail.push('\n');
    }
    for line in tail.lines().rev() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<UndoEntry>(line) {
            Ok(entry) if !entry.dry_run => return Ok(Some(entry)),
            Ok(_) => continue,
            Err(e) => return Err(format!("undo.jsonl parse error: {e}").into()),
        }
    }
    Ok(None)
}

/// Open the OS recycle bin / trash. On Windows this is
/// `explorer.exe shell:RecycleBinFolder`; on macOS `open ~/.Trash`;
/// on Linux `xdg-open trash:///`. The user can then right-click →
/// restore any file they cleaned via Recycle mode.
#[tauri::command]
fn open_recycle_bin() -> Result<(), CommandError> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("shell:RecycleBinFolder")
            .spawn()
            .map_err(CommandError::from)?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(format!(
                "{}/.Trash",
                std::env::var("HOME").unwrap_or_default()
            ))
            .spawn()
            .map_err(CommandError::from)?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg("trash:///")
            .spawn()
            .map_err(CommandError::from)?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn,pinkbin=info")),
        )
        .with_target(false)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_keyring::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from(".pinkbin"));
            std::fs::create_dir_all(&data_dir).ok();
            let undo_log = data_dir.join("undo.jsonl");
            let quarantine_root = data_dir.join("quarantine");

            // Auto-prune quarantine entries older than 7 days on startup.
            // The disk-cleaner eating its own disk would be embarrassing.
            {
                let qr = quarantine_root.clone();
                if let Ok((count, bytes)) = pinkbin_executor::prune_quarantine(&qr, 7) {
                    if count > 0 {
                        tracing::info!(
                            "startup quarantine prune: removed {} items ({} bytes)",
                            count,
                            bytes
                        );
                    }
                }
            }

            let scaffolds = load_all_scaffolds(app.handle());
            tracing::info!("loaded {} scaffolds", scaffolds.len());

            app.manage(AppState {
                scaffolds: RwLock::new(scaffolds),
                advisor: Mutex::new(None),
                quarantine_root,
                undo_log,
                jobs: Mutex::new(HashMap::new()),
                compiled_scopes: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_path,
            list_scaffolds,
            get_app_version,
            scope_sizes,
            execute_scope,
            execute_plan,
            cancel_job,
            find_scope_for_path,
            list_conda_envs,
            advise,
            reveal_in_explorer,
            set_advisor,
            volume_info,
            list_steam_games,
            list_steam_workshop_items,
            fetch_workshop_titles,
            open_steam_url,
            store_secret,
            load_secret,
            delete_secret,
            prune_quarantine_cmd,
            last_undo_entry,
            open_recycle_bin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn load_all_scaffolds(handle: &AppHandle) -> Vec<Scaffold> {
    use std::collections::HashMap;
    let mut by_id: HashMap<String, Scaffold> = HashMap::new();
    let mut candidates: Vec<PathBuf> = Vec::new();
    // Resource dir takes precedence — packaged scaffolds. Then user override
    // (app_data_dir) — community-contributed scaffolds win over bundled ones
    // with the same id.
    if let Ok(p) = handle.path().resource_dir() {
        candidates.push(p.join("scaffolds"));
    }
    candidates.push(PathBuf::from("scaffolds"));
    candidates.push(PathBuf::from("../../scaffolds"));
    candidates.push(PathBuf::from("../../../scaffolds"));
    if let Ok(p) = handle.path().app_data_dir() {
        candidates.push(p.join("scaffolds"));
    }
    for p in &candidates {
        if !p.exists() {
            continue;
        }
        match load_dir(p) {
            Ok(v) => {
                for s in v {
                    by_id.insert(s.id.clone(), s);
                }
            }
            Err(e) => tracing::warn!("could not load scaffolds from {:?}: {}", p, e),
        }
    }
    // Lowest-priority fallback: if no external source provided a given id,
    // fill it from the compile-time embed. This is what makes the portable
    // raw exe (cwd=Downloads, no resource_dir/scaffolds) usable.
    for f in EMBEDDED_SCAFFOLDS.files() {
        if f.path().extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }
        let Some(text) = f.contents_utf8() else {
            continue;
        };
        match parse_toml(text) {
            Ok(s) => {
                by_id.entry(s.id.clone()).or_insert(s);
            }
            Err(e) => {
                tracing::warn!("embedded scaffold parse error in {:?}: {}", f.path(), e)
            }
        }
    }
    let mut out: Vec<Scaffold> = by_id.into_values().collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Verifies `pinkbin_walker` skips system trash / volume metadata directories
    /// at directory-read time. Without this prune a scope glob with a leading
    /// `**` (literal_separator=false makes `**` cross `/`) can match files
    /// inside `$Recycle.Bin/<SID>/$R*/...` because Windows preserves the
    /// original directory tree there — meaning a "clean WeChat cache" preview
    /// would list files the user already chose to put in the trash.
    #[test]
    fn pinkbin_walker_skips_system_trash_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        let normal = root.join("normal_dir");
        fs::create_dir_all(&normal).unwrap();
        fs::write(normal.join("keep.txt"), b"x").unwrap();

        for trashy in &[
            "$RECYCLE.BIN",
            "System Volume Information",
            ".Trash",
            ".Trashes",
        ] {
            let d = root.join(trashy);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("inside.txt"), b"x").unwrap();
        }

        let mut files: Vec<String> = pinkbin_walker(root)
            .into_iter()
            .flatten()
            .filter(|e| e.file_type().is_file())
            .map(|e| e.path().to_string_lossy().replace('\\', "/"))
            .collect();
        files.sort();

        assert!(
            files.iter().any(|p| p.ends_with("/normal_dir/keep.txt")),
            "walker must still visit non-system dirs, got: {files:?}"
        );
        for trashy in &[
            "$RECYCLE.BIN",
            "System Volume Information",
            ".Trash",
            ".Trashes",
        ] {
            assert!(
                !files.iter().any(|p| p.contains(trashy)),
                "walker leaked into pruned dir `{trashy}`: {files:?}"
            );
        }
    }

    #[test]
    fn pinkbin_walker_prune_is_case_insensitive() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let lower = root.join("$recycle.bin");
        fs::create_dir_all(&lower).unwrap();
        fs::write(lower.join("inside.txt"), b"x").unwrap();

        let leaked = pinkbin_walker(root)
            .into_iter()
            .flatten()
            .any(|e| e.file_type().is_file());
        assert!(
            !leaked,
            "lowercase $recycle.bin variant must also be pruned"
        );
    }
}
