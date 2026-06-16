//! Shared walker and path-filter utilities for Pinkbin's scaffold and scan
//! crates. Consolidates jwalk WalkDir configuration, system-dir pruning,
//! wxid / env-name filtering, and mtime-based retention checks.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

// ── System directory pruning ───────────────────────────────────────────────

/// System-level trash / volume-metadata directory names (lowercase, compared
/// case-insensitively). Any scaffold path scan encountering these skips the
/// entire subtree — Recycle Bin contents are user-preserved and should never
/// be treated as cleanable cache; System Volume Information is VSS / indexing
/// metadata that's both un-cleanable and permission-noisy.
pub const PRUNED_SYSTEM_DIRS: &[&str] = &[
    "$recycle.bin",
    "system volume information",
    ".trash",
    ".trashes",
];

/// Returns `true` if `name` matches a pruned system directory (case-insensitive).
pub fn is_pruned_system_dir(name: &std::ffi::OsStr) -> bool {
    let Some(s) = name.to_str() else { return false };
    let lower = s.to_ascii_lowercase();
    PRUNED_SYSTEM_DIRS.iter().any(|p| *p == lower)
}

// ── Walker builder ─────────────────────────────────────────────────────────

/// Build a `jwalk::WalkDir` with Pinkbin's standard configuration:
/// - Hidden entries are NOT skipped (many app caches use dotted names).
/// - Symbolic links are NOT followed (prevent accidental red-line traversal).
/// - `process_read_dir` prunes system trash / volume-metadata subtrees before
///   jwalk descends into them — this cuts IO and prevents glob collisions with
///   recycle-bin paths.
///
/// The scanner crate's top-level occupancy scan deliberately does NOT use this
/// walker — the user-facing tree there should include Recycle Bin occupancy.
pub fn pinkbin_walker(root: &Path) -> jwalk::WalkDir {
    jwalk::WalkDir::new(root)
        .skip_hidden(false)
        .follow_links(false)
        .process_read_dir(|_, _, _, children| {
            children.retain(|res| {
                let Ok(entry) = res else { return true };
                if !entry.file_type.is_dir() {
                    return true;
                }
                !is_pruned_system_dir(&entry.file_name)
            });
        })
}

// ── Wxid path filter (WeChat) ──────────────────────────────────────────────

/// Returns `true` if `path` passes the wxid (WeChat user) filter.
///
/// When `wxid_filter` is `None` or empty, all paths pass.  Otherwise, any path
/// containing a `wxid_*` component must have that component present in the
/// allow-list.  Paths with no `wxid_*` component pass unconditionally (filters
/// only narrow the targeted layer).
pub fn path_passes_wxid(path: &Path, wxid_filter: Option<&[String]>) -> bool {
    let Some(allowed) = wxid_filter else {
        return true;
    };
    if allowed.is_empty() {
        return true;
    }
    for component in path.components() {
        if let Some(s) = component.as_os_str().to_str() {
            if s.starts_with("wxid_") {
                return allowed.iter().any(|w| w == s);
            }
        }
    }
    true
}

// ── Conda env-name path filter ─────────────────────────────────────────────

/// Returns `true` if `path` passes the conda env-name filter.
///
/// When `env_filter` is `None` or empty, all paths pass.  Otherwise, any path
/// containing an `envs/<name>` segment must have `<name>` present in the
/// allow-list.  Paths with no `envs/` segment pass unconditionally.
pub fn path_passes_env(path: &Path, env_filter: Option<&[String]>) -> bool {
    let Some(allowed) = env_filter else {
        return true;
    };
    if allowed.is_empty() {
        return true;
    }
    let mut comps = path.components().peekable();
    while let Some(c) = comps.next() {
        if let Some(s) = c.as_os_str().to_str() {
            if s.eq_ignore_ascii_case("envs") {
                if let Some(next) = comps.peek() {
                    if let Some(name) = next.as_os_str().to_str() {
                        return allowed.iter().any(|n| n == name);
                    }
                }
                return false;
            }
        }
    }
    true
}

// ── Mtime retention check ──────────────────────────────────────────────────

/// Returns `true` if `metadata`'s modification time is at least `days` old.
/// When `days` is `None`, every file passes (no time-based filtering).
pub fn mtime_older_than(metadata: &std::fs::Metadata, days: Option<u32>) -> bool {
    let Some(d) = days else { return true };
    let Ok(modified) = metadata.modified() else {
        return true;
    };
    let threshold = SystemTime::now()
        .checked_sub(Duration::from_secs(d as u64 * 86_400))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    modified <= threshold
}

// ── Directory-glob resolver ────────────────────────────────────────────────

