# Pinkbin Frontend Re-Beautify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current tech-pink neobrutalist frontend with the Apple-style design system described in `design/DESIGN.md`, keeping tool-class density (14px body, 44px header, etc.) and all existing className strings.

**Architecture:** Pure CSS rewrite of 4 files (`index.html`, `styles.css`, `Studio.css`, `ChatPanel.css`) plus 0-3 lines of JSX in `Settings.tsx`. Token system (colors, typography, spacing, shapes) goes into `:root` of `styles.css`; component files reference those tokens. No className renames, no React state changes, no Rust changes.

**Tech Stack:** Tauri 2 + React 18 + Vite + TypeScript + vanilla CSS (no Tailwind / no CSS-in-JS).

**Reference spec:** `docs/superpowers/specs/2026-06-15-pinkbin-frontend-rebeautify-design.md`
**Reference design doc:** `design/DESIGN.md`

---

## Working Directory

All commands assume the repo root: `E:\Y\pinkbin\pinkbin` (or `/e/Y/pinkbin/pinkbin` in WSL/Git-Bash).

## Per-Task Verification

Pure CSS work has no failing-test → pass-test cycle. The verification per task is:

```bash
pnpm -C apps/desktop exec tsc --noEmit        # TypeScript clean
pnpm -C apps/desktop exec vite build           # Build clean
```

If either fails, **stop and fix before committing**. Both commands must finish with exit code 0 and no warnings about missing exports.

Run both from the repo root or with `-C` switch. They take ~10-30s.

## Commit Discipline

One commit per task. Do not batch. Do not commit broken states. Commit message format:

```
<type>(<scope>): <imperative summary>

<optional body explaining the why, not the what>
```

Types: `feat`, `style`, `chore`, `docs`. Scopes: `ui`, `studio`, `chat`, `settings`, `html`, `fonts`.

---

## Phase 0: Foundation

### Task 1: Swap font import in `index.html`

**Files:**
- Modify: `apps/desktop/index.html`

- [ ] **Step 1: Replace font import**

Replace the empty `<head>` body of `apps/desktop/index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
    <title>Pinkbin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

(Removed `lang="en"` change preserved; the `lang` attribute is unrelated to this task and remains `en`.)

- [ ] **Step 2: Verify build**

Run from repo root:
```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: both exit code 0. Build emits a `dist/` folder. No console errors.

- [ ] **Step 3: Commit**

```bash
cd E:/Y/pinkbin/pinkbin
git add apps/desktop/index.html
git commit -m "style(html): swap JetBrains Mono + Geist for Inter (Apple SF Pro substitute)"
```

---

## Phase 1: Global Token System

### Task 2: Replace `:root` tokens in `styles.css`

**Files:**
- Modify: `apps/desktop/src/styles.css` (lines 1-69, the @import + `:root` blocks)

- [ ] **Step 1: Replace import + `:root` block**

In `apps/desktop/src/styles.css`, replace the lines 1-69 (everything from `@import url(...)` through the closing `}` of `:root`) with:

```css
/* Pinkbin — Apple-inspired minimal theme.
   Single Action Blue accent, soft hairlines instead of hard shadows,
   Inter for body / display, JetBrains Mono for numerics. */

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&family=JetBrains+Mono:wght@400;600&display=swap');

:root {
  /* ── Text colors ─────────────────────────────────────────── */
  --ink:           #1d1d1f;     /* near-black headlines + body */
  --ink-2:         #333333;     /* secondary text */
  --ink-3:         #7a7a7a;     /* disabled / fine print */

  /* ── Surfaces ────────────────────────────────────────────── */
  --canvas:        #ffffff;
  --canvas-2:      #f5f5f7;     /* parchment */
  --surface-pearl: #fafafc;
  --divider:       #f0f0f0;
  --hairline:        rgba(0, 0, 0, 0.08);
  --hairline-strong: rgba(0, 0, 0, 0.16);

  /* ── Primary (Action Blue) ───────────────────────────────── */
  --primary:        #0066cc;
  --primary-focus:  #0071e3;
  --primary-hover:  #0077ed;
  --primary-on-dark:#2997ff;
  --on-primary:     #ffffff;

  /* ── Dark surfaces ───────────────────────────────────────── */
  --tile-dark-1:    #272729;
  --tile-dark-2:    #2a2a2c;
  --tile-dark-3:    #252527;
  --tile-black:     #000000;
  --on-dark:        #ffffff;

  /* ── Risk (muted semantic) ───────────────────────────────── */
  --risk-low:       #5fcf95;
  --risk-medium:    #d4a017;
  --risk-high:      #d04a4a;

  /* ── Spacing scale (4-px base, structural snaps 8/12/16/24) ── */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-7: 32px;
  --sp-8: 48px;

  /* ── Shape ───────────────────────────────────────────────── */
  --r-sm:    8px;
  --r-md:    11px;
  --r-lg:    18px;
  --r-pill:  9999px;
  --r-full:  9999px;

  /* ── Elevation (only two: card hover + modal) ────────────── */
  --shadow-product: 0 5px 30px rgba(0, 0, 0, 0.12);
  --shadow-modal:   0 30px 80px rgba(0, 0, 0, 0.18);
  --ring-focus:     0 0 0 2px var(--primary-focus);

  /* ── Typography (Inter, 14-px body for tool density) ─────── */
  --font-display: "Inter", system-ui, -apple-system, BlinkMacSystemFont,
                  "Segoe UI Variable", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-body:    var(--font-display);
  --font-mono:    "JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace;

  --fs-display-lg:  28px;       /* tool-density compromise: 40 → 28 */
  --fs-headline:    21px;
  --fs-body:        14px;       /* tool-density compromise: 17 → 14 */
  --fs-body-strong: 14px;
  --fs-caption:     12px;
  --fs-fine:        11px;
  --fs-nav:         12px;
  --fs-button:      14px;

  --fw-light:    300;
  --fw-regular:  400;
  --fw-strong:   600;
  --fw-bold:     700;           /* mono only */

  --lh-tight:    1.10;
  --lh-snug:     1.24;
  --lh-normal:   1.47;
  --lh-relaxed:  1.78;

  --ls-tight:    -0.374px;
  --ls-snug:     -0.224px;
  --ls-flat:     -0.12px;
  --ls-zero:     0;

  /* Legacy aliases kept to minimize diff while other files migrate.
     Remove in a follow-up once no consumer references them. */
  --paper:       var(--canvas-2);
  --paper-2:     var(--canvas-2);
  --paper-3:     var(--divider);
  --card:        var(--canvas);
  --pink:        var(--primary);
  --pink-deep:   var(--primary);
  --pink-bg:     var(--surface-pearl);
  --pink-soft:   var(--divider);
  --ink-2-legacy: var(--ink-2);
  --text-muted:  var(--ink-3);
  --err:         var(--risk-high);
  --shadow-sm:   0 0 0 1px var(--hairline);
  --shadow:      var(--shadow-product);
  --shadow-lg:   var(--shadow-product);
  --line:        var(--ink);

  font-family: var(--font-body);
  color-scheme: light;
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean. (No consumers yet reference the new tokens directly, only legacy aliases — both must work.)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "style(ui): replace :root tokens with Apple design system (Action Blue, Inter, parchment)"
```

