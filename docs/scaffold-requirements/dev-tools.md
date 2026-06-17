# Dev tools 类清理需求

> 本文件是后端写 `scaffolds/<id>.toml` 时的需求清单。新增/重写 scaffold 必须先对齐本文件。

## 1. 范围

| 优先级 | 应用 | 状态 |
|------|------|------|
| P0   | conda (Anaconda / Miniconda / Miniforge) | 已有 [scaffolds/conda.toml](../../scaffolds/conda.toml)，已验证 |

## 2. 数据三级分级 + 默认行为

### L1 可重生缓存（点完即可由应用自动重建）

| 子类 | 描述 | 默认勾选 | 保留期 | 备注 |
|-----|-----|---------|-------|-----|
| 下载的 tarball | `pkgs/cache` 目录下的 `.tar.bz2` / `.conda` 包 | ✅ | – | 全量清理，conda 会按需重新下载 |
| 包缓存 | `pkgs/*` 下已解压的包目录 | ✅ | 30 天 | 基于目录 mtime 判定；`conda install` 会更新 mtime |

### L2 可选历史数据（用户原始内容，删除不可恢复）

| 子类 | 描述 | 默认勾选 | 保留期 | 备注 |
|-----|-----|---------|-------|-----|
| 未使用的 environments | `envs/<name>/` 下的整个环境目录 | ✅ | – | UI 按 env 列表 + last-active 时间展示；整目录 recycle |

### L3 红线（任何 scope glob 都不允许命中）

- 通用红线（继承 `CLAUDE.md`）：`*.db` / `*.db-wal` / `*.db-shm` / `**/Accounts/**` / `**/login/**` / `**/config/**` / `**/key/**`
- 类别专属红线：
  - conda root 本身（`anaconda3` / `miniconda3` / `miniforge3` / `.conda` 目录）
  - Base env 内所有内容（`python.exe`、`Scripts/`、`Lib/site-packages/`、`conda-meta/`）
  - 用户配置（`.condarc`）
  - 环境注册表（`~/.conda/environments.txt`）
  - CLI shims（`condabin/conda.bat`）
  - conda-meta 元数据（`conda-meta/history`、`conda-meta/*.json`）

## 3. 通用 prompt 形态

| Bucket 类型 | `prompt.kind` | default | UI label |
|-----|-----|------|------|
| 包缓存 | `days` | 30 | "Delete packages older than (days)" |
| tarball | `none` | – | – |
| environments | `none` | – | UI 用专用 env picker（checkbox + last-active 时间） |

## 4. 用户偏好

- 多账号场景：不适用（conda 无多账号概念）
- 默认 `mode`：`recycle`
- 整体 `risk`：`medium`（删 env 后 pip-installed 包一并消失，重建需重装）
- Base env：UI 上灰显不可勾选

## 5. 给后端的 TOML 设计提示

| scope id | label | glob 骨架 | mode | prompt |
|----------|-------|-----------|------|--------|
| `tarballs` | 下载的 tarball（pkgs/cache） | `**/{anaconda3,miniconda3,miniforge3,.conda}/pkgs/cache` | recycle | none |
| `unused-packages` | 包缓存（按 mtime > 30 天） | `**/{anaconda3,miniconda3,miniforge3,.conda}/pkgs/*` | recycle | days=30 |
| `envs-stale` | 未使用的 environments | `**/{anaconda3,miniconda3,miniforge3,.conda}/envs/*` | recycle | none（UI 用专用 picker） |

> 所有三个 scope 都是 `recycle_granularity = "directory"`——整目录 recycle 而非 file-by-file，避免几万文件累计几分钟。

## 6. Disclaimer 文案要点

- 明确"绝不删 base env、.condarc、environments.txt"
- 明确"删除 env 后该 env 内的 pip-installed 包一并消失，重建需重装"
- 明确"未使用判定基于 conda-meta/history 的 mtime——纯 activate 不会更新此文件"
- 明确"全部走系统回收站，可还原"
- 不要使用"安全"二字

## 7. Conda 实测路径映射（Phase 5-7 勘测结论）

### 7.1 数据根（多版本/多平台）

| 版本/平台 | 默认数据根 | 备注 |
|---|---|---|
| Windows Anaconda | `%USERPROFILE%/anaconda3` | |
| Windows Miniconda | `%USERPROFILE%/miniconda3` | |
| Windows Miniforge | `%USERPROFILE%/miniforge3` | |
| Windows .conda | `%USERPROFILE%/.conda` | 用户自定义 envs 存放位置 |
| macOS/Linux Anaconda | `${HOME}/anaconda3` | |
| macOS/Linux Miniconda | `${HOME}/miniconda3` | |
| macOS/Linux Miniforge | `${HOME}/miniforge3` | |
| Linux system | `/opt/anaconda3`, `/opt/miniconda3` | |

### 7.2 目录树（实测）

```text
<conda-root>/
├── pkgs/                    ← L1 包缓存
│   ├── cache/               ← L1 tarball 缓存
│   ├── numpy-1.24.0-py310/  ← L1 已解压包
│   └── ...
├── envs/                    ← L2 environments
│   ├── base/                ← L3 红线（永远不动）
│   ├── tf-old/              ← L2 可清（基于 conda-meta/history mtime）
│   └── ...
├── python.exe               ← L3 红线
├── Scripts/                 ← L3 红线
├── Lib/                     ← L3 红线
├── conda-meta/              ← L3 红线
├── condabin/                ← L3 红线
└── etc/                     ← L3 红线
```

### 7.3 假设修订

- Phase 1 假设"pkgs 下按包粒度清理"→ 实测发现 directory granularity 更合理（几百小文件 per package）
- Phase 1 假设"env 用 mtime 判定"→ 实测确认 `conda-meta/history` mtime 是可靠信号，但纯 `conda activate` 不更新此文件

### 7.4 该 app 的 TOML scope 蓝图

见 §5。TOML 已写入 `scaffolds/conda.toml`，safety test 已写入 `crates/scaffold/tests/conda_safety.rs`。