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
        let label = format!("detect[{}]", i);
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

    // Redline check.
    let red_hits = check_redlines(pattern);
    for red in red_hits {
        diags.push(
            Diagnostic::error(format!(
                "glob may match redline segment `{red}` (CLAUDE.md rule #1)"
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

/// Check whether `pattern` may match any redline path segment.
pub fn check_redlines(pattern: &str) -> Vec<&'static str> {
    let lower = pattern.to_lowercase();
    REDLINE_SUBSTRINGS
        .iter()
        .filter(|red| lower.contains(**red))
        .copied()
        .collect()
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
    fn redline_detects_db() {
        let hits = check_redlines("**/*.db");
        assert!(hits.contains(&"*.db"));
    }

    #[test]
    fn redline_clean_pattern() {
        let hits = check_redlines("**/cache/**");
        assert!(hits.is_empty());
    }

    #[test]
    fn redline_ignores_case() {
        let hits = check_redlines("**/DB_STORAGE/**");
        assert!(hits.contains(&"db_storage"));
    }
}