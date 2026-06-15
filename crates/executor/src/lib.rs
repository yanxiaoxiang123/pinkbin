//! Performs cleanup actions safely. Recycle (default), quarantine, or permanent delete.
//! Every action is appended to `undo.jsonl`.
//!
//! Before any destructive operation, each path is probed via `probe()` to detect
//! symlinks, mount points, read-only attributes, and missing files — so the
//! action logic can choose the correct removal strategy and produce clear errors.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ── File attributes (probe result) ─────────────────────────────────────────

/// Attributes discovered by probing a path **without** following symlinks.
/// Used by `execute` to choose the correct removal strategy.
#[derive(Debug, Clone, Default)]
pub struct FileAttributes {
    /// Path is a symbolic link.
    pub is_symlink: bool,
    /// Only meaningful when `is_symlink`: whether the symlink target is a dir.
    pub symlink_target_is_dir: bool,
    /// Path is on a different device/volume than its parent directory.
    pub is_mount_point: bool,
    /// Number of hard links (0 = unknown on this platform, 1 = single link).
    pub hard_link_count: u64,
    /// File or directory has the read-only attribute set.
    pub is_read_only: bool,
    /// Path does not exist (symlink_metadata failed).
    pub is_missing: bool,
    /// Path is a directory (not a symlink to a dir — that's `is_symlink`).
    pub is_dir: bool,
    /// Path is a regular file.
    pub is_file: bool,
}

/// Probe `path` and return its attributes without following symlinks.
///
/// * Symlink detection — uses `symlink_metadata` to never cross link boundaries.
/// * Mount point detection — compares device IDs (Unix) or falls back to
///   comparing volume serial numbers (Windows).
/// * Read-only — checks the file-permissions readonly flag.
/// * Hard-link count — uses `st_nlink` on Unix; 0 on platforms where it is
///   not trivially available (callers should treat 0 as "unknown").
pub fn probe(path: &Path) -> FileAttributes {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => {
            return FileAttributes {
                is_missing: true,
                ..Default::default()
            };
        }
    };

    let is_symlink = meta.file_type().is_symlink();
    let symlink_target_is_dir = if is_symlink {
        path.read_link()
            .ok()
            .and_then(|t| std::fs::metadata(&t).ok())
            .map(|m| m.is_dir())
            .unwrap_or(false)
    } else {
        false
    };

    let is_dir = meta.is_dir();
    let is_file = meta.is_file();
    let is_read_only = meta.permissions().readonly();

    // ── Hard link count ──
    #[cfg(unix)]
    let hard_link_count = {
        use std::os::unix::fs::MetadataExt;
        meta.nlink() as u64
    };
    #[cfg(not(unix))]
    let hard_link_count = 0u64;

    // ── Mount point check ──
    let is_mount_point = if is_dir {
        #[cfg(windows)]
        {
            // Treat as a volume/reparse boundary in two cases:
            //   1. Path has no parent (e.g. `C:\`). The old ancestor-root
            //      heuristic only caught this on Windows.
            //   2. Path is a reparse point whose tag is NOT
            //      `IO_REPARSE_TAG_SYMLINK` or `IO_REPARSE_TAG_MOUNT_POINT`
            //      — i.e. OneDrive placeholders (`IO_REPARSE_TAG_CLOUD`),
            //      VHD mounts, `subst` mappings, app-specific tags, etc.
            //      These cross volume or cloud boundaries; operating on
            //      them via Recycle would cascade-delete (the OneDrive
            //      client syncs the local tombstone to the cloud). Symlinks
            //      and junctions are excluded because execute()'s
            //      `is_symlink` branch unlinks them safely (the target
            //      is untouched).
            //
            // Note: Rust's `FileType::is_symlink()` on Windows returns
            // `true` for every reparse point (it checks the bit, not the
            // tag), so we cannot use it to filter — we read the tag
            // directly via `reparse_tag` + `is_unsafe_reparse_tag`.
            let unsafe_reparse = reparse_tag(path).is_some_and(is_unsafe_reparse_tag);
            path.parent().is_none() || unsafe_reparse
        }
        #[cfg(unix)]
        {
            if let Some(parent) = path.parent() {
                if let Ok(pmeta) = std::fs::symlink_metadata(parent) {
                    use std::os::unix::fs::MetadataExt;
                    meta.dev() != pmeta.dev()
                } else {
                    false
                }
            } else {
                true
            }
        }
        #[cfg(not(any(unix, windows)))]
        {
            if let Some(parent) = path.parent() {
                if let Ok(_pmeta) = std::fs::symlink_metadata(parent) {
                    let my_root = path.ancestors().last().unwrap_or(path);
                    let parent_root = parent.ancestors().last().unwrap_or(parent);
                    my_root != parent_root
                } else {
                    false
                }
            } else {
                true
            }
        }
    } else {
        false
    };

    FileAttributes {
        is_symlink,
        symlink_target_is_dir,
        is_mount_point,
        hard_link_count,
        is_read_only,
        is_missing: false,
        is_dir,
        is_file,
    }
}