---

## Phase 2: App Shell Layout

### Task 3: Replace body + global type rules

**Files:**
- Modify: `apps/desktop/src/styles.css` (lines 70-90 region: `*`, `html, body, #root`, `body`, `button`, `code, .mono`, `.mono-num`)

- [ ] **Step 1: Replace body / universal selectors**

In `apps/desktop/src/styles.css`, replace the block from `* { box-sizing: border-box; }` through `.mono-num { ... }` (everything that follows the `:root` close brace until the next major section) with:

```css
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--canvas-2);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: var(--fs-body);
  font-weight: var(--fw-regular);
  line-height: var(--lh-normal);
  letter-spacing: var(--ls-snug);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
button {
  font: inherit;
  font-family: var(--font-body);
  cursor: pointer;
}
code, .mono {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
  background: var(--surface-pearl);
  border: none;
  padding: 1px 6px;
  border-radius: var(--r-sm);
}
.mono-num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.muted { color: var(--ink-3); font-size: var(--fs-caption); }
.muted.small { font-size: var(--fs-fine); }
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "style(ui): global body + typography to Inter 14px on parchment canvas"
```

---

### Task 4: Replace `.app` shell, header, main, aside, footer, splitter

**Files:**
- Modify: `apps/desktop/src/styles.css` (the `.app` + `header` + `main` + `aside.*` + `section.center` + `footer` + `.splitter` block)

- [ ] **Step 1: Replace the `.app` shell block**

In `apps/desktop/src/styles.css`, replace the `.app` and all its children (`header`, `main`, `aside.left/right`, `section.center`, `footer`, `.splitter`) blocks with:

```css
/* ── App shell ────────────────────────────────────────────── */
.app {
  display: grid;
  grid-template-rows: 44px 1fr 32px;
  height: 100vh;
  min-height: 0;
}
.app > header { grid-row: 1; }
.app > main { grid-row: 2; min-height: 0; }
.app > footer { grid-row: 3; }

/* ── Header (global-nav analogue) ─────────────────────────── */
header {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: 0 var(--sp-5);
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--hairline);
  -webkit-app-region: drag;
}
.grow { flex: 1; }
.brand {
  display: inline-flex;
  gap: var(--sp-2);
  align-items: center;
  font-family: var(--font-body);
  font-weight: var(--fw-strong);
  font-size: 15px;
  letter-spacing: var(--ls-flat);
  color: var(--ink);
}
.brand svg { color: var(--ink); }

/* ── Main 3-column layout ─────────────────────────────────── */
main {
  display: grid;
  grid-template-columns: 460px 1px 1fr 1px 360px;
  overflow: hidden;
}
aside.left, aside.right { background: var(--canvas); overflow: auto; min-width: 0; }
section.center {
  background: var(--canvas-2);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Splitter ─────────────────────────────────────────────── */
.splitter {
  position: relative;
  width: 1px;
  background: var(--divider);
  cursor: col-resize;
  flex-shrink: 0;
  transition: background .12s ease;
}
.splitter:hover,
.splitter:focus-visible,
.splitter:active { background: var(--primary); }
.splitter:focus-visible { outline: none; }
.splitter > span { position: absolute; inset: 0 -4px; }

/* ── Scrollbars (kept on the pinkbin neobrutalist 12-px width
   but recoloured to muted hairlines) ──────────────────────── */
aside::-webkit-scrollbar { width: 10px; }
aside::-webkit-scrollbar-track { background: transparent; }
aside::-webkit-scrollbar-thumb {
  background: var(--divider);
  border-radius: var(--r-pill);
}
aside::-webkit-scrollbar-thumb:hover { background: var(--hairline-strong); }

/* ── Footer (parchment fine-print row) ────────────────────── */
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

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean. App.tsx and friends still render correctly because legacy class names (`.app`, `header`, `main`, `aside.left/right`, `section.center`, `footer`, `.splitter`) are unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "style(ui): app shell — 44px frosted header, hairline splitters, parchment footer"
```

---

## Phase 3: Buttons & Inputs

### Task 5: Replace primary / secondary / ghost buttons

**Files:**
- Modify: `apps/desktop/src/styles.css` (`button.primary`, `button.secondary`, `button.ghost`, `button:disabled` block)

- [ ] **Step 1: Replace button styles**

In `apps/desktop/src/styles.css`, replace the entire `button.primary` / `button.secondary` / `button.ghost` / `button:disabled` block with:

```css
/* ── Buttons ──────────────────────────────────────────────── */
button.primary {
  background: var(--primary);
  color: var(--on-primary);
  border: none;
  padding: 7px 18px;
  border-radius: var(--r-pill);
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font: var(--fw-regular) var(--fs-button)/1.0 var(--font-body);
  letter-spacing: var(--ls-zero);
  transition: background .12s ease, transform .08s ease, box-shadow .12s ease;
}
button.primary:hover:not(:disabled) {
  background: var(--primary-hover);
}
button.primary:active:not(:disabled) {
  transform: scale(0.97);
}
button.primary:focus-visible {
  box-shadow: var(--ring-focus);
  outline: none;
}
button.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

button.secondary {
  background: transparent;
  color: var(--primary);
  border: 1px solid var(--primary);
  padding: 7px 18px;
  border-radius: var(--r-pill);
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font: var(--fw-regular) var(--fs-button)/1.0 var(--font-body);
  transition: background .12s ease, transform .08s ease;
}
button.secondary:hover:not(:disabled) {
  background: rgba(0, 102, 204, 0.06);
}
button.secondary:active:not(:disabled) {
  transform: scale(0.97);
}
button.secondary:focus-visible {
  box-shadow: var(--ring-focus);
  outline: none;
}

button.ghost {
  background: var(--canvas);
  color: var(--ink);
  border: 1px solid var(--hairline);
  padding: 7px 14px;
  border-radius: var(--r-sm);
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font: var(--fw-regular) var(--fs-button)/1.0 var(--font-body);
  font-weight: var(--fw-strong);
  transition: background .12s ease, border-color .12s ease, transform .08s ease;
}
button.ghost:hover:not(:disabled) {
  background: var(--surface-pearl);
  border-color: var(--hairline-strong);
}
button.ghost:active:not(:disabled) {
  transform: scale(0.97);
}
button.ghost.icon { padding: 7px; }
button.ghost.full {
  width: 100%;
  justify-content: center;
  margin-top: var(--sp-2);
}
button:disabled { opacity: 0.45; cursor: not-allowed; }
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "style(ui): buttons — pill primary/secondary, ghost utility, single Action Blue"
```

---

### Task 6: Replace input / select / header settings pill

**Files:**
- Modify: `apps/desktop/src/styles.css` (`input, select`, `.settings-btn`, `.settings-dot`, `.provider-pill`)

- [ ] **Step 1: Replace input and settings styles**

In `apps/desktop/src/styles.css`, replace the `input, select` and `.settings-btn`/`.settings-dot`/`.provider-pill` blocks with:

```css
/* ── Inputs ───────────────────────────────────────────────── */
input, select, textarea {
  background: var(--canvas);
  color: var(--ink);
  border: 1px solid var(--hairline);
  padding: 7px 10px;
  border-radius: var(--r-md);
  font: var(--fw-regular) var(--fs-body)/1.4 var(--font-body);
  letter-spacing: var(--ls-snug);
  outline: none;
  transition: border-color .12s ease, box-shadow .12s ease;
}
input:focus, select:focus, textarea:focus {
  border-color: var(--primary);
  box-shadow: var(--ring-focus);
}

/* ── Header advisor pill + settings dot ───────────────────── */
.settings-btn { position: relative; }
.settings-btn.bound { background: var(--surface-pearl); }
.settings-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: var(--risk-low);
}
.provider-pill {
  display: inline-flex;
  align-items: center;
  font-family: var(--font-body);
  font-size: var(--fs-nav);
  font-weight: var(--fw-strong);
  letter-spacing: var(--ls-flat);
  background: var(--surface-pearl);
  color: var(--ink-2);
  border: 1px solid var(--hairline);
  padding: 3px 10px;
  border-radius: var(--r-pill);
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "style(ui): inputs — rounded-md with focus ring; provider pill as muted hairline chip"
```

---

## Phase 4: Status & Progress

### Task 7: Replace scan bar, diagnostics, banner, empty state

**Files:**
- Modify: `apps/desktop/src/styles.css` (`.scan-bar`, `.scan-bar-fill`, `.scan-bar-label`, `.diag-bar`, `.banner`, `.error`, `.ok`, `.empty`)

- [ ] **Step 1: Replace progress / status styles**

In `apps/desktop/src/styles.css`, replace the `.scan-bar*`, `.diag-bar*`, `.banner`, `.error`, `.ok`, `.empty*` blocks with:

```css
/* ── Scan progress bar (Action Blue, no diagonal stripes) ── */
.scan-bar {
  position: relative;
  height: 4px;
  background: var(--divider);
  overflow: hidden;
}
.scan-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--primary);
  transition: width .2s ease;
}
.scan-bar-fill.indeterminate {
  width: 28%;
  animation: scanslide 1.4s linear infinite;
}
@keyframes scanslide {
  0%   { left: -28%; }
  100% { left: 100%; }
}
.scan-bar-label {
  position: absolute;
  top: 8px;
  left: var(--sp-5);
  font-family: var(--font-mono);
  font-size: var(--fs-fine);
  font-weight: var(--fw-strong);
  color: var(--ink-3);
  letter-spacing: var(--ls-flat);
}

/* ── Diagnostics bar ──────────────────────────────────────── */
.diag-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 4px var(--sp-5);
  font-family: var(--font-mono);
  font-size: var(--fs-fine);
  background: var(--canvas-2);
  border-bottom: 1px solid var(--hairline);
  color: var(--ink-2);
}
.diag-bar .diag-label {
  font-weight: var(--fw-strong);
  background: var(--ink);
  color: var(--on-dark);
  padding: 1px 6px;
  border-radius: var(--r-sm);
  letter-spacing: var(--ls-flat);
}
.diag-bar .diag-stats {
  flex: 1;
  overflow-x: auto;
  white-space: nowrap;
}

/* ── Banner / status message ──────────────────────────────── */
.banner {
  padding: 8px var(--sp-5);
  font-size: var(--fs-caption);
  font-weight: var(--fw-strong);
  border-bottom: 1px solid var(--hairline);
}
.banner.preview { background: var(--surface-pearl); color: var(--ink-2); }
.banner.error   { background: var(--risk-high); color: var(--on-primary); }

.error {
  color: var(--ink);
  font-size: var(--fs-caption);
  font-weight: var(--fw-strong);
  background: var(--risk-high);
  color: var(--on-primary);
  border: none;
  border-radius: var(--r-sm);
  padding: 6px 10px;
}
.ok {
  color: var(--ink);
  font-size: var(--fs-caption);
  font-weight: var(--fw-strong);
  background: var(--risk-low);
  color: var(--on-primary);
  border: none;
  border-radius: var(--r-sm);
  padding: 6px 10px;
}

.empty {
  padding: var(--sp-7);
  color: var(--ink-2);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  text-align: center;
}
.empty-title {
  font-size: var(--fs-headline);
  color: var(--ink);
  font-weight: var(--fw-strong);
  letter-spacing: var(--ls-flat);
}
.empty-sub {
  font-size: var(--fs-caption);
  color: var(--ink-3);
  line-height: var(--lh-normal);
}

@media (prefers-reduced-motion: reduce) {
  .scan-bar-fill.indeterminate { animation: none !important; }
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "style(ui): scan-bar / diagnostics / banner / empty — single accent, no diagonal stripes"
```

---

## Phase 5: Modal & Context Menu

### Task 8: Replace modal + context menu + skeleton + provider radio

**Files:**
- Modify: `apps/desktop/src/styles.css` (`.modal-bg`, `.modal`, `.modal-head`, `.field`, `.seg`, `.seg-opt`, `.hint`, `.modal-actions`, `.ctxmenu`, `.ctxmenu-item`, `.ctxmenu-icon`, `.settings-skeleton`, `.skeleton-line`, `.skeleton-field`, `.provider-radio-group`, `.provider-radio`, `.provider-hint`, `.drop-target-forbidden`)

- [ ] **Step 1: Replace modal + context menu + skeleton styles**

In `apps/desktop/src/styles.css`, replace the modal/context-menu/skeleton/provider-radio blocks with:

