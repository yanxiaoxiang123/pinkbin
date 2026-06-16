// Re-export from the split store modules. Existing `import { useStore } from '../store'`
// continues to work — the only change is internal organization.
export { useStore } from './store/index';
export type { AppState } from './store/index';
export type { ChatTurn, ToastMsg } from './store/index';