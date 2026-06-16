//! Scaffold linter — checks TOML syntax, glob validity, redline compliance, and
//! duplicate IDs. Exposes `lint_scaffold_path` / `lint_scaffold_text` for use
//! from both the CLI binary and programmatic callers (e.g. scaffold loading).

use std::path::Path;

pub use pinkbin_scaffold::Scaffold;

// ── Diagnostics ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone)]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    /// Human-readable location (file path, scope id, etc.).
    pub location: Option<String>,
}

impl Diagnostic {
    pub fn error(msg: impl Into<String>) -> Self {
        Diagnostic {
            severity: Severity::Error,
            message: msg.into(),
            location: None,
        }
    }
    pub fn warn(msg: impl Into<String>) -> Self {
        Diagnostic {
            severity: Severity::Warning,
            message: msg.into(),
            location: None,
        }
    }
    pub fn at(mut self, loc: impl Into<String>) -> Self {
        self.location = Some(loc.into());
        self
    }
}

// ── Redline patterns ───────────────────────────────────────────────────────

/// Redline path segments that scope globs must not match (CLAUDE.md Hard rule #1).
pub const REDLINE_SUBSTRINGS: &[&str] = &[
    "*.db",
    "*.db-wal",
    "*.db-shm",
    "db_storage",
    "/Msg/",
    "/MultiMsg/",
    "/Accounts/",
    "/All Users/",
    "/login/",
    "/config/",
    "/Favorite",
    "/Fav/",
    "/key/",
    "/crypto/",
];

/// Synthetic fixture paths that represent redline content. A scope glob must
/// not match any of these. Derived from REDLINE_SUBSTRINGS so the two stay in
/// sync. Each path is designed to be unambiguously "redline" — a glob that
/// matches it is almost certainly too broad.
fn redline_fixture_paths() -> Vec<&'static str> {
    vec![
        // *.db / *.db-wal / *.db-shm
        "C:/Users/u/Documents/WeChat Files/wxid_x/Msg/MicroMsg.db",
        "C:/Users/u/Documents/WeChat Files/wxid_x/Msg/MicroMsg.db-wal",
        "C:/Users/u/Documents/WeChat Files/wxid_x/Msg/MicroMsg.db-shm",
        // db_storage
        "C:/Users/u/Documents/xwechat_files/wxid_x/db_storage/foo.db",
        // /Msg/ (WeChat 3.x chat data)
        "C:/Users/u/Documents/WeChat Files/wxid_x/Msg/Media/voice.amr",
        // /MultiMsg/
        "C:/Users/u/Documents/WeChat Files/wxid_x/MultiMsg/backup.dat",
        // /Accounts/
        "C:/Users/u/AppData/Roaming/Tencent/WeChat/Accounts/acc.dat",
        // /All Users/
        "C:/Users/u/Documents/WeChat Files/All Users/config.ini",
        // /login/
        "C:/Users/u/AppData/Roaming/Tencent/WeChat/login/session.dat",
        // /config/
        "C:/Users/u/AppData/Roaming/Tencent/xwechat/config/app.conf",
        // /Favorite
        "C:/Users/u/Documents/WeChat Files/wxid_x/Favorite/fav.dat",
        // /Fav/
        "C:/Users/u/Documents/WeChat Files/wxid_x/Fav/item.dat",
        // /key/
        "C:/Users/u/AppData/Roaming/Tencent/key/private.pem",
        // /crypto/
        "C:/Users/u/AppData/Roaming/Tencent/crypto/aes.bin",
    ]
}

/// Compile the scope glob and test it against every redline fixture path.
/// Returns the fixture paths that matched (i.e. the scope would touch redline
/// content). Empty vec means safe.
pub fn check_redlines(pattern: &str) -> Vec<&'static str> {
    let glob = match globset::GlobBuilder::new(pattern)
        .literal_separator(false)
        .case_insensitive(true)
        .build()
    {
        Ok(g) => g,
        Err(_) => return vec![], // invalid glob already caught by syntax check
    };
    let matcher = glob.compile_matcher();
    redline_fixture_paths()
        .into_iter()
        .filter(|fixture| matcher.is_match(fixture))
        .collect()
}

