//! Shared test helpers for scaffold safety tests.
//!
//! Each integration test in `tests/<id>_safety.rs` can use these via
//! `mod test_utils;` (Rust treats each file in `tests/` as a binary,
//! so `test_utils.rs` serves as a shared module within each binary).

use std::path::PathBuf;

/// Root of the workspace (three levels up from `crates/scaffold/tests/`).
pub fn workspace_root() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.pop();
    p
}

/// Parse a scaffold TOML file from its path relative to workspace root.
pub fn load_scaffold<P: AsRef<std::path::Path>>(path: P) -> pinkbin_scaffold::Scaffold {
    let full = workspace_root().join(&path);
    let text = std::fs::read_to_string(&full).unwrap_or_else(|e| panic!("read {:?}: {e}", full));
    toml::from_str(&text).unwrap_or_else(|e| panic!("parse {:?}: {e}", full))
}

/// Build a single-pattern GlobSet (no env expansion).
pub fn build_set(pattern: &str) -> globset::GlobSet {
    let g = globset::GlobBuilder::new(pattern)
        .literal_separator(false)
        .case_insensitive(true)
        .build()
        .unwrap_or_else(|e| panic!("bad glob `{pattern}`: {e}"));
    let mut b = globset::GlobSetBuilder::new();
    b.add(g);
    b.build().unwrap()
}

/// Mirror scaffold::expand_env for `%VAR%`-style env substitution.
pub fn expand(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let Some(end) = bytes[i + 1..].iter().position(|&b| b == b'%') {
                let var = std::str::from_utf8(&bytes[i + 1..i + 1 + end]).unwrap_or("");
                if let Ok(v) = std::env::var(var) {
                    out.push_str(&v.replace('\\', "/"));
                    i += end + 2;
                    continue;
                }
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// Return scope ids whose glob matches `path`.
pub fn matching_scopes<'a>(
    scopes: &'a [(String, globset::GlobSet)],
    path: &str,
) -> Vec<&'a str> {
    scopes
        .iter()
        .filter_map(|(id, gs)| {
            if gs.is_match(path) {
                Some(id.as_str())
            } else {
                None
            }
        })
        .collect()
}