```css
/* ── Modal ────────────────────────────────────────────────── */
.modal-bg {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.30);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  padding: var(--sp-6);
  width: 480px;
  max-width: 92vw;
  display: grid;
  gap: var(--sp-4);
  box-shadow: var(--shadow-modal);
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font: var(--fw-strong) var(--fs-headline)/var(--lh-tight) var(--font-display);
  letter-spacing: var(--ls-flat);
  color: var(--ink);
}
.field {
  display: grid;
  gap: var(--sp-2);
}
.field > span {
  color: var(--ink-2);
  font-size: var(--fs-caption);
  font-weight: var(--fw-strong);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.seg {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0;
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--canvas);
}
.seg-opt {
  background: var(--canvas);
  color: var(--ink);
  border: 0;
  border-right: 1px solid var(--hairline);
  padding: 8px 10px;
  font-weight: var(--fw-strong);
  font-size: var(--fs-caption);
  cursor: pointer;
  transition: background .12s ease;
}
.seg-opt:last-child { border-right: 0; }
.seg-opt:hover { background: var(--surface-pearl); }
.seg-opt.active {
  background: var(--primary);
  color: var(--on-primary);
}
.hint {
  margin: 0;
  padding: 10px 14px;
  background: var(--surface-pearl);
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  font-size: var(--fs-caption);
  font-weight: var(--fw-regular);
  color: var(--ink-2);
  display: flex;
  gap: var(--sp-2);
  align-items: flex-start;
  line-height: var(--lh-normal);
}
.hint svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--primary);
}
.hint > span { flex: 1; min-width: 0; }
.hint a { color: var(--primary); font-weight: var(--fw-strong); }
.hint code {
  background: var(--canvas);
  padding: 0 4px;
  font-size: var(--fs-fine);
  border-radius: 3px;
}
.modal-actions {
  display: flex;
  gap: var(--sp-2);
  justify-content: flex-end;
}

/* ── Context menu (right-click) ───────────────────────────── */
.ctxmenu {
  position: fixed;
  z-index: 1000;
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-product);
  padding: 4px;
  display: flex;
  flex-direction: column;
  font-size: var(--fs-caption);
  user-select: none;
  min-width: 160px;
}
.ctxmenu-item {
  background: transparent;
  border: 0;
  border-radius: var(--r-sm);
  padding: 6px 12px;
  text-align: left;
  cursor: pointer;
  color: var(--ink);
  font-weight: var(--fw-regular);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.ctxmenu-item:hover { background: var(--surface-pearl); }
.ctxmenu-item.danger { color: var(--risk-high); }
.ctxmenu-item.danger:hover { background: rgba(208, 74, 74, 0.08); }
.ctxmenu-icon {
  display: inline-flex;
  align-items: center;
  color: var(--ink-3);
}

/* ── Skeleton loading ─────────────────────────────────────── */
@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.30; }
  50%      { opacity: 1; }
}
.settings-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  padding: var(--sp-3) 0;
}
.skeleton-line,
.skeleton-field {
  height: 14px;
  border-radius: var(--r-sm);
  background: var(--divider);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}
.skeleton-field { height: 36px; }

/* ── Provider radio group (Settings) ──────────────────────── */
.provider-radio-group {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
  margin-top: var(--sp-1);
}
.provider-radio {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 6px 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-pill);
  font-size: var(--fs-caption);
  font-weight: var(--fw-strong);
  cursor: pointer;
  transition: border-color .12s ease, background .12s ease;
}
.provider-radio:has(input:checked) {
  border-color: var(--primary);
  background: rgba(0, 102, 204, 0.06);
}
.provider-radio input { accent-color: var(--primary); }
.provider-hint {
  font-size: var(--fs-fine);
  color: var(--ink-3);
  margin-top: var(--sp-1);
}
.provider-hint strong { color: var(--ink); font-weight: var(--fw-strong); }

/* ── Drop-target guard ────────────────────────────────────── */
.drop-target-forbidden,
.drop-target-forbidden * { cursor: not-allowed !important; }
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean. Settings modal will visually change; functional behaviour unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "style(ui): modal + context menu + skeleton + provider radio — hairline borders, focus ring"
```

---

## Phase 6: Toast

### Task 9: Replace toast styles

**Files:**
- Modify: `apps/desktop/src/styles.css` (`.toast-container`, `.toast-item`, `.toast-success`, `.toast-error`, `.toast-info`, `.toast-close`, `@keyframes toast-in`)

- [ ] **Step 1: Replace toast styles**

In `apps/desktop/src/styles.css`, replace the `.toast-*` and `@keyframes toast-in` blocks with:

```css
/* ── Toast ────────────────────────────────────────────────── */
.toast-container {
  position: fixed;
  bottom: var(--sp-7);
  right: var(--sp-5);
  z-index: 999;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  pointer-events: none;
}
.toast-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 10px 14px;
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-product);
  font-size: var(--fs-caption);
  font-weight: var(--fw-strong);
  color: var(--ink);
  cursor: pointer;
  pointer-events: auto;
  animation: toast-in 0.20s ease-out;
  max-width: 360px;
}
.toast-item:hover { background: var(--surface-pearl); }
.toast-success { border-left: 3px solid var(--risk-low); }
.toast-error   { border-left: 3px solid var(--risk-high); }
.toast-info    { border-left: 3px solid var(--primary); }
.toast-item svg { flex-shrink: 0; }
.toast-success svg { color: var(--risk-low); }
.toast-error   svg { color: var(--risk-high); }
.toast-info    svg { color: var(--primary); }
.toast-item span { flex: 1; min-width: 0; }
.toast-close {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: var(--ink-3);
  display: flex;
  align-items: center;
}
.toast-close:hover { color: var(--ink); }
@keyframes toast-in {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0); opacity: 1; }
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "style(ui): toast — rounded-md cards with left accent strip, soft shadow"
```

---

### Task 10: Light pass on TreeView tokens

**Files:**
- Modify: `apps/desktop/src/styles.css` (`.treeview`, `.tree-headrow`, `.tree-row`, `.badge`, `.pct-bar`, etc.)

- [ ] **Step 1: Replace tree-row + badge styles**

In `apps/desktop/src/styles.css`, replace the `.treeview` through `.badge` and tree-specific pct-bar styles with:

```css
/* ── WizTree-style tree (left panel) — token-light pass ──── */
.treeview {
  display: flex;
  flex-direction: column;
  height: 100%;
  user-select: none;
  background: var(--canvas);
  font-size: var(--fs-caption);
}
.tree-headrow, .tree-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px 64px 52px;
  align-items: center;
  column-gap: var(--sp-2);
  padding: 0 10px 0 4px;
  white-space: nowrap;
}
.tree-headrow {
  height: 28px;
  font-family: var(--font-body);
  font-size: var(--fs-fine);
  font-weight: var(--fw-strong);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  background: var(--canvas-2);
  border-bottom: 1px solid var(--hairline);
  position: sticky;
  top: 0;
  z-index: 2;
}
.tree-headrow .col-name { padding-left: var(--sp-2); }
.tree-headrow .col-pct { text-align: left; }
.tree-headrow .col-size,
.tree-headrow .col-count { text-align: right; }
.tree-body { flex: 1; overflow: auto; }
.tree-row {
  height: 24px;
  cursor: pointer;
  font-weight: var(--fw-regular);
  border-bottom: 1px solid var(--divider);
  transition: background .08s ease;
}
.tree-row:hover { background: var(--surface-pearl); }
.tree-row.selected {
  background: rgba(0, 102, 204, 0.08);
  color: var(--ink);
  font-weight: var(--fw-strong);
}
.tree-row.is-file .name { color: var(--ink-2); }
.tree-row.is-truncated { cursor: default; background: transparent; }
.tree-row.is-truncated:hover { background: transparent; }
.tree-row.is-truncated .name { color: var(--ink-3); font-style: italic; }
.tree-row .col-name {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  min-width: 0;
  overflow: hidden;
}
.tree-row .caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  color: var(--ink-3);
}
.tree-row .caret-stub { display: inline-block; width: 11px; }
.tree-row .glyph {
  display: inline-flex;
  align-items: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--ink-3);
}
.tree-row .name {
  font-family: var(--font-body);
  font-size: var(--fs-caption);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.tree-row .badge {
  flex-shrink: 0;
  margin-left: var(--sp-1);
  font-size: 10px;
  padding: 0 6px;
}
.tree-row .col-pct {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  font-family: var(--font-mono);
  font-size: var(--fs-fine);
  font-variant-numeric: tabular-nums;
  color: var(--ink-3);
}
.tree-row .pct-bar {
  flex: 1;
  height: 4px;
  background: var(--divider);
  border-radius: 2px;
  overflow: hidden;
  min-width: 24px;
}
.tree-row .pct-bar > span { display: block; height: 100%; background: var(--primary); }
.tree-row .pct-num { width: 38px; text-align: right; flex-shrink: 0; }
.tree-row .col-size, .tree-row .col-count {
  font-family: var(--font-mono);
  font-size: var(--fs-fine);
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--ink-2);
}
.tree-row .col-count { color: var(--ink-3); }
.tree-row.selected .col-size,
.tree-row.selected .col-count,
.tree-row.selected .col-pct,
.tree-row.selected .caret { color: var(--ink); }
.tree-row[draggable="true"] { cursor: default; }
.tree-row[draggable="true"]:active { cursor: grabbing; }

/* ── Badge (used by Tree + a few other places) ───────────── */
.badge {
  background: var(--surface-pearl);
  color: var(--ink-2);
  border: 1px solid var(--hairline);
  padding: 1px 8px;
  border-radius: var(--r-pill);
  font-size: 10px;
  font-weight: var(--fw-strong);
  letter-spacing: var(--ls-flat);
  display: inline-block;
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "style(ui): tree-view token-light pass — hairline rows, soft selection, Action Blue pct bar"
```