// ── Lint entry points ──────────────────────────────────────────────────────

/// Read `path`, parse as TOML, and run all lint checks. Returns a possibly
/// empty vector of diagnostics.
pub fn lint_scaffold_path(path: &Path) -> Vec<Diagnostic> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => return vec![Diagnostic::error(format!("cannot read {path:?}: {e}"))],
    };
    lint_scaffold_text(&text, &path.to_string_lossy())
}

/// Parse TOML `text` (identified by `source`, e.g. a file path) and run all
/// lint checks. Returns a possibly empty vector of diagnostics.
pub fn lint_scaffold_text(text: &str, source: &str) -> Vec<Diagnostic> {
    let mut diags: Vec<Diagnostic> = Vec::new();

    let scaffold = match toml::from_str::<Scaffold>(text) {
        Ok(s) => s,
        Err(e) => {
            diags.push(Diagnostic::error(format!("parse error: {e}")).at(source));
            return diags;
        }
    };

    // ── Detect patterns ──
    for (i, d) in scaffold.detect.iter().enumerate() {
        let label = format!("detect[{i}]");
        diags.extend(lint_glob(d, &label, source));
    }

    // ── Scope globs ──
    for sc in &scaffold.scopes {
        let label = format!("scope[{}]", sc.id);
        diags.extend(lint_glob(&sc.glob, &label, source));
    }

    // ── Empty scopes ──
    if scaffold.scopes.is_empty() {
        diags.push(Diagnostic::warn("no scopes defined").at(source));
    }

    // ── Duplicate scope IDs ──
    {
        let mut seen = std::collections::HashSet::new();
        for sc in &scaffold.scopes {
            if !seen.insert(&sc.id) {
                diags.push(
                    Diagnostic::error(format!("duplicate scope id `{}`", sc.id)).at(source),
                );
            }
        }
    }

    // ── Variant consistency ──
    // If scopes use `variant`, each variant value must have at least one
    // distinguishable detect pattern or name_contains entry — otherwise the
    // scope is a "ghost" (always shown in UI but never matched).
    {
        let variants: std::collections::HashSet<&str> = scaffold
            .scopes
            .iter()
            .filter_map(|sc| sc.variant.as_deref())
            .collect();
        if variants.len() > 1 {
            let detect_lc: Vec<String> = scaffold
                .detect
                .iter()
                .map(|d| d.to_lowercase())
                .collect();
            let name_contains_lc: Vec<String> = scaffold
                .matcher
                .name_contains
                .iter()
                .map(|n| n.to_lowercase())
                .collect();
            for v in &variants {
                let v_lower = v.to_lowercase();
                let has_detect = detect_lc
                    .iter()
                    .any(|d| d.contains(&v_lower));
                let has_name = name_contains_lc
                    .iter()
                    .any(|n| n.contains(&v_lower));
                if !has_detect && !has_name {
                    diags.push(Diagnostic::warn(format!(
                        "variant `{v}` has no distinguishing detect pattern or name_contains entry — \
                         scopes with this variant may never be matched"
                    )).at(source));
                }
            }
        }
    }

    diags
}

// ── Individual checks ──────────────────────────────────────────────────────

fn lint_glob(pattern: &str, label: &str, source: &str) -> Vec<Diagnostic> {
    let mut diags: Vec<Diagnostic> = Vec::new();

    // Syntax check.
    if let Err(e) = check_glob_syntax(pattern) {
        diags.push(
            Diagnostic::error(format!("invalid glob {pattern:?}: {e}"))
                .at(format!("{source} {label}")),
        );
    }

    // Redline check — now uses glob matching against fixture paths instead of
    // substring contains, so patterns like `**/*.db?` can't sneak past.
    let red_hits = check_redlines(pattern);
    for fixture in red_hits {
        diags.push(
            Diagnostic::error(format!(
                "glob matches redline fixture `{fixture}` (CLAUDE.md rule #1)"
            ))
            .at(format!("{source} {label}")),
        );
    }

    diags
}