/// Check if a file appears to be locked by another process.
///
/// On Windows this attempts to open the file with exclusive write access and
/// checks for `ERROR_SHARING_VIOLATION` (32).  On Unix this is a no-op that
/// always returns `false` because Unix advisory locks are not mandatory.
#[cfg(windows)]
pub fn is_file_in_use(path: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    if !meta.is_file() {
        return false;
    }
    matches!(
        std::fs::OpenOptions::new()
            .write(true)
            .share_mode(0) // exclusive — no sharing
            .create(false)
            .open(path),
        Err(ref e) if e.raw_os_error() == Some(32) // ERROR_SHARING_VIOLATION
    )
}

#[cfg(not(windows))]
pub fn is_file_in_use(_path: &Path) -> bool {
    false
}

/// On Windows, return the reparse-point tag for `path`, or `None` if the
/// path is missing, not a reparse point, or the lookup fails. The tag
/// distinguishes safe-to-unlink reparse points (symlinks with
/// `IO_REPARSE_TAG_SYMLINK`, junctions with `IO_REPARSE_TAG_MOUNT_POINT`)
/// from cascade-delete hazards (OneDrive placeholders, VHD mounts, `subst`
/// mappings, app-specific tags). The caller is expected to treat anything
/// that is `Some(_)` other than the two safe tags as a mount-point /
/// volume boundary.
#[cfg(windows)]
fn reparse_tag(path: &Path) -> Option<u32> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::Storage::FileSystem::{FindClose, FindFirstFileW, WIN32_FIND_DATAW};
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut find_data: WIN32_FIND_DATAW = unsafe { std::mem::zeroed() };
    // SAFETY: `wide` is a NUL-terminated UTF-16 path; `find_data` is a
    // valid out-param. `FindFirstFileW` writes to it and returns a
    // search handle or `INVALID_HANDLE_VALUE`.
    let handle = unsafe { FindFirstFileW(wide.as_ptr(), &mut find_data) };
    if handle == INVALID_HANDLE_VALUE {
        return None;
    }
    // Close the search handle regardless of outcome.
    unsafe {
        let _ = FindClose(handle);
    }
    if (find_data.dwFileAttributes & 0x400) == 0 {
        return None;
    }
    Some(find_data.dwReserved0)
}

#[cfg(not(windows))]
fn reparse_tag(_path: &Path) -> Option<u32> {
    None
}

/// Classify a Windows reparse-point tag. Returns `true` for tags that
/// represent a cross-boundary link (OneDrive placeholder, VHD mount, `subst`,
/// app-specific) — operating on those is unsafe because removal can
/// cascade across volume or cloud. Returns `false` for "safe" reparse
/// points where unlinking the path only removes the link, leaving the
/// target intact: regular symlinks and junctions.
#[cfg(windows)]
fn is_unsafe_reparse_tag(tag: u32) -> bool {
    const IO_REPARSE_TAG_SYMLINK: u32 = 0xA000_000C;
    const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;
    tag != IO_REPARSE_TAG_SYMLINK && tag != IO_REPARSE_TAG_MOUNT_POINT
}