/// Walk `root` (using `pinkbin_walker`) and return **directories** whose path
/// matches `glob_set`, after pruning any candidate whose ancestor is also
/// matched.  Used by directory-granularity scopes.
///
/// **Why ancestor dedup**: globset uses `literal_separator(false)` so `*`
/// crosses `/`.  A glob like `**/pkgs/*` matches both `pkgs/numpy` AND
/// `pkgs/numpy/info`; dedup keeps only the shallowest match per subtree so
/// the recycle plan touches each logical unit once.  `path == root` is dropped
/// unconditionally — even if a misconfigured glob hits root, recycling the
/// scan root would be catastrophic.
pub fn find_matching_dirs(
    root: &Path,
    glob_set: &globset::GlobSet,
    wxid_filter: Option<&[String]>,
    env_filter: Option<&[String]>,
    older_than_days: Option<u32>,
) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for entry in pinkbin_walker(root).into_iter().flatten() {
        if !entry.file_type().is_dir() {
            continue;
        }
        let path = entry.path();
        if path == root {
            continue;
        }
        if !path_passes_wxid(&path, wxid_filter) || !path_passes_env(&path, env_filter) {
            continue;
        }
        if older_than_days.is_some() {
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if !mtime_older_than(&metadata, older_than_days) {
                continue;
            }
        }
        let path_str = path.to_string_lossy().replace('\\', "/");
        if glob_set.is_match(&path_str) {
            candidates.push(path);
        }
    }

    // Dedup: if a parent was also matched, keep only the shallower path.
    // (Ancestors always appear before descendants in jwalk's DFS order.)
    // Stack-based O(N·D) instead of O(N²): pop paths deeper than current,
    // then check if any remaining path is an ancestor.
    let mut deduped: Vec<PathBuf> = Vec::with_capacity(candidates.len());
    let mut stack: Vec<PathBuf> = Vec::new();
    for c in &candidates {
        let depth = c.components().count();
        while stack.last().map_or(false, |s| s.components().count() >= depth) {
            stack.pop();
        }
        if !stack.iter().any(|s| c.starts_with(s)) {
            deduped.push(c.clone());
            stack.push(c.clone());
        }
    }
    deduped
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn tmp_dir() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "pinkbin-walker-test-{}",
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn prunes_system_dirs() {
        let dir = tmp_dir();
        fs::create_dir_all(dir.join("normal")).unwrap();
        fs::write(dir.join("normal/keep.txt"), b"x").unwrap();
        fs::create_dir_all(dir.join("$RECYCLE.BIN/sub")).unwrap();
        fs::create_dir_all(dir.join("System Volume Information/sub")).unwrap();

        let leaked: Vec<String> = pinkbin_walker(&dir)
            .into_iter()
            .flatten()
            .map(|e| e.path().to_string_lossy().to_string())
            .collect();

        assert!(
            leaked.iter().any(|p| p.contains("normal")),
            "normal dir should appear"
        );
        assert!(
            !leaked.iter().any(|p| p.contains("RECYCLE")),
            "$RECYCLE.BIN must be pruned"
        );
        assert!(
            !leaked.iter().any(|p| p.contains("System Volume Information")),
            "System Volume Information must be pruned"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn path_passes_wxid_allows_unfiltered() {
        let path = Path::new("C:/Users/test/Documents/file.txt");
        assert!(path_passes_wxid(path, None));
        assert!(path_passes_wxid(path, Some(&[])));
    }

    #[test]
    fn path_passes_wxid_filters_by_prefix() {
        let path = Path::new("C:/Users/test/Documents/xwechat_files/wxid_abc/cache/x");
        assert!(path_passes_wxid(path, Some(&["wxid_abc".to_string()])));
        assert!(!path_passes_wxid(path, Some(&["wxid_def".to_string()])));
    }

    #[test]
    fn path_passes_env_allows_unfiltered() {
        let path = Path::new("C:/Users/test/miniconda3/pkgs/cache");
        assert!(path_passes_env(path, None));
        assert!(path_passes_env(path, Some(&[])));
    }

    #[test]
    fn path_passes_env_filters_envs() {
        let path = Path::new("C:/Users/test/miniconda3/envs/tf-2.0/python.exe");
        assert!(path_passes_env(path, Some(&["tf-2.0".to_string()])));
        assert!(!path_passes_env(path, Some(&["torch-2.0".to_string()])));
    }

    #[test]
    fn mtime_none_passes_all() {
        let meta = std::fs::metadata(".").unwrap();
        assert!(mtime_older_than(&meta, None));
    }

    #[test]
    fn is_pruned_system_dir_case_insensitive() {
        assert!(is_pruned_system_dir(std::ffi::OsStr::new("$Recycle.Bin")));
        assert!(is_pruned_system_dir(std::ffi::OsStr::new(".Trashes")));
        assert!(!is_pruned_system_dir(std::ffi::OsStr::new("normal_dir")));
    }
}