/// Compile a glob pattern, returning Ok(()) on success.
pub fn check_glob_syntax(pattern: &str) -> Result<(), globset::Error> {
    globset::GlobBuilder::new(pattern)
        .literal_separator(false)
        .case_insensitive(true)
        .build()?;
    Ok(())
}

// ── Mock generation ────────────────────────────────────────────────────────

/// Generate a TypeScript `SCAFFOLDS` array from a list of parsed scaffolds.
/// The output is valid TS that can replace the `SCAFFOLDS` export in `mocks.ts`.
pub fn emit_mock_ts(scaffolds: &[Scaffold]) -> String {
    let mut out = String::new();
    out.push_str("export const SCAFFOLDS: Scaffold[] = [\n");
    for s in scaffolds {
        out.push_str("  {\n");
        out.push_str(&format!("    id: {},\n", ts_str(&s.id)));
        out.push_str(&format!("    name: {},\n", ts_str(&s.name)));
        out.push_str(&format!(
            "    risk: {},\n",
            ts_str(&format!("{:?}", s.risk).to_lowercase())
        ));
        out.push_str(&format!("    disclaimer: {},\n", ts_str(&s.disclaimer)));
        out.push_str(&format!("    detect: {},\n", ts_str_vec(&s.detect)));
        // match block
        if s.matcher.name_contains.is_empty() && s.matcher.must_have_child.is_empty() {
            out.push_str("    match: {},\n");
        } else {
            out.push_str("    match: { ");
            if !s.matcher.name_contains.is_empty() {
                out.push_str(&format!(
                    "name_contains: {}, ",
                    ts_str_vec(&s.matcher.name_contains)
                ));
            }
            if !s.matcher.must_have_child.is_empty() {
                out.push_str(&format!(
                    "must_have_child: {}",
                    ts_str_vec(&s.matcher.must_have_child)
                ));
            }
            out.push_str(" },\n");
        }
        // scopes
        out.push_str("    scopes: [\n");
        for sc in &s.scopes {
            out.push_str("      { ");
            out.push_str(&format!("id: {}, ", ts_str(&sc.id)));
            out.push_str(&format!("label: {}, ", ts_str(&sc.label)));
            out.push_str(&format!("glob: {}, ", ts_str(&sc.glob)));
            out.push_str(&format!(
                "mode: {}",
                ts_str(&format!("{:?}", sc.mode).to_lowercase())
            ));
            if let Some(ref cat) = sc.category {
                out.push_str(&format!(
                    ", category: {}",
                    ts_str(&format!("{:?}", cat).to_lowercase())
                ));
            }
            if let Some(ref variant) = sc.variant {
                out.push_str(&format!(", variant: {}", ts_str(variant)));
            }
            if sc.recycle_granularity != Default::default() {
                out.push_str(&format!(
                    ", recycle_granularity: {}",
                    ts_str(&format!("{:?}", sc.recycle_granularity).to_lowercase())
                ));
            }
            if let Some(ref prompt) = sc.prompt {
                out.push_str(&format!(", prompt: {}", ts_prompt(prompt)));
            }
            out.push_str(" },\n");
        }
        out.push_str("    ],\n");
        out.push_str("  },\n");
    }
    out.push_str("];\n");
    out
}

fn ts_str(s: &str) -> String {
    // Escape single quotes and backslashes for TS single-quoted strings.
    let escaped = s.replace('\\', "\\\\").replace('\'', "\\'");
    format!("'{escaped}'")
}

fn ts_str_vec(v: &[String]) -> String {
    let items: Vec<String> = v.iter().map(|s| ts_str(s)).collect();
    format!("[{}]", items.join(", "))
}