---

## Phase 7: Studio Panel — Container & Head

### Task 11: Replace Studio container + head

**Files:**
- Modify: `apps/desktop/src/components/Studio.css` (`.studio`, `.studio.stale`, `.studio-head`, `.studio-head-actions`, `.studio-prune-msg`, `.studio-section-label`)

- [ ] **Step 1: Replace Studio container block**

In `apps/desktop/src/components/Studio.css`, replace the `.studio` through `.studio-section-label` blocks with:

```css
/* ── Studio (right panel) ─────────────────────────────────── */
.studio {
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  background: var(--canvas);
}
.studio.stale { opacity: 0.45; pointer-events: none; transition: opacity 200ms ease; }

.studio-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--font-body);
  font-weight: var(--fw-strong);
  font-size: var(--fs-headline);
  color: var(--ink);
  letter-spacing: var(--ls-flat);
  padding: var(--sp-2) var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--hairline);
  margin-bottom: var(--sp-1);
}
.studio-head-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.studio-prune-msg {
  padding: 2px var(--sp-2);
  font-size: var(--fs-fine);
  color: var(--ink-3);
}
.studio-section-label {
  font-family: var(--font-body);
  font-size: var(--fs-fine);
  font-weight: var(--fw-strong);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-3);
  margin: var(--sp-3) var(--sp-2) var(--sp-1);
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/Studio.css
git commit -m "style(studio): container + head — 21px headline on hairline divider"
```

---

### Task 12: Replace Studio cards

**Files:**
- Modify: `apps/desktop/src/components/Studio.css` (`.studio-grid`, `.studio-card`, `.studio-card-icon`, `.studio-card-body`, `.studio-card-name`, `.studio-card-meta`, `.studio-card-wrap`, `.studio-caret`)

- [ ] **Step 1: Replace Studio card styles**

In `apps/desktop/src/components/Studio.css`, replace the `.studio-grid` through `.studio-caret` blocks with:

```css
.studio-grid {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.studio-card {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--ink);
  transition: border-color .12s ease, box-shadow .12s ease, background .12s ease;
}
.studio-card:hover {
  border-color: var(--hairline-strong);
  box-shadow: var(--shadow-product);
}
.studio-card:active { transform: scale(0.99); }
.studio-card.detected {
  background: var(--canvas);
  border-color: var(--primary);
}
.studio-card.detected .studio-card-meta { color: var(--ink-2); }
.studio-card.risk-high { border-left: 3px solid var(--risk-high); padding-left: calc(var(--sp-4) - 2px); }

.studio-card-icon {
  font-size: 18px;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--canvas-2);
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  flex-shrink: 0;
}
.studio-card-icon.small { font-size: 14px; width: 24px; height: 24px; border-radius: var(--r-sm); }

.studio-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.studio-card-name {
  font-weight: var(--fw-strong);
  font-size: var(--fs-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ink);
}
.studio-card-meta {
  font-family: var(--font-mono);
  font-size: var(--fs-fine);
  font-weight: var(--fw-regular);
  color: var(--ink-3);
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
}

.studio-card-wrap {
  display: flex;
  flex-direction: column;
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  overflow: hidden;
  transition: box-shadow .12s ease, border-color .12s ease;
}
.studio-card-wrap:hover {
  border-color: var(--hairline-strong);
  box-shadow: var(--shadow-product);
}
.studio-card-wrap.detected { border-color: var(--primary); }
.studio-card-wrap.risk-low    { border-left: 3px solid var(--risk-low); }
.studio-card-wrap.risk-medium { border-left: 3px solid var(--risk-medium); }
.studio-card-wrap.risk-high   { border-left: 3px solid var(--risk-high); }

.studio-card-wrap > .studio-card {
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  width: 100%;
}
.studio-card-wrap > .studio-card:hover {
  background: var(--surface-pearl);
  transform: none;
  box-shadow: none;
}
.studio-card-wrap > .studio-card:active { transform: none; box-shadow: none; }

.studio-caret { color: var(--ink-3); flex-shrink: 0; }
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/Studio.css
git commit -m "style(studio): cards — hairline border, primary tint when detected, left risk strip"
```

---

### Task 13: Replace Studio expanded + details

**Files:**
- Modify: `apps/desktop/src/components/Studio.css` (`.studio-card-expanded`, `.studio-detail-row`, `.studio-detail-label`, `.studio-detail-path`, `.studio-detail-paths`, `.studio-detail-suffix`, `.studio-top-children-head`, `.studio-toggle-btn`, `.studio-disclaimer-text`, `.studio-top-cta`, `.studio-children`, `.studio-children li`, `.studio-child-name`, `.studio-ask-btn`, `.studio-card-actions`, `.studio-cleanup-btn`)

- [ ] **Step 1: Replace Studio expanded styles**

In `apps/desktop/src/components/Studio.css`, replace the `.studio-card-expanded` through `.studio-cleanup-btn` blocks with:

```css
.studio-card-expanded {
  border-top: 1px solid var(--hairline);
  padding: var(--sp-3) var(--sp-4);
  background: var(--canvas);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  font-size: var(--fs-caption);
}
.studio-detail-row {
  display: flex;
  gap: var(--sp-2);
  align-items: baseline;
}
.studio-detail-label {
  font-family: var(--font-body);
  font-size: var(--fs-fine);
  font-weight: var(--fw-strong);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}
.studio-detail-path {
  font-family: var(--font-mono);
  font-size: var(--fs-fine);
  word-break: break-all;
  cursor: grab;
  flex: 1;
  color: var(--ink-2);
}
.studio-detail-path:active { cursor: grabbing; }
.studio-detail-paths {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.studio-detail-suffix { margin-left: var(--sp-1); }
.studio-top-children-head {
  margin-top: var(--sp-2);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.studio-toggle-btn {
  font-size: var(--fs-fine);
  padding: 2px 10px;
}
.studio-disclaimer-text { margin: var(--sp-1) 0; }
.studio-top-cta { margin-top: var(--sp-2); }

.studio-children {
  list-style: none;
  margin: var(--sp-1) 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.studio-children li {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: 4px var(--sp-2);
  border-radius: var(--r-sm);
  cursor: grab;
  font-size: var(--fs-caption);
}
.studio-children li:hover { background: var(--surface-pearl); }
.studio-children li:active { cursor: grabbing; }
.studio-child-name {
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.studio-ask-btn {
  margin-top: var(--sp-2);
  width: 100%;
  justify-content: center;
}

.studio-card-actions {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.studio-cleanup-btn {
  width: 100%;
  justify-content: center;
  font-weight: var(--fw-strong);
}
.studio-card-actions .studio-ask-btn {
  margin-top: 0;
  width: auto;
  padding-left: 14px;
  padding-right: 14px;
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/Studio.css
git commit -m "style(studio): expanded card details — hairline divider, soft hover rows"
```

