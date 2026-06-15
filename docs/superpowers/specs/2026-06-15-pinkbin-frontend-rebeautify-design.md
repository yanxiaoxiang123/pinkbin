---
title: Pinkbin Frontend Re-Beautify — Apple Design System Migration
status: approved
date: 2026-06-15
---

# Pinkbin Frontend Re-Beautify — Apple Design System Migration

## Goal

将 [apps/desktop/src/](../apps/desktop/src/) 的样式从当前的「tech-pink neobrutalist」视觉语言
替换为 [design/DESIGN.md](../../design/DESIGN.md) 描述的 Apple 极简设计系统。token 系统
完全按 DESIGN.md 对齐；为保留工具可用性，对**密度**做少量妥协（详见「工具密度妥协」节）。

## Out of Scope

- TreeView / CleanupModal / SteamInspector / SteamWorkshopModal / ProgressButton / Toast
  / DiagnosticsBar / ContextMenu / Splitter 的具体样式改造。它们会自动继承新 `:root`
  token（旧 `--pink` → `--primary`、旧 hard shadow → 无），但卡片视觉仍是当前风格。
- 暗色模式（DESIGN.md 未定义暗色 token，不在本次范围）。
- 响应式 / 移动端适配（pinkbin 是 desktop-only，按 1440px 内容锁设计）。
- 后端 Rust / Tauri 命令。
- 任何 .tsx 内部逻辑、状态、事件处理、aria 属性。

## 决策记录

| 决策点 | 选择 | 理由 |
|---|---|---|
| 替换深度 | 完全按 DESIGN.md 替换 | user 已确认 |
| 字体策略 | Inter（Google Fonts）替代 SF Pro | user 已确认；Tauri Windows 环境无 SF Pro |
| 范围 | 全局 + Studio + Chat + Settings | user 已确认；不动 TreeView/Cleanup 等 |
| 风险色 | muted semantic（green/amber/red） | user 已确认 |
| 方案 | Apple token + 工具密度 | user 已确认；保留可用性 |

## Token 系统（替换 styles.css 的 `:root`）

### Color

```css
--ink:           #1d1d1f;     /* near-black; headlines + body */
--ink-2:         #333333;     /* secondary text; ink-muted-80 equivalent */
--ink-3:         #7a7a7a;     /* disabled / fine print; ink-muted-48 equivalent */

--canvas:        #ffffff;
--canvas-2:      #f5f5f7;     /* parchment */
--surface-pearl: #fafafc;
--divider:       #f0f0f0;
--hairline:      rgba(0,0,0,0.08);
--hairline-strong: rgba(0,0,0,0.16);

--primary:        #0066cc;
--primary-focus:  #0071e3;
--primary-hover:  #0077ed;
--primary-on-dark:#2997ff;
--on-primary:     #ffffff;

--tile-dark-1:   #272729;
--tile-dark-2:   #2a2a2c;
--tile-dark-3:   #252527;
--tile-black:    #000000;
--on-dark:       #ffffff;

--risk-low:      #5fcf95;     /* muted semantic */
--risk-medium:   #d4a017;
--risk-high:     #d04a4a;
```

### Typography

Inter Variable (`wght@300..700&display=swap`) 从 Google Fonts 加载，并通过
`<link rel="preload" as="font" crossorigin>` + `font-display: swap` 防止 FOIT。
mono 保留 JetBrains Mono（仅给数字 / 路径 / 代码场景）。

```css
--font-display: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable",
                "PingFang SC", "Microsoft YaHei", sans-serif;
--font-body:    var(--font-display);
--font-mono:    "JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace;

--fs-display-lg:  28px;   /* 工具密度妥协：原 40px → 28px */
--fs-headline:    21px;
--fs-body:        14px;   /* 工具密度妥协：原 17px → 14px */
--fs-body-strong: 14px;
--fs-caption:     12px;
--fs-fine:        11px;
--fs-nav:         12px;
--fs-button:      14px;

--fw-light:    300;
--fw-regular:  400;
--fw-strong:   600;
--fw-bold:     700;        /* 仅 mono 等高密度场景使用 */

/* DESIGN.md weight ladder 是 300/400/600；本设计严守，不引入 500。
   14px body 与 14px body-strong 用 400 vs 600 + letter-spacing 区分。 */

--lh-tight:    1.10;
--lh-snug:     1.24;
--lh-normal:   1.47;
--lh-relaxed:  1.78;

--ls-tight:    -0.374px;
--ls-snug:     -0.224px;
--ls-flat:     -0.12px;
--ls-zero:     0;
```

### Spacing & Shape

```css
--sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;  --sp-4: 16px;
--sp-5: 20px; --sp-6: 24px; --sp-7: 32px;  --sp-8: 48px;

--r-sm:    8px;
--r-md:    11px;
--r-lg:    18px;
--r-pill:  9999px;
--r-full:  9999px;
```