#[cfg(not(windows))]
fn is_unsafe_reparse_tag(_tag: u32) -> bool {
    false
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Recycle,
    Quarantine,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub action: Action,
    pub paths: Vec<PathBuf>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoEntry {
    pub timestamp: String,
    pub action: Action,
    pub source: PathBuf,
    pub destination: Option<PathBuf>,
    pub reason: String,
}

pub fn execute(
    plan: &Plan,
    dry_run: bool,
    undo_log: &Path,
    quarantine_root: &Path,
) -> anyhow::Result<Vec<UndoEntry>> {
    let mut out: Vec<UndoEntry> = Vec::new();
    let now = || chrono::Utc::now().to_rfc3339();

    if dry_run {
        for p in &plan.paths {
            out.push(UndoEntry {
                timestamp: now(),
                action: plan.action,
                source: p.clone(),
                destination: None,
                reason: format!("dry-run: {}", plan.reason),
            });
        }
        write_log_atomic(undo_log, &out)?;
        return Ok(out);
    }

    match plan.action {
        Action::Recycle => {
            // Per-path: trash one, log one. Each log entry must correspond to a
            // path that is actually in the recycle bin — otherwise the
            // "undo/restore" button would point at files that don't exist.
            // `trash::delete` is atomic at the single-path level; a failure
            // here means the file is still on disk, so we skip the log entry.
            //
            // The mount-point check is the same one Quarantine / Delete use:
            // it catches junctions, OneDrive placeholders, and `subst` mounts.
            // Without it, `trash::delete` on a OneDrive placeholder would
            // mark the file deleted locally — and the OneDrive client would
            // then propagate that tombstone to the cloud, turning a local
            // recycle into a permanent cross-device data loss.
            for src in &plan.paths {
                let attrs = probe(src);
                if attrs.is_missing {
                    tracing::warn!("recycle: path not found, skipping {:?}", src);
                    continue;
                }
                if attrs.is_mount_point {
                    anyhow::bail!(
                        "refusing to recycle mount point / reparse point: {:?}",
                        src
                    );
                }
                if let Err(e) = trash::delete(src) {
                    tracing::warn!("recycle: failed to trash {:?}: {e}", src);
                    continue;
                }
                let entry = UndoEntry {
                    timestamp: now(),
                    action: Action::Recycle,
                    source: src.clone(),
                    destination: None,
                    reason: plan.reason.clone(),
                };
                append_log_atomic(undo_log, &entry)?;
                out.push(entry);
            }
        }
        Action::Quarantine => {
            std::fs::create_dir_all(quarantine_root)?;
            for src in &plan.paths {
                let attrs = probe(src);
                if attrs.is_missing {
                    tracing::warn!("quarantine: path not found, skipping {:?}", src);
                    continue;
                }
                if attrs.is_mount_point {
                    anyhow::bail!(
                        "refusing to quarantine mount point: {:?}", src
                    );
                }
                // Clear read-only so the rename/copy can succeed.
                if attrs.is_read_only {
                    let mut perms = std::fs::symlink_metadata(src)?.permissions();
                    perms.set_readonly(false);
                    std::fs::set_permissions(src, perms)?;
                }
                let stamp = chrono::Utc::now().timestamp_millis();
                let leaf = src
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "item".into());
                let mut dst = quarantine_root.join(format!("{stamp}-{leaf}"));
                // Collision guard: same millisecond + same filename → append counter.
                if dst.exists() {
                    for i in 2u64.. {
                        dst = quarantine_root.join(format!("{stamp}-{i}-{leaf}"));
                        if !dst.exists() {
                            break;
                        }
                    }
                }
                if let Err(e) = std::fs::rename(src, &dst) {
                    tracing::warn!("rename failed ({}); falling back to copy+remove", e);
                    copy_then_remove(src, &dst)?;
                }
                out.push(UndoEntry {
                    timestamp: now(),
                    action: Action::Quarantine,
                    source: src.clone(),
                    destination: Some(dst),
                    reason: plan.reason.clone(),
                });
                append_log_atomic(undo_log, out.last().unwrap())?;
            }
        }
        Action::Delete => {
            for p in &plan.paths {
                let attrs = probe(p);
                if attrs.is_missing {
                    tracing::warn!("delete: path not found, skipping {:?}", p);
                    continue;
                }
                // Mount-point / reparse-point check must come BEFORE the
                // symlink branch: Rust's `FileType::is_symlink()` returns
                // `true` for every reparse point (it checks the bit, not
                // the tag), so an OneDrive placeholder would otherwise be
                // classified as a symlink and unlinked via `remove_dir` —
                // the local tombstone would then propagate to the cloud.
                if attrs.is_mount_point {
                    anyhow::bail!(
                        "refusing to delete mount point / reparse point: {:?}",
                        p
                    );
                }
                if attrs.is_symlink {
                    // Unlink the symlink itself, never follow to the target.
                    if attrs.symlink_target_is_dir {
                        std::fs::remove_dir(p)?;
                    } else {
                        std::fs::remove_file(p)?;
                    }
                } else {
                    if attrs.is_read_only {
                        let mut perms = std::fs::symlink_metadata(p)?.permissions();
                        perms.set_readonly(false);
                        std::fs::set_permissions(p, perms)?;
                    }
                    if attrs.is_dir {
                        std::fs::remove_dir_all(p)?;
                    } else {
                        std::fs::remove_file(p)?;
                    }
                }
                out.push(UndoEntry {
                    timestamp: now(),
                    action: Action::Delete,
                    source: p.clone(),
                    destination: None,
                    reason: plan.reason.clone(),
                });
                append_log_atomic(undo_log, out.last().unwrap())?;
            }
        }
    }

    Ok(out)
}