---

### Task 14: Replace Studio tool cards (keep out-of-scope classes at bottom)

**Files:**
- Modify: `apps/desktop/src/components/Studio.css` (`.tool-card-wrap`, `.tool-card`, `.tool-card-arrow`, `.tool-card-icon`)

- [ ] **Step 1: Replace tool card styles**

In `apps/desktop/src/components/Studio.css`, replace the `.tool-card-*` blocks with:

```css
/* ── Tool card (Studio "工具") ────────────────────────────── */
.tool-card-wrap .tool-card {
  border-color: var(--hairline);
}
.tool-card .tool-card-arrow {
  color: var(--ink-3);
}
.tool-card .tool-card-icon {
  background: var(--canvas-2);
  color: var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/Studio.css
git commit -m "style(studio): tool card chrome — neutral hairline, no lavender accent"
```

---

## Phase 8: ChatPanel

### Task 15: Replace Chat container + head

**Files:**
- Modify: `apps/desktop/src/components/ChatPanel.css` (`.chat`, `.chat.drop-target::after`, `.chat-head`, `.chat-head > svg`, `.chat-title`, `.chat-sub`, `.chat-scroll`, `.chat-hero`)

- [ ] **Step 1: Replace Chat container styles**

In `apps/desktop/src/components/ChatPanel.css`, replace the `.chat` through `.chat-hero` blocks with:

```css
/* ── Chat panel ───────────────────────────────────────────── */
.chat {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--canvas-2);
  position: relative;
}
.chat.drop-target::after {
  content: "拖到这里把它发给 AI";
  position: absolute;
  inset: var(--sp-2);
  border: 2px dashed var(--primary);
  border-radius: var(--r-lg);
  background: rgba(0, 102, 204, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-body);
  font-weight: var(--fw-strong);
  font-size: var(--fs-body);
  color: var(--primary);
  z-index: 5;
  pointer-events: none;
}
.chat-head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-5);
  border-bottom: 1px solid var(--hairline);
  background: var(--canvas);
}
.chat-head > svg { color: var(--primary); }
.chat-title {
  font-family: var(--font-body);
  font-weight: var(--fw-strong);
  font-size: var(--fs-body-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ink);
  letter-spacing: var(--ls-flat);
}
.chat-sub {
  color: var(--ink-3);
  font-size: var(--fs-fine);
  font-weight: var(--fw-regular);
  margin-top: 2px;
}
.chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-5) var(--sp-6);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  background: var(--canvas-2);
}
.chat-hero {
  margin: auto;
  padding: var(--sp-7) var(--sp-6);
  text-align: center;
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  background: var(--canvas);
  max-width: 480px;
  display: grid;
  gap: var(--sp-2);
  justify-items: center;
}
.chat-hero h3 {
  font-family: var(--font-body);
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-headline);
  font-weight: var(--fw-strong);
  color: var(--ink);
  letter-spacing: var(--ls-flat);
}
.chat-hero p {
  margin: 0;
  color: var(--ink-2);
  font-weight: var(--fw-regular);
  line-height: var(--lh-normal);
  font-size: var(--fs-caption);
}
.chat-hero p.muted { font-size: var(--fs-fine); }
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/ChatPanel.css
git commit -m "style(chat): container + head + hero — white head on parchment, hairline hero card"
```

---

### Task 16: Replace Chat bubble base + system + user

**Files:**
- Modify: `apps/desktop/src/components/ChatPanel.css` (`.chat-turn`, `.chat-bubble`, `.chat-turn.user .chat-bubble`, `.chat-turn.assistant .chat-bubble`, `.chat-turn.system .chat-bubble`, `.chat-turn.pending .chat-bubble`, `@keyframes chat-fade-in`)

- [ ] **Step 1: Replace bubble base styles**

In `apps/desktop/src/components/ChatPanel.css`, replace the bubble base + keyframes blocks with:

```css
/* === Chat layout =========================================== */
.chat-turn {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin-bottom: var(--sp-4);
  animation: chat-fade-in 220ms ease-out both;
}
.chat-turn.user      { align-items: flex-end; }
.chat-turn.assistant { align-items: stretch; max-width: 100%; }
.chat-turn.system    { align-items: center; }

@keyframes chat-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* === Common bubble base ==================================== */
.chat-bubble {
  font-size: var(--fs-body);
  font-weight: var(--fw-regular);
  line-height: var(--lh-relaxed);
  letter-spacing: var(--ls-snug);
  word-break: break-word;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

/* User bubble */
.chat-turn.user .chat-bubble {
  max-width: 80%;
  padding: 10px 14px;
  border: none;
  border-radius: var(--r-lg) var(--r-lg) var(--r-sm) var(--r-lg);
  background: var(--primary);
  color: var(--on-primary);
  white-space: pre-wrap;
  font-weight: var(--fw-regular);
}

/* Assistant bubble */
.chat-turn.assistant .chat-bubble {
  position: relative;
  width: 100%;
  padding: 12px 16px 12px 18px;
  border: 1px solid var(--hairline);
  border-left: 2px solid var(--primary);
  border-radius: var(--r-lg) var(--r-lg) var(--r-lg) var(--r-sm);
  background: var(--canvas);
  color: var(--ink-2);
}

/* System bubble */
.chat-turn.system .chat-bubble {
  background: var(--surface-pearl);
  color: var(--ink-2);
  font-size: var(--fs-fine);
  font-weight: var(--fw-strong);
  padding: 4px 12px;
  border-radius: var(--r-pill);
  white-space: pre-wrap;
  border: 1px solid var(--hairline);
}

/* Pending state */
.chat-turn.pending .chat-bubble { opacity: 0.7; }
.chat-turn.pending .chat-bubble::after {
  content: "…";
  display: inline-block;
  margin-left: var(--sp-1);
  animation: chat-typing 1.4s steps(3) infinite;
}
@keyframes chat-typing {
  0%, 20%   { content: "·"; }
  40%       { content: "··"; }
  60%, 100% { content: "···"; }
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/ChatPanel.css
git commit -m "style(chat): bubbles — user primary pill, assistant white+accent-bar, system pill"
```

---

### Task 17: Replace Chat markdown rendering

**Files:**
- Modify: `apps/desktop/src/components/ChatPanel.css` (all `.chat-turn.assistant .chat-bubble > ...` markdown selectors)

- [ ] **Step 1: Replace markdown styles**

In `apps/desktop/src/components/ChatPanel.css`, replace the entire markdown rendering block (everything from `/* === Markdown inside assistant bubble ====================================== */` through `.chat-bubble.assistant table`/`.chat-bubble.assistant tr:nth-child(even) td` rules) with:

