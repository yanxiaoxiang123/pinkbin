use std::path::Path;

use pinkbin_scaffold_lint::{emit_mock_ts, extract_mock_ids, lint_scaffold_path, load_scaffolds_from_dir, Severity};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    // ── --emit-mock <scaffolds-dir> [output-path] ──
    if let Some(pos) = args.iter().position(|a| a == "--emit-mock") {
        let dir = args.get(pos + 1).unwrap_or_else(|| {
            eprintln!("usage: pinkbin-scaffold-lint --emit-mock <scaffolds-dir> [output.ts]");
            std::process::exit(2);
        });
        let scaffolds = load_scaffolds_from_dir(Path::new(dir)).unwrap_or_else(|e| {
            eprintln!("FAIL: {e}");
            std::process::exit(1);
        });
        let ts = emit_mock_ts(&scaffolds);
        if let Some(out_path) = args.get(pos + 2) {
            std::fs::write(out_path, &ts).unwrap_or_else(|e| {
                eprintln!("FAIL: cannot write {out_path}: {e}");
                std::process::exit(1);
            });
            eprintln!("ok: wrote {} scaffolds to {out_path}", scaffolds.len());
        } else {
            print!("{ts}");
        }
        return;
    }

    // ── --check-mock <scaffolds-dir> <mocks.ts> ──
    if let Some(pos) = args.iter().position(|a| a == "--check-mock") {
        let dir = args.get(pos + 1).unwrap_or_else(|| {
            eprintln!("usage: pinkbin-scaffold-lint --check-mock <scaffolds-dir> <mocks.ts>");
            std::process::exit(2);
        });
        let mocks_path = args.get(pos + 2).unwrap_or_else(|| {
            eprintln!("usage: pinkbin-scaffold-lint --check-mock <scaffolds-dir> <mocks.ts>");
            std::process::exit(2);
        });
        let scaffolds = load_scaffolds_from_dir(Path::new(dir)).unwrap_or_else(|e| {
            eprintln!("FAIL: {e}");
            std::process::exit(1);
        });
        let mocks_ts = std::fs::read_to_string(mocks_path).unwrap_or_else(|e| {
            eprintln!("FAIL: cannot read {mocks_path}: {e}");
            std::process::exit(1);
        });
        let mock_ids = extract_mock_ids(&mocks_ts);
        let toml_ids: Vec<String> = scaffolds.iter().map(|s| s.id.clone()).collect();

        let mut missing_in_mock: Vec<&str> = Vec::new();
        for id in &toml_ids {
            if !mock_ids.contains(id) {
                missing_in_mock.push(id.as_str());
            }
        }
        let mut stale_in_mock: Vec<&str> = Vec::new();
        for id in &mock_ids {
            if !toml_ids.contains(id) {
                stale_in_mock.push(id.as_str());
            }
        }

        if missing_in_mock.is_empty() && stale_in_mock.is_empty() {
            eprintln!("ok: mock IDs match TOML IDs ({} scaffolds)", toml_ids.len());
        } else {
            if !missing_in_mock.is_empty() {
                eprintln!(
                    "ERROR: in TOML but missing from mock: {}",
                    missing_in_mock.join(", ")
                );
            }
            if !stale_in_mock.is_empty() {
                eprintln!(
                    "WARN: in mock but no TOML file: {}",
                    stale_in_mock.join(", ")
                );
            }
            std::process::exit(1);
        }
        return;
    }

    // ── Default: lint mode ──
    if args.is_empty() {
        eprintln!("usage: pinkbin-scaffold-lint <file.toml> [...]");
        eprintln!("       pinkbin-scaffold-lint --emit-mock <scaffolds-dir> [output.ts]");
        eprintln!("       pinkbin-scaffold-lint --check-mock <scaffolds-dir> <mocks.ts>");
        std::process::exit(2);
    }

    let mut error_count = 0u32;
    for path_str in &args {
        let path = Path::new(path_str);
        let diags = lint_scaffold_path(path);
        let file_errors: Vec<_> = diags.iter().filter(|d| d.severity == Severity::Error).collect();

        if diags.is_empty() {
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