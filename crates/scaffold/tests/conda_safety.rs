//! Regression test for `scaffolds/conda.toml`: every scope glob must match the
//! **directories** it targets (all three scopes are now directory-granularity),
//! and **must not** match conda red lines (the conda root itself, base env
//! binaries / packages / metadata, user config, environments.txt, conda CLI
//! shims). Globs are anchored to conda root names
//! ({anaconda3,miniconda3,miniforge3,.conda}) so `unused-packages`'s broad
//! `**/pkgs/*` doesn't false-positive on user-custom pkgs_dirs inside an env.
//!
//! Directory granularity safety: at runtime, find_matching_dirs prunes any
//! candidate whose ancestor is also matched (so `pkgs/numpy/info` doesn't
//! get queued separately when `pkgs/numpy` already wins) and unconditionally
//! drops `path == root` so a misconfigured glob can't recycle the whole conda
//! install. envs-stale further narrows by `env_filter` (UI-selected env names)
//! at runtime; this test only covers the glob layer.

mod test_utils;

#[test]
fn conda_globs_are_safe() {
    std::env::set_var("USERPROFILE", "C:/Users/test");
    std::env::set_var("HOME", "/home/test");

    let scaffold = test_utils::load_scaffold("scaffolds/conda.toml");
    let scopes: Vec<(String, globset::GlobSet)> = scaffold
        .scopes
        .iter()
        .map(|s| (s.id.clone(), test_utils::build_set(&test_utils::expand(&s.glob))))
        .collect();

    // ========================================================================
    // 正向：每个 scope 至少一条命中**目录**路径（directory granularity）
    // ========================================================================
    let positives: &[(&str, &str)] = &[
        ("tarballs", "C:/Users/test/miniconda3/pkgs/cache"),
        ("tarballs", "C:/Users/test/anaconda3/pkgs/cache"),
        ("tarballs", "/home/test/miniforge3/pkgs/cache"),
        ("tarballs", "C:/Users/test/.conda/pkgs/cache"),
        ("unused-packages", "C:/Users/test/miniconda3/pkgs/numpy-1.24.0-py310"),
        ("unused-packages", "C:/Users/test/anaconda3/pkgs/scipy-1.11.0"),
        ("unused-packages", "/home/test/anaconda3/pkgs/torch-2.0"),
        ("unused-packages", "C:/Users/test/miniconda3/pkgs/cache"),
        ("envs-stale", "C:/Users/test/miniconda3/envs/tf-old"),
        ("envs-stale", "C:/Users/test/anaconda3/envs/exp-2024"),
        ("envs-stale", "/home/test/miniconda3/envs/scratch"),
        ("envs-stale", "C:/Users/test/.conda/envs/dev"),
    ];

    for (expected_id, p) in positives {
        let hits = test_utils::matching_scopes(&scopes, p);
        assert!(
            hits.contains(expected_id),
            "expected scope `{expected_id}` to match `{p}`, got {hits:?}",
        );
    }

    // ========================================================================
    // 红线：必须 zero match
    // ========================================================================
    let red_lines: &[&str] = &[
        "C:/Users/test/miniconda3",
        "C:/Users/test/anaconda3",
        "/home/test/miniforge3",
        "C:/Users/test/.conda",
        "C:/Users/test/miniconda3/python.exe",
        "C:/Users/test/miniconda3/Scripts/conda.exe",
        "C:/Users/test/miniconda3/Scripts/pip.exe",
        "C:/Users/test/miniconda3/condabin/conda.bat",
        "C:/Users/test/anaconda3/python.exe",
        "C:/Users/test/anaconda3/condabin/conda.bat",
        "/home/test/miniforge3/bin/python",
        "/home/test/miniforge3/bin/conda",
        "C:/Users/test/miniconda3/conda-meta/history",
        "C:/Users/test/miniconda3/conda-meta/numpy-1.24.0-py310.json",
        "C:/Users/test/anaconda3/conda-meta/history",
        "C:/Users/test/miniconda3/Lib/site-packages/conda/__init__.py",
        "C:/Users/test/miniconda3/Lib/site-packages/numpy/__init__.py",
        "C:/Users/test/anaconda3/Lib/site-packages/scipy/__init__.py",
        "/home/test/anaconda3/lib/python3.10/site-packages/conda/__init__.py",
        "C:/Users/test/miniconda3/Lib",
        "C:/Users/test/miniconda3/Lib/site-packages",
        "C:/Users/test/miniconda3/Scripts",
        "C:/Users/test/miniconda3/conda-meta",
        "C:/Users/test/miniconda3/etc/conda/activate.d/env_vars.sh",
        "C:/Users/test/miniconda3/etc/conda/deactivate.d/cleanup.sh",
        "C:/Users/test/.condarc",
        "/home/test/.condarc",
        "C:/Users/test/.conda/environments.txt",
        "/home/test/.conda/environments.txt",
        "C:/Users/test/Documents/my-project/site-packages/foo.py",
        "C:/Users/test/AppData/Local/some-app/local-pkgs/cache/bar.dat",
    ];

    let mut violations = Vec::new();
    for p in red_lines {
        let hits = test_utils::matching_scopes(&scopes, p);
        if !hits.is_empty() {
            violations.push(format!("`{p}` -> {hits:?}"));
        }
    }
    assert!(
        violations.is_empty(),
        "conda.toml glob hit red lines:\n  {}",
        violations.join("\n  ")
    );
}