```css
/* === Markdown inside assistant bubble ====================== */
.chat-turn.assistant .chat-bubble > *:first-child { margin-top: 0; }
.chat-turn.assistant .chat-bubble > *:last-child  { margin-bottom: 0; }

.chat-turn.assistant .chat-bubble p {
  margin: 0 0 10px;
  line-height: var(--lh-relaxed);
  color: var(--ink-2);
}
.chat-turn.assistant .chat-bubble p:last-child { margin-bottom: 0; }

.chat-turn.assistant .chat-bubble h1,
.chat-turn.assistant .chat-bubble h2,
.chat-turn.assistant .chat-bubble h3,
.chat-turn.assistant .chat-bubble h4 {
  margin: 14px 0 var(--sp-2);
  font-weight: var(--fw-strong);
  line-height: var(--lh-snug);
  color: var(--ink);
  letter-spacing: var(--ls-flat);
}
.chat-turn.assistant .chat-bubble h1 { font-size: 17px; }
.chat-turn.assistant .chat-bubble h2 {
  font-size: 15px;
  padding-bottom: var(--sp-1);
  border-bottom: 1px solid var(--divider);
}
.chat-turn.assistant .chat-bubble h3 {
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
}
.chat-turn.assistant .chat-bubble h3::before {
  content: "";
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: var(--r-full);
  background: var(--primary);
  flex-shrink: 0;
}
.chat-turn.assistant .chat-bubble h4 {
  font-size: 13px;
  color: var(--ink-2);
}

.chat-turn.assistant .chat-bubble strong {
  font-weight: var(--fw-strong);
  color: var(--ink);
}
.chat-turn.assistant .chat-bubble em { font-style: italic; color: var(--ink-2); }

.chat-turn.assistant .chat-bubble ul,
.chat-turn.assistant .chat-bubble ol {
  margin: var(--sp-2) 0 12px;
  padding-left: var(--sp-1);
  list-style: none;
}
.chat-turn.assistant .chat-bubble li {
  margin: 3px 0;
  line-height: var(--lh-relaxed);
  padding-left: 18px;
  position: relative;
}
.chat-turn.assistant .chat-bubble ul > li::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 0.7em;
  width: 4px;
  height: 4px;
  border-radius: var(--r-full);
  background: var(--primary);
  opacity: 0.85;
}
.chat-turn.assistant .chat-bubble ol { counter-reset: ord; }
.chat-turn.assistant .chat-bubble ol > li { counter-increment: ord; }
.chat-turn.assistant .chat-bubble ol > li::before {
  content: counter(ord) ".";
  position: absolute;
  left: 0;
  top: 0;
  font-weight: var(--fw-strong);
  color: var(--primary);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  line-height: var(--lh-relaxed);
  width: 18px;
  text-align: right;
  padding-right: 4px;
}
.chat-turn.assistant .chat-bubble li > p { margin: 0; display: inline; }
.chat-turn.assistant .chat-bubble li > ul,
.chat-turn.assistant .chat-bubble li > ol { margin: 3px 0; }

.chat-turn.assistant .chat-bubble code {
  background: var(--surface-pearl);
  border: none;
  border-radius: var(--r-sm);
  padding: 1px 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
  font-weight: var(--fw-regular);
  white-space: nowrap;
}
.chat-turn.assistant .chat-bubble pre {
  position: relative;
  background: var(--tile-dark-1);
  color: var(--on-dark);
  border: none;
  border-radius: var(--r-md);
  padding: 12px 14px;
  margin: 10px 0 12px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.65;
}
.chat-turn.assistant .chat-bubble pre code {
  background: transparent;
  border: none;
  padding: 0;
  color: inherit;
  white-space: pre;
  font-weight: var(--fw-regular);
}
.chat-turn.assistant .chat-bubble blockquote {
  margin: 8px 0 12px;
  padding: 6px 12px;
  border-left: 2px solid var(--primary);
  background: var(--surface-pearl);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  color: var(--ink-2);
  font-style: normal;
}
.chat-turn.assistant .chat-bubble blockquote p { margin: 0; }
.chat-turn.assistant .chat-bubble a {
  color: var(--primary);
  text-decoration: none;
  border-bottom: 1px solid rgba(0, 102, 204, 0.4);
  transition: border-color 120ms ease;
}
.chat-turn.assistant .chat-bubble a:hover { border-bottom-color: var(--primary); }
.chat-turn.assistant .chat-bubble hr {
  border: none;
  height: 1px;
  background: var(--divider);
  margin: 14px 0;
}
.chat-turn.assistant .chat-bubble table {
  border-collapse: separate;
  border-spacing: 0;
  margin: 8px 0 12px;
  font-size: 12px;
  width: 100%;
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  overflow: hidden;
}
.chat-turn.assistant .chat-bubble th,
.chat-turn.assistant .chat-bubble td {
  border-bottom: 1px solid var(--divider);
  padding: 6px 10px;
  text-align: left;
}
.chat-turn.assistant .chat-bubble tr:last-child td { border-bottom: none; }
.chat-turn.assistant .chat-bubble th {
  background: var(--surface-pearl);
  font-weight: var(--fw-strong);
  color: var(--ink-2);
  font-size: 11.5px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.chat-turn.assistant .chat-bubble tr:nth-child(even) td {
  background: var(--canvas-2);
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/ChatPanel.css
git commit -m "style(chat): markdown — hairline dividers, pearl code, dark-tile pre, primary bullets"
```

---

### Task 18: Replace Chat actions + advice pill + input area

**Files:**
- Modify: `apps/desktop/src/components/ChatPanel.css` (`.chat-actions`, `.advice-pill`, `.advice-pill.advice-fallback`, `.chat-typing`, `.chat-input-wrap`, `.chat-pills`, `.chat-pill`, `.chat-pill button`, `.chat-input`, `.chat-input textarea`, `.chat-attach`, `.chat-image-pills`, `.chat-image-pill`, `.chat-image-pill img`, `.chat-image-pill button`, `.chat-scroll-btn`, `.advice-scaffold-link`)

- [ ] **Step 1: Replace chat input + actions styles**

In `apps/desktop/src/components/ChatPanel.css`, replace the actions / advice / input / image-pill / scroll-btn / scaffold-link blocks with:

