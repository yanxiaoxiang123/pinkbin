use std::path::Path;

use pinkbin_scaffold_lint::{lint_scaffold_path, Severity};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: pinkbin-scaffold-lint <file.toml> [...]");
        std::process::exit(2);
    }

    let mut error_count = 0u32;
    for path_str in &args {
        let path = Path::new(path_str);
        let diags = lint_scaffold_path(path);
        let file_errors: Vec<_> = diags.iter().filter(|d| d.severity == Severity::Error).collect();
        let _file_warns: Vec<_> = diags.iter().filter(|d| d.severity == Severity::Warning).collect();

        if diags.is_empty() {
            // Lint passed but we might not even know the id if the file didn't parse.
            // Try to extract it for a nicer message.
            if let Some(id) = extract_id(path) {
                println!("ok: {path_str} ({id})");
            } else {
                println!("ok: {path_str}");
            }
        } else {
            for d in &diags {
                let tag = match d.severity {
                    Severity::Error => "ERROR",
                    Severity::Warning => "WARN",
                };
                let loc = d
                    .location
                    .as_ref()
                    .map(|l| format!("{l}: "))
                    .unwrap_or_default();
                eprintln!("  {tag}: {loc}{}", d.message);
            }
            if !file_errors.is_empty() {
                eprintln!("FAIL: {path_str} — {} error(s) above", file_errors.len());
                error_count += 1;
            }
        }
    }

    if error_count > 0 {
        std::process::exit(1);
    }
}

/// Best-effort parse to extract the scaffold id for display.
fn extract_id(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let s: pinkbin_scaffold::Scaffold = toml::from_str(&text).ok()?;
    Some(s.id)
}