fn write_log_atomic(undo_log: &Path, entries: &[UndoEntry]) -> anyhow::Result<()> {
    if entries.is_empty() {
        return Ok(());
    }
    if let Some(parent) = undo_log.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let parent = undo_log.parent().unwrap_or_else(|| Path::new("."));
    let existing = std::fs::read(undo_log).unwrap_or_default();
    let mut buf: Vec<u8> = Vec::with_capacity(existing.len() + entries.len() * 128);
    buf.extend_from_slice(&existing);
    for e in entries {
        buf.extend_from_slice(serde_json::to_string(e)?.as_bytes());
        buf.push(b'\n');
    }
    let tmp = tempfile::Builder::new()
        .prefix(".undo.jsonl.")
        .suffix(".tmp")
        .tempfile_in(parent)?;
    std::fs::write(tmp.path(), &buf)?;
    // `persist` is a rename within the same directory, which is atomic on
    // POSIX and on NTFS within a volume. A crash mid-rename leaves either
    // the old log or the new log intact — never a truncated/partial file.
    if let Err(e) = tmp.persist(undo_log) {
        return Err(anyhow::anyhow!(
            "failed to atomically replace undo log: {e}"
        ));
    }
    Ok(())
}

fn append_log_atomic(undo_log: &Path, entry: &UndoEntry) -> anyhow::Result<()> {
    write_log_atomic(undo_log, std::slice::from_ref(entry))
}