```css
/* === Chat actions / advice pills ========================== */
.chat-actions {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
  align-items: center;
}
.advice-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 4px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-pill);
  background: var(--canvas);
  font-size: var(--fs-fine);
  font-weight: var(--fw-strong);
  color: var(--ink-2);
}
.advice-pill .badge { background: var(--canvas-2); }
.advice-pill.advice-fallback {
  border-color: var(--risk-high);
  background: rgba(208, 74, 74, 0.08);
  border-style: dashed;
}
.advice-pill.advice-fallback strong { color: var(--risk-high); }
.chat-typing {
  font-size: var(--fs-fine);
  color: var(--ink-3);
  font-weight: var(--fw-strong);
  align-self: flex-start;
  padding: 4px 8px;
}

/* === Chat input ============================================ */
.chat-input-wrap {
  border-top: 1px solid var(--hairline);
  background: var(--canvas);
  padding: var(--sp-3) var(--sp-4);
}
.chat-pills {
  display: flex;
  gap: var(--sp-1);
  flex-wrap: wrap;
  margin-bottom: var(--sp-2);
}
.chat-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 3px 4px 3px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-pill);
  background: var(--surface-pearl);
  font-family: var(--font-mono);
  font-size: var(--fs-fine);
  font-weight: var(--fw-regular);
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-pill button {
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: var(--r-full);
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  margin-left: 2px;
}
.chat-input {
  display: flex;
  gap: var(--sp-2);
  align-items: flex-end;
}
.chat-input textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  padding: 8px 12px;
  font-family: var(--font-body);
  font-size: var(--fs-body);
  background: var(--canvas);
  outline: none;
  letter-spacing: var(--ls-snug);
  line-height: var(--lh-snug);
}
.chat-input textarea:focus {
  border-color: var(--primary);
  box-shadow: var(--ring-focus);
}
.chat-input textarea:disabled {
  background: var(--canvas-2);
  opacity: 0.7;
}
.chat-attach {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--hairline);
  border-radius: var(--r-full);
  background: var(--canvas);
  flex-shrink: 0;
  cursor: pointer;
  transition: background .12s ease, border-color .12s ease;
}
.chat-attach:hover:not(:disabled) {
  background: var(--surface-pearl);
  border-color: var(--hairline-strong);
}
.chat-attach:disabled { opacity: 0.5; cursor: not-allowed; }

/* === Image pills (in input) ================================ */
.chat-image-pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
  margin-bottom: var(--sp-1);
}
.chat-image-pill {
  position: relative;
  display: inline-block;
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  overflow: hidden;
  width: 48px;
  height: 48px;
  background: var(--canvas-2);
}
.chat-image-pill img { width: 100%; height: 100%; object-fit: cover; display: block; }
.chat-image-pill button {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 16px;
  height: 16px;
  border-radius: var(--r-full);
  border: 1px solid var(--hairline);
  background: var(--canvas);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.chat-image-pill button:hover { background: var(--surface-pearl); }

/* === Scroll-to-bottom button =============================== */
.chat-scroll-btn {
  position: sticky;
  bottom: 0;
  align-self: center;
  padding: 4px 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-pill);
  background: var(--canvas);
  font-size: var(--fs-fine);
  font-weight: var(--fw-strong);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  z-index: 3;
  animation: chat-scroll-pop 0.2s ease-out;
  color: var(--ink-2);
}
.chat-scroll-btn:hover { background: var(--surface-pearl); }
@keyframes chat-scroll-pop {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* === Inline scaffold link inside advice ==================== */
.advice-scaffold-link {
  border: 1px solid var(--primary);
  border-radius: var(--r-pill);
  padding: 1px 10px;
  font-size: 10px;
  font-weight: var(--fw-strong);
  background: var(--canvas);
  color: var(--primary);
  cursor: pointer;
  white-space: nowrap;
}
.advice-scaffold-link:hover { background: rgba(0, 102, 204, 0.06); }
```

- [ ] **Step 2: Verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/ChatPanel.css
git commit -m "style(chat): actions + advice + input — pearl pills, rounded-md textarea, focus ring"
```

---

## Phase 9: Settings Micro-tweaks

### Task 19: Settings modal JSX micro-adjustment (if needed)

**Files:**
- Modify: `apps/desktop/src/components/Settings.tsx` (only if existing classNames don't already produce the desired result)

- [ ] **Step 1: Inspect existing JSX**

In `apps/desktop/src/components/Settings.tsx`, verify:
- All buttons already use `className="primary"`, `className="ghost"`, `className="ghost icon"`, `className="ghost"`, etc.
- No className references the old `pink-*` token, `paper-*` token, or hard `box-shadow` values.

If everything is already using the standard classNames, **skip this task and go to Task 20**. The new `styles.css` will pick up the new visuals automatically.

If anything needs changing, the expected changes are minimal (0-3 lines), e.g.:
- Replace `className="ghost icon"` (no semantic change) — **keep as is**; it maps to the new `button.ghost.icon` ruleset
- Add `className="btn-utility"` is **NOT** needed because legacy names are mapped

- [ ] **Step 2: If changes were made, verify build**

```bash
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
```
Expected: clean. If no changes were made, no commit is needed.

- [ ] **Step 3: If changes were made, commit**

```bash
git add apps/desktop/src/components/Settings.tsx
git commit -m "style(settings): minor className alignment (if any)"
```

---

## Phase 10: Final Verification

### Task 20: Full verification sweep

**Files:**
- (no file changes; this is a verification gate)

- [ ] **Step 1: Run the full verification chain**

```bash
cd E:/Y/pinkbin/pinkbin
pnpm -C apps/desktop exec tsc --noEmit
pnpm -C apps/desktop exec vite build
pnpm -C apps/desktop exec vitest run
cargo check -p pinkbin-desktop
```

Expected: every command exits 0. Tests pass. No new TypeScript errors. No new Vite warnings.

- [ ] **Step 2: Walk the visual checklist from the spec**

Open the visual checklist from `docs/superpowers/specs/2026-06-15-pinkbin-frontend-rebeautify-design.md` and verify each item visually using `pnpm tauri dev` and a screenshot tool:

- [ ] Single Action Blue (`#0066cc`) used for every interactive element
- [ ] No `3px 3px 0`, `5px 5px 0`, `8px 8px 0` hard offset shadows anywhere in compiled CSS

  Verification: `grep -rE '(3|5|8)px (3|5|8)px 0 var\(--ink\)' apps/desktop/src/`
  Expected: no matches.

- [ ] All primary CTA shapes are pill (`border-radius: 9999px`)
- [ ] Body font size is 14px
- [ ] Inter font is loading (DevTools Network tab shows `Inter` request; computed font-family includes `Inter`)
- [ ] Tree-view selected row uses primary tint
- [ ] Chat assistant bubble has 2px primary left accent

- [ ] **Step 3: Commit final fixes if any**

If any visual issues were found and fixed, commit them as a single cleanup commit:

```bash
git add -A
git commit -m "style(ui): visual checklist cleanup after re-beautify"
```

If no fixes were needed, no commit.

---

## Self-Review

After completing the plan, the following checks were run:

1. **Spec coverage** — each spec section maps to a task:
   - Token system (Color, Typography, Spacing, Shape, Elevation) → Task 2
   - Body / global type → Task 3
   - App shell + layout → Task 4
   - Buttons → Task 5
   - Inputs → Task 6
   - Status / progress / banner / empty → Task 7
   - Modal / context menu / skeleton / provider radio → Task 8
   - Toast → Task 9
   - Tree-view token pass → Task 10
   - Studio container + head → Task 11
   - Studio cards → Task 12
   - Studio expanded → Task 13
   - Studio tool cards → Task 14
   - Chat container + head → Task 15
   - Chat bubbles → Task 16
   - Chat markdown → Task 17
   - Chat input + actions → Task 18
   - Settings JSX → Task 19
   - Final verification → Task 20

2. **No placeholders** — every task has concrete CSS, no `TBD` / `TODO` / "implement later".

3. **Type consistency** — only one `--primary` token throughout. No function/method renames. Class names unchanged (per the className 迁移策略).

4. **Commits** — 20 commits, each atomic, each independently revertable.

5. **Verification** — every task has explicit `tsc --noEmit` + `vite build` gate.

---

## Execution Handoff

This plan is ready. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Best for parallel work and clean context per task.
2. **Inline Execution** — execute tasks in this session with checkpoints for review. Best when you want to keep context warm.
