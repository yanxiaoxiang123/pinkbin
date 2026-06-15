// `window.__TAURI__` is the public runtime marker injected by Tauri 2; the
// `@tauri-apps/api/core` `isTauri()` function itself just checks
// `'__TAURI__' in window`. The previous `__TAURI_INTERNALS__` check rode on
// an internal symbol that has changed shape between Tauri 1 and 2 and
// isn't covered by the public API contract.

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

export const isTauri =
  typeof window !== 'undefined' && '__TAURI__' in window;