fn copy_then_remove(src: &Path, dst: &Path) -> std::io::Result<()> {
    // Bail if destination already exists — otherwise a crash between copy and
    // remove would leave orphaned data without a way to recover.
    if dst.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("quarantine target already exists: {}", dst.display()),
        ));
    }
    if src.is_dir() {
        copy_dir_recursive(src, dst)?;
        std::fs::remove_dir_all(src)?;
    } else {
        std::fs::copy(src, dst)?;
        std::fs::remove_file(src)?;
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let p = entry.path();
        let d = dst.join(entry.file_name());
        if p.is_dir() {
            copy_dir_recursive(&p, &d)?;
        } else {
            std::fs::copy(&p, &d)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_dir() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "pinkbin-executor-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn dry_run_returns_entries_without_touching_disk() {
        let dir = tmp_dir();
        let file = dir.join("keep.txt");
        fs::write(&file, b"data").unwrap();

        let plan = Plan {
            action: Action::Delete,
            paths: vec![file.clone()],
            reason: "test".into(),
        };
        let log = dir.join("undo.jsonl");
        let out = execute(&plan, true, &log, &dir).unwrap();

        // Dry-run entries are returned.
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].source, file);
        // File must NOT have been deleted.
        assert!(file.exists(), "dry run deleted the file");
        // Log must exist with valid JSONL.
        assert!(log.exists(), "dry run did not write log");
        let content = fs::read_to_string(&log).unwrap();
        assert!(!content.is_empty(), "dry run log is empty");
        let entry: UndoEntry = serde_json::from_str(content.trim()).unwrap();
        assert_eq!(entry.action, Action::Delete);
        assert!(entry.reason.contains("dry-run"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn quarantine_uses_timestamp_to_avoid_name_conflict() {
        let dir = tmp_dir();
        let quar = dir.join("quarantine");
        let src = dir.join("item.txt");
        fs::write(&src, b"data").unwrap();

        let plan = Plan {
            action: Action::Quarantine,
            paths: vec![src.clone()],
            reason: "test".into(),
        };
        let log = dir.join("undo.jsonl");
        let _ = execute(&plan, false, &log, &quar).unwrap();

        // Item should be moved into quarantine with a timestamp prefix.
        assert!(!src.exists(), "source still exists after quarantine");
        let quar_entries: Vec<_> = fs::read_dir(&quar).unwrap().collect();
        assert_eq!(quar_entries.len(), 1, "expected one quarantined item");
        let quar_name = quar_entries[0]
            .as_ref()
            .unwrap()
            .file_name()
            .to_string_lossy()
            .to_string();
        assert!(
            quar_name.contains("item.txt"),
            "quarantine name should preserve original name: {quar_name}"
        );
        // Verify undo log.
        let content = fs::read_to_string(&log).unwrap();
        let entry: UndoEntry = serde_json::from_str(content.trim()).unwrap();
        assert_eq!(entry.action, Action::Quarantine);
        assert!(entry.destination.is_some());
        // Second quarantine of the same source must not conflict.
        fs::write(&src, b"data2").unwrap();
        let plan2 = Plan {
            action: Action::Quarantine,
            paths: vec![src.clone()],
            reason: "test2".into(),
        };
        let _ = execute(&plan2, false, &log, &quar).unwrap();
        let quar_entries: Vec<_> = fs::read_dir(&quar).unwrap().collect();
        assert_eq!(quar_entries.len(), 2, "timestamp dedup failed");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(unix)]
    fn symlink_to_dir_is_unlinked_not_content_deleted() {
        let dir = tmp_dir();
        let target = dir.join("target");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("secret.txt"), b"sensitive").unwrap();
        let link = dir.join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let plan = Plan {
            action: Action::Delete,
            paths: vec![link.clone()],
            reason: "test".into(),
        };
        let log = dir.join("undo.jsonl");
        let _ = execute(&plan, false, &log, &dir).unwrap();

        // Symlink itself must be gone.
        assert!(!link.exists(), "symlink not removed");
        // Target directory must survive.
        assert!(target.exists(), "symlink target was deleted");
        assert!(
            target.join("secret.txt").exists(),
            "file inside symlink target was deleted"
        );
        // Undo log recorded Delete with the symlink path, not the target.
        let content = fs::read_to_string(&log).unwrap();
        let entry: UndoEntry = serde_json::from_str(content.trim()).unwrap();
        assert_eq!(entry.source, link);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn undo_log_is_valid_jsonl() {
        let dir = tmp_dir();
        let file = dir.join("a.txt");
        fs::write(&file, b"hello").unwrap();
        let log = dir.join("undo.jsonl");

        let plan = Plan {
            action: Action::Delete,
            paths: vec![file],
            reason: "jsonl test".into(),
        };
        let _ = execute(&plan, false, &log, &dir).unwrap();

        let content = fs::read_to_string(&log).unwrap();
        for (i, line) in content.lines().enumerate() {
            let entry: Result<UndoEntry, _> = serde_json::from_str(line);
            assert!(entry.is_ok(), "line {} is not valid JSONL: {line}", i + 1);
        }

        let _ = fs::remove_dir_all(&dir);
    }

    /// Regression test for the Recycle branch rewrite: each successful trash
    /// must produce exactly one log entry, and the log must remain valid
    /// JSONL across multiple per-path appends. This exercises the atomic
    /// tempfile+rename path without depending on the OS recycle bin.
    #[test]
    fn append_log_atomic_preserves_entries_across_calls() {
        let dir = tmp_dir();
        let log = dir.join("undo.jsonl");
        assert!(!log.exists(), "log should not exist yet");

        let entries: Vec<UndoEntry> = (0..3)
            .map(|i| UndoEntry {
                timestamp: format!("2026-06-15T00:00:0{i}Z"),
                action: Action::Recycle,
                source: dir.join(format!("file-{i}.txt")),
                destination: None,
                reason: format!("entry {i}"),
            })
            .collect();

        for e in &entries {
            append_log_atomic(&log, e).unwrap();
        }

        // No stale tempfiles should be left behind.
        let stale: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|r| r.ok())
            .filter(|e| {
                let n = e.file_name();
                let s = n.to_string_lossy();
                s.starts_with(".undo.jsonl.") && s.ends_with(".tmp")
            })
            .collect();
        assert!(stale.is_empty(), "tempfile leaked: {stale:?}");

        let content = fs::read_to_string(&log).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), entries.len(), "entry count mismatch");

        for (i, line) in lines.iter().enumerate() {
            let parsed: UndoEntry = serde_json::from_str(line)
                .unwrap_or_else(|e| panic!("line {i} not valid JSONL: {e} ({line})"));
            assert_eq!(parsed.source, entries[i].source);
            assert_eq!(parsed.reason, entries[i].reason);
            assert_eq!(parsed.action, Action::Recycle);
        }

        let _ = fs::remove_dir_all(&dir);
    }

    /// Regression test for the OneDrive cascade-delete bug: Windows
    /// reparse points (junctions, OneDrive placeholders, subst mappings)
    /// used to look like ordinary directories to `probe()`. The Recycle
    /// branch must now refuse to trash them — otherwise the OneDrive
    /// client would sync the local tombstone to the cloud.
    #[cfg(windows)]
    #[test]
    fn safe_reparse_junction_is_not_a_mount_point() {
        // `C:\Documents and Settings` is a system-installed junction to
        // `C:\Users` on every modern Windows install. Its reparse tag is
        // `IO_REPARSE_TAG_MOUNT_POINT` (0xA000_0003) — that's a "safe"
        // reparse point: unlinking the junction leaves the target intact.
        // Therefore it must NOT be classified as a mount point, otherwise
        // the executor would refuse to remove real symlinks (which share
        // the same Rust `is_symlink()` semantics — that check returns
        // true for every reparse point, regardless of tag).
        let junction = Path::new(r"C:\Documents and Settings");
        if !junction.exists() {
            eprintln!("skipping: system junction not present");
            return;
        }
        // Sanity-check the precondition.
        let tag = reparse_tag(junction);
        assert_eq!(
            tag,
            Some(0xA000_0003),
            "expected IO_REPARSE_TAG_MOUNT_POINT, got {tag:?}"
        );
        let attrs = probe(junction);
        assert!(
            !attrs.is_mount_point,
            "junction (MOUNT_POINT tag) must NOT be a mount point \
             (would bail on every real symlink); is_symlink={}",
            attrs.is_symlink
        );
    }

    #[cfg(windows)]
    #[test]
    fn unsafe_reparse_tag_is_treated_as_mount_point() {
        // We can't easily synthesize a OneDrive placeholder in a unit
        // test, so exercise the mount-point logic against a synthetic
        // reparse tag instead. This locks in the rule:
        // "any reparse tag that is not SYMLINK or MOUNT_POINT → mount point".
        for (tag, expected_mount_point) in [
            (0xA000_000Cu32, false), // IO_REPARSE_TAG_SYMLINK
            (0xA000_0003u32, false), // IO_REPARSE_TAG_MOUNT_POINT (junction)
            (0x9000_001Au32, true),  // IO_REPARSE_TAG_CLOUD (OneDrive)
            (0x8000_0013u32, true),  // IO_REPARSE_TAG_DEDUP
            (0xDEAD_BEEFu32, true),  // arbitrary / app-specific
        ] {
            let reparse = is_unsafe_reparse_tag(tag);
            assert_eq!(
                reparse, expected_mount_point,
                "tag 0x{tag:08x} classification wrong"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn volume_root_is_mount_point() {
        // `C:\` is the canonical volume root. Even though it has no
        // FILE_ATTRIBUTE_REPARSE_POINT, the no-parent branch must catch it.
        let attrs = probe(Path::new(r"C:\"));
        assert!(attrs.is_mount_point, "C:\\ must be a mount point");
    }

    #[test]
    fn regular_directory_is_not_mount_point() {
        let dir = tmp_dir();
        let sub = dir.join("regular");
        fs::create_dir(&sub).unwrap();
        let attrs = probe(&sub);
        assert!(
            !attrs.is_mount_point,
            "ordinary dir {} was misclassified as mount point",
            sub.display()
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