### Elevation

```css
--shadow-product:  0 5px 30px rgba(0,0,0,0.12);  /* 唯一保留的 shadow；仅 card hover */
--shadow-modal:    0 30px 80px rgba(0,0,0,0.18);  /* 仅 modal backdrop */
--ring-focus:      0 0 0 2px var(--primary-focus);
```

**绝对不出现**：`3px 3px 0 var(--ink)` 这类 hard offset shadow。

## 工具密度妥协

DESIGN.md 的字号阶梯为 17px body / 40px display，section padding 80px。这对工具面板过
于稀疏，会让左侧 TreeView（需显示 ~50 行文件名）滚出视野。本次妥协：

| DESIGN.md | pinkbin 实际 | 用途 |
|---|---|---|
| `body` 17px | `body` 14px | TreeView / ChatPanel / Studio 全部内容字号 |
| `display-lg` 40px | `display-lg` 28px | 卡片标题、modal 标题 |
| section 80px | section 24px | Studio 卡片间 gutter、modal padding |
| header 52px | header 44px | global-nav |
| footer 26px | footer 32px | footer |

其他 typography 规则保留：negative letter-spacing、weight ladder (300/400/600)、
`line-height` 1.47 for body。

## Component Patterns

### Button

```css
/* Primary */
.btn-primary {
  background: var(--primary);
  color: var(--on-primary);
  border: none;
  border-radius: var(--r-pill);
  padding: 8px 18px;
  font: var(--fw-regular) var(--fs-button)/1.0 var(--font-body);
  transition: background .12s ease, transform .08s ease;
}
.btn-primary:hover:not(:disabled) { background: var(--primary-hover); }
.btn-primary:active:not(:disabled) { transform: scale(0.97); }
.btn-primary:focus-visible { box-shadow: var(--ring-focus); outline: none; }

/* Secondary pill (ghost) */
.btn-secondary {
  background: transparent;
  color: var(--primary);
  border: 1px solid var(--primary);
  border-radius: var(--r-pill);
  padding: 8px 18px;
  font: var(--fw-regular) var(--fs-button)/1.0 var(--font-body);
}

/* Utility (close X, undo) */
.btn-utility {
  background: var(--canvas);
  color: var(--ink);
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  padding: 6px 12px;
  font: var(--fw-regular) var(--fs-caption)/1.0 var(--font-body);
}

/* Dark utility (Sign In-style for global nav) */
.btn-dark-utility {
  background: var(--ink);
  color: var(--on-dark);
  border: none;
  border-radius: var(--r-sm);
  padding: 6px 12px;
  font: var(--fw-regular) var(--fs-nav)/1.0 var(--font-body);
}
```

### Card

```css
.card {
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  padding: var(--sp-6);
  transition: border-color .14s ease, box-shadow .14s ease;
}
.card:hover {
  border-color: var(--hairline-strong);
  box-shadow: var(--shadow-product);
}
```

Studio 卡片用 `.card` 基类 + 风险左边条变体：

```css
.studio-card-wrap { border-left: 4px solid var(--divider); padding-left: var(--sp-4); }
.studio-card-wrap.risk-low    { border-left-color: var(--risk-low); }
.studio-card-wrap.risk-medium { border-left-color: var(--risk-medium); }
.studio-card-wrap.risk-high   { border-left-color: var(--risk-high); }
```

### Modal

```css
.modal-bg {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.30);
  backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  z-index: 50;
}
.modal {
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  padding: var(--sp-6);
  width: 480px; max-width: 92vw;
  box-shadow: var(--shadow-modal);
  display: grid; gap: var(--sp-4);
}
.modal-head {
  font: var(--fw-strong) var(--fs-headline)/var(--lh-tight) var(--font-display);
  letter-spacing: var(--ls-flat);
  color: var(--ink);
  display: flex; align-items: center; justify-content: space-between;
}
```

### Input

```css
.input {
  background: var(--canvas);
  color: var(--ink);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  padding: 8px 12px;
  font: var(--fw-regular) var(--fs-body)/1.4 var(--font-body);
  outline: none;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.input:focus {
  border-color: var(--primary);
  box-shadow: var(--ring-focus);
}
```

### Chat Bubble