fn ts_prompt(p: &pinkbin_scaffold::Prompt) -> String {
    use pinkbin_scaffold::Prompt;
    match p {
        Prompt::None => "{ kind: 'none' }".to_string(),
        Prompt::Days { default, label } => {
            let mut s = format!("{{ kind: 'days', default: {default}");
            if let Some(l) = label {
                s.push_str(&format!(", label: {}", ts_str(l)));
            }
            s.push_str(" }");
            s
        }
        Prompt::Bytes { default, label } => {
            let mut s = format!("{{ kind: 'bytes', default: {default}");
            if let Some(l) = label {
                s.push_str(&format!(", label: {}", ts_str(l)));
            }
            s.push_str(" }");
            s
        }
        Prompt::Choice { default, options, label } => {
            let opts = ts_str_vec(options);
            let mut s = format!("{{ kind: 'choice', default: {}, options: {opts}", ts_str(default));
            if let Some(l) = label {
                s.push_str(&format!(", label: {}", ts_str(l)));
            }
            s.push_str(" }");
            s
        }
        Prompt::Confirm { label } => {
            let mut s = "{ kind: 'confirm'".to_string();
            if let Some(l) = label {
                s.push_str(&format!(", label: {}", ts_str(l)));
            }
            s.push_str(" }");
            s
        }
    }
}

/// Read all `.toml` files from `dir`, parse them, and return the sorted list
/// of scaffolds (sorted by id). Returns an error if any file fails to parse.
pub fn load_scaffolds_from_dir(dir: &Path) -> anyhow::Result<Vec<Scaffold>> {
    let mut scaffolds: Vec<Scaffold> = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }
        let text = std::fs::read_to_string(&path)
            .map_err(|e| anyhow::anyhow!("cannot read {:?}: {}", path, e))?;
        let s: Scaffold = toml::from_str(&text)
            .map_err(|e| anyhow::anyhow!("parse error in {:?}: {}", path, e))?;
        scaffolds.push(s);
    }
    scaffolds.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(scaffolds)
}

/// Extract scaffold IDs from a mocks.ts file by scanning for `id: '...'` patterns.
/// Only matches scaffold-level IDs (4 spaces indent), not scope IDs (6+ spaces).
pub fn extract_mock_ids(mocks_ts: &str) -> Vec<String> {
    let mut ids = Vec::new();
    for line in mocks_ts.lines() {
        // Scaffold-level ids are indented with exactly 4 spaces: `    id: 'xxx',`
        // Scope-level ids are indented with 6+ spaces: `      id: 'xxx',`
        if !line.starts_with("    id: '") || line.starts_with("      ") {
            continue;
        }
        let trimmed = line.trim();
        if let Some(start) = trimmed.find("id: '") {
            let rest = &trimmed[start + 5..];
            if let Some(end) = rest.find('\'') {
                ids.push(rest[..end].to_string());
            }
        }
    }
    ids
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_scaffold_has_no_diagnostics() {
        let toml = r#"
id = "test"
name = "Test"
risk = "low"
disclaimer = "test"
detect = ["**/test"]
[[scope]]
id = "s1"
label = "S1"
glob = "**/cache/**"
mode = "recycle"
"#;
        let diags = lint_scaffold_text(toml, "test.toml");
        let errors: Vec<_> = diags.iter().filter(|d| d.severity == Severity::Error).collect();
        assert!(
            errors.is_empty(),
            "expected zero errors, got: {errors:?}",
        );
    }

    #[test]
    fn detects_invalid_glob() {
        let toml = r#"
id = "bad"
name = "Bad"
risk = "low"
disclaimer = "test"
detect = ["[unclosed"]
[[scope]]
id = "s1"
label = "S1"
glob = "**/*"
mode = "recycle"
"#;
        let diags = lint_scaffold_text(toml, "bad.toml");
        assert!(diags.iter().any(|d| d.message.contains("invalid glob")));
    }

    #[test]
    fn detects_redline() {
        let toml = r#"
id = "red"
name = "Red"
risk = "low"
disclaimer = "test"
detect = ["**/test"]
[[scope]]
id = "s1"
label = "S1"
glob = "**/*.db"
mode = "recycle"
"#;
        let diags = lint_scaffold_text(toml, "red.toml");
        assert!(diags.iter().any(|d| d.message.contains("redline")));
    }

    #[test]
    fn detects_duplicate_scope_ids() {
        let toml = r#"
id = "dup"
name = "Dup"
risk = "low"
disclaimer = "test"
detect = ["**/test"]
[[scope]]
id = "s1"
label = "S1"
glob = "**/a/**"
mode = "recycle"
[[scope]]
id = "s1"
label = "S1-again"
glob = "**/b/**"
mode = "recycle"
"#;
        let diags = lint_scaffold_text(toml, "dup.toml");
        assert!(diags.iter().any(|d| d.message.contains("duplicate")));
    }

    #[test]
    fn warns_on_empty_scopes() {
        let toml = r#"
id = "empty"
name = "Empty"
risk = "low"
disclaimer = "test"
detect = ["**/test"]
"#;
        let diags = lint_scaffold_text(toml, "empty.toml");
        assert!(diags.iter().any(|d| d.message.contains("no scopes")));
    }

    #[test]
    fn syntax_accepts_valid_glob() {
        assert!(check_glob_syntax("**/cache/**").is_ok());
    }

    #[test]
    fn syntax_rejects_unclosed_bracket() {
        assert!(check_glob_syntax("[invalid-glob").is_err());
    }

    #[test]
    fn syntax_accepts_parentheses_as_literal() {
        assert!(check_glob_syntax("C:/Program Files (x86)/Foo").is_ok());
    }

    #[test]
    fn redline_glob_detects_db() {
        let hits = check_redlines("**/*.db");
        assert!(!hits.is_empty(), "**/*.db should match redline fixtures");
    }

    #[test]
    fn redline_glob_clean_pattern() {
        let hits = check_redlines("**/cache/**");
        assert!(hits.is_empty(), "**/cache/** should not match any redline");
    }

    #[test]
    fn redline_glob_detects_db_storage() {
        let hits = check_redlines("**/db_storage/**");
        assert!(!hits.is_empty(), "**/db_storage/** should match redline");
    }

    #[test]
    fn redline_glob_detects_msg_dir() {
        let hits = check_redlines("**/Msg/**");
        assert!(!hits.is_empty(), "**/Msg/** should match redline");
    }

    #[test]
    fn redline_glob_catches_dotdb_questionmark() {
        // **/*.db? matches exactly one char after .db — it does NOT match
        // .db-wal (4 chars) or .db-shm (3 chars). This is correct: such a
        // pattern is NOT a redline risk. Only **/*.db* (star) would be.
        let hits = check_redlines("**/*.db?");
        assert!(
            hits.is_empty(),
            "**/*.db? should NOT match redline fixtures (only matches *.dbX, not *.db-wal)"
        );
    }

    #[test]
    fn redline_glob_catches_dotdb_star() {
        // **/*.db* matches .db, .db-wal, .db-shm — this IS a redline risk.
        let hits = check_redlines("**/*.db*");
        assert!(
            !hits.is_empty(),
            "**/*.db* should match redline fixtures (.db, .db-wal, .db-shm)"
        );
    }

    #[test]
    fn redline_glob_catches_msg_without_slash() {
        // **/msg/* without trailing slash should still match Msg fixture paths.
        let hits = check_redlines("**/Msg/*");
        assert!(
            !hits.is_empty(),
            "**/Msg/* should match redline Msg fixtures"
        );
    }

    #[test]
    fn emit_mock_produces_valid_ts() {
        let toml = r#"
id = "test-app"
name = "Test App"
risk = "low"
disclaimer = "test disclaimer"
detect = ["**/TestApp"]
[match]
name_contains = ["TestApp"]
[[scope]]
id = "cache"
label = "Cache"
glob = "**/Cache/**"
mode = "recycle"
"#;
        let s: Scaffold = toml::from_str(toml).unwrap();
        let ts = emit_mock_ts(&[s]);
        assert!(ts.contains("id: 'test-app'"));
        assert!(ts.contains("name: 'Test App'"));
        assert!(ts.contains("risk: 'low'"));
        assert!(ts.contains("glob: '**/Cache/**'"));
        assert!(ts.contains("mode: 'recycle'"));
        assert!(ts.contains("name_contains: ['TestApp']"));
    }
}