```css
/* User */
.chat-bubble.user {
  background: var(--primary);
  color: var(--on-primary);
  border-radius: 18px 18px 4px 18px;
  padding: 12px 16px;
  max-width: 80%;
  font-weight: 500;
}

/* Assistant */
.chat-bubble.assistant {
  background: var(--canvas);
  color: var(--ink-2);
  border: 1px solid var(--hairline);
  border-left: 2px solid var(--primary);
  border-radius: 18px 18px 18px 4px;
  padding: 14px 18px;
  width: 100%;
}

/* System */
.chat-bubble.system {
  background: var(--surface-pearl);
  color: var(--ink-muted-80);
  border-radius: var(--r-pill);
  padding: 6px 14px;
  font-size: var(--fs-caption);
  font-weight: var(--fw-strong);
}

/* Markdown inside assistant */
.chat-bubble.assistant h2 {
  border-bottom: 1px solid var(--divider);
  padding-bottom: 4px;
}
.chat-bubble.assistant code {
  background: var(--surface-pearl);
  border: none;
  color: var(--ink-2);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 4px;
}
.chat-bubble.assistant pre {
  background: var(--tile-dark-1);
  color: var(--on-dark);
  border-radius: 12px;
  padding: 14px 16px;
  font-size: 12px;
  line-height: 1.65;
}
.chat-bubble.assistant pre code {
  background: transparent;
  color: inherit;
}
.chat-bubble.assistant ul > li::before {
  background: var(--primary);
}
```

### TreeView (本轮不动样式，但用新 token)

继承新 `:root` 后：TreeView 行从 pink hover → primary hover；选中行从 pink 背景 → `surface-pearl`。
视觉仍偏旧，**显式不修**。

## Layout

```
.app {
  display: grid;
  grid-template-rows: 44px 1fr 32px;
  height: 100vh;
}

header {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: 0 var(--sp-5);
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--hairline);
}

main {
  display: grid;
  grid-template-columns: 460px 1px 1fr 1px 360px;
  min-height: 0;
}

aside.left  { background: var(--canvas); overflow: auto; }
aside.right { background: var(--canvas); overflow: auto; }
section.center { background: var(--canvas-2); overflow: hidden; }

.splitter {
  width: 1px;
  background: var(--divider);
  cursor: col-resize;
}
.splitter:hover, .splitter:focus-visible {
  background: var(--primary);
}

footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 var(--sp-5);
  background: var(--canvas-2);
  color: var(--ink-3);
  font-size: var(--fs-fine);
  border-top: 1px solid var(--hairline);
}
```

## 文件改造清单

### className 迁移策略（关键决策）

**保留所有现有 className，只改 CSS。** 也就是说 `.tsx` 文件里出现
`<button className="primary">` 之类的 className 字符串一律不动，styles.css 里
重写 `button.primary { ... }` 选择器即可。

理由：
- 避免 4 个 .tsx + Settings.tsx 里上百处 className 改写导致 diff 巨大
- className 已是合理的命名空间（`.btn-*` vs `button.primary`），改名后无功能收益
- 后续若想做 BEM 化重构，独立 PR 处理

**本设计文档中**的 `.btn-primary` / `.btn-secondary` / `.btn-utility` 等命名仅用于**说明**
新的视觉 pattern；实现时直接对应到现有的 `button.primary` / `button.secondary` / `button.ghost`。
即：
- `button.primary` ← `.btn-primary` 的视觉
- `button.secondary` ← `.btn-secondary` 的视觉
- `button.ghost` ← `.btn-utility` 的视觉
- `button.ghost.icon` ← `.btn-utility.icon` 的视觉

### [apps/desktop/src/styles.css](../apps/desktop/src/styles.css) — 完全重写

替换以下区块：
- `@import url(...)` — 替换为 Inter Variable
- `:root` — 整套新 token
- `body` — Inter, `--fs-body`, hairline selection color
- `.app`, `header`, `main`, `aside.*`, `section.center`, `footer` — 新 layout
- `button.primary`, `button.ghost`, `button.secondary` — 新 btn pattern
- `input, select` — 新 input
- `.scan-bar`, `.diag-bar`, `.banner` — 新进度 / 提示
- `.tree-row`, `.badge` — 最低限度改用新 token（保留结构）
- `.modal`, `.modal-bg`, `.field`, `.seg`, `.hint`, `.ctxmenu` — 新 modal 视觉
- `.toast-item`, `.toast-success`, `.toast-error`, `.toast-info` — 新 toast
- `.empty` — 新空状态
- `.muted`, `.mono`, `.mono-num` — 新类型

### [apps/desktop/src/components/Studio.css](../apps/desktop/src/components/Studio.css) — 完全重写

**仅改造 `.studio-*` 和 `.tool-*` 系列**。文件末尾的 `.cleanup-*`、
`.progress-button-*`、`.spin` 是 CleanupModal / ProgressButton 用的类，
本次 **out of scope**；保持原状不动（视觉上仍偏旧 pink 风格）。

- `.studio` 容器：去掉 `paper-2` 背景，改用 `canvas`
- `.studio-head`：canvas + hairline 分割
- `.studio-grid`：`grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))`
- `.studio-card-wrap`：hairline card base
- `.studio-card`：pill + hairline，hover shadow-product
- `.studio-card-icon`：改为 emoji + 1px hairline circle
- `.studio-card-expanded`：分隔用 hairline divider
- `.studio-children li`：canvas + hairline border-bottom
- `.studio-detail-label`：caption-strong + 顶部留白
- `.studio-cleanup-btn` / `.studio-ask-btn`：pill primary / pill secondary
- 风险标识：left-border 4px + 风险 pill

### [apps/desktop/src/components/ChatPanel.css](../apps/desktop/src/components/ChatPanel.css) — 完全重写

**仅改造 `.chat*` 系列**。文件末尾的 `.advice-scaffold-link` 等属于 ChatPanel.tsx 自身用法，
随 ChatPanel 一起改造。

- `.chat`：背景 `canvas-2`
- `.chat-head`：canvas + hairline
- `.chat-scroll`：parchment 背景
- `.chat-hero`：hairline border + pearl 背景，去掉 dashed
- `.chat-bubble.user`：primary 填充，pill-ier
- `.chat-bubble.assistant`：canvas + hairline + left-accent
- `.chat-bubble.system`：pearl + pill
- `.chat-bubble.pending`：去 italic，三个 dot 动画
- Markdown 区块：hairline divider、pearl code、tile-dark pre
- `.chat-input-wrap`：hairline 顶部
- `.chat-input textarea`：r-md + focus ring
- `.chat-pill`：pearl + hairline，无 shadow
- `.advice-pill`：pearl + hairline

### [apps/desktop/src/components/Settings.tsx](../apps/desktop/src/components/Settings.tsx) — 样式微调

className 已对齐 system（`.modal`, `.field`, `.hint`, `.seg`, `.primary`, `.ghost`），主要靠 styles.css
的新 modal 视觉生效。**最小改动**：去掉按钮的 `ghost icon` 改用 `.btn-utility icon`。
预计 0–3 行 JSX 改动。

### [apps/desktop/index.html](../apps/desktop/index.html) — 字体 import 调整

替换：
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```
移除 JetBrains Mono 与 Geist。

## 验证步骤（实施后必跑）

1. `pnpm -C apps/desktop exec tsc --noEmit` — 类型零错
2. `pnpm -C apps/desktop exec vite build` — 构建产物正常
3. `cargo check -p pinkbin-desktop` — Rust 端不变（保险）
4. 启动 dev server，用 gstack 在 1440×900 截图：
   - 默认空状态
   - 扫描后 Studio 至少 1 张卡片展开
   - Chat 至少 1 条 user / assistant 对话
   - Settings modal 打开
5. 视觉抽检清单：
   - [ ] 唯一 Action Blue（#0066cc）用于所有交互元素
   - [ ] 无任何 `3px 3px 0` / `5px 5px 0` / `8px 8px 0` hard shadow
   - [ ] 所有 primary CTA 形状为 pill (`--r-pill`)
   - [ ] body 字号 = 14px
   - [ ] Inter 字体已加载（在 Elements 面板能看到 `.inter-loaded` 类或字体被应用）
   - [ ] 选中行 / hover 行的颜色与新的 risk / primary 色匹配
   - [ ] chat assistant 气泡左侧有 2px primary accent

## 风险与回退

| 风险 | 缓解 |
|---|---|
| TreeView / CleanupModal 视觉仍偏旧 | 显式记入 Out of Scope，下一轮再处理 |
| Inter 字体加载失败 → 退化到 Segoe UI | `font-display: swap` 已设置；视觉稍变但不破坏布局 |
| 全局 `--ink` 改为 `#1d1d1f` 后，某些组件（mono, code）颜色对比不够 | 用 `--ink-2` (#333) 提亮次级文字 |
| 设置 modal 的字段标签原本用 ink-2 大写，新 token 后无 uppercase 处理 | 已确认：保留 uppercase + letter-spacing，但换 fs-caption |
| 进度条 `repeating-linear-gradient` 在 Apple 调性下太扎眼 | 改为纯 primary 背景 + 8% alpha 内层 highlight |

## 不需要更新的文件

- 所有 .tsx 的 React 组件代码（除非上面明确列出 Settings.tsx 的微调）
- Rust 后端
- Cargo.toml / package.json（不新增 npm 依赖）
- tests / __tests__/
- types.ts
- store/* / hooks/*
- advisorClient.ts / api.ts
- TreeView.tsx / TreeView.css（不存在但仍 OK）
- CleanupModal/* / SteamInspector.css / SteamWorkshopModal.tsx

## 实施后的后续（不在本次范围）

- TreeView / CleanupModal / SteamInspector / SteamWorkshopModal 样式现代化
- Settings modal 内部视觉细节进一步精修
- 暗色模式（需要 DESIGN.md 扩展 token）
- Splash / Welcome 屏（DESIGN.md 中没有但符合 Apple 调性）
