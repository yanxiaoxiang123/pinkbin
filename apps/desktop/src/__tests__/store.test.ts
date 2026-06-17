import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import type { Node } from '../types';

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    name: 'test',
    path: 'C:\\test',
    is_dir: true,
    size: 1024,
    file_count: 10,
    children: [],
    top_extensions: [],
    scaffold_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  // Reset the store to defaults between tests.
  useStore.setState({
    root: null,
    scaffolds: [],
    selectedPath: null,
    chatNode: null,
    chatScaffoldId: null,
    chatTurns: [],
    chatBusy: false,
    chatAbort: null,
    studioRequest: null,
    reclaimedBytes: 0,
    toasts: [],
    scanInProgress: false,
    studioExpanded: [],
  });
});

describe('setRoot / selectPath', () => {
  it('sets root and selectedPath', () => {
    const node = makeNode();
    useStore.getState().setRoot(node);
    expect(useStore.getState().root?.path).toBe('C:\\test');
  });

  it('selects a path', () => {
    useStore.getState().selectPath('C:\\test');
    expect(useStore.getState().selectedPath).toBe('C:\\test');
  });
});

describe('setScaffolds', () => {
  it('replaces scaffold list', () => {
    const sc = [{ id: 'test', name: 'Test', risk: 'low' as const, disclaimer: '', detect: [], match: { name_contains: [] }, scopes: [] }];
    useStore.getState().setScaffolds(sc);
    expect(useStore.getState().scaffolds).toHaveLength(1);
    expect(useStore.getState().scaffolds[0]!.id).toBe('test');
  });
});

describe('chat actions', () => {
  it('pushChatTurn appends a turn', () => {
    useStore.getState().pushChatTurn({ id: '1', role: 'user', text: 'hello' });
    expect(useStore.getState().chatTurns).toHaveLength(1);
    expect(useStore.getState().chatTurns[0]!.text).toBe('hello');
  });

  it('patchChatTurn updates a turn by id', () => {
    useStore.getState().pushChatTurn({ id: '1', role: 'assistant', text: 'old', pending: true });
    useStore.getState().patchChatTurn('1', { text: 'new', pending: false });
    const turn = useStore.getState().chatTurns[0];
    expect(turn!.text).toBe('new');
    expect(turn!.pending).toBe(false);
  });

  it('setChatBusy toggles busy flag', () => {
    useStore.getState().setChatBusy(true);
    expect(useStore.getState().chatBusy).toBe(true);
    useStore.getState().setChatBusy(false);
    expect(useStore.getState().chatBusy).toBe(false);
  });

  it('resetChat clears all chat state', () => {
    useStore.getState().pushChatTurn({ id: '1', role: 'user', text: 'test' });
    useStore.getState().setChatBusy(true);
    useStore.getState().focusChatOn(makeNode(), 'scaffold-1');
    useStore.getState().resetChat();
    const s = useStore.getState();
    expect(s.chatTurns).toHaveLength(0);
    expect(s.chatBusy).toBe(false);
    expect(s.chatNode).toBeNull();
    expect(s.chatScaffoldId).toBeNull();
  });

  it('focusChatOn sets node and scaffold without clearing turns', () => {
    useStore.getState().pushChatTurn({ id: '1', role: 'user', text: 'keep' });
    useStore.getState().focusChatOn(makeNode({ path: 'C:\\focus' }), 'sc-2');
    const s = useStore.getState();
    expect(s.chatNode?.path).toBe('C:\\focus');
    expect(s.chatScaffoldId).toBe('sc-2');
    expect(s.chatTurns).toHaveLength(1); // turns preserved
  });
});

describe('addReclaimed', () => {
  it('accumulates reclaimed bytes', () => {
    useStore.getState().addReclaimed(100);
    expect(useStore.getState().reclaimedBytes).toBe(100);
    useStore.getState().addReclaimed(50);
    expect(useStore.getState().reclaimedBytes).toBe(150);
  });
});

describe('toast actions', () => {
  it('pushToast adds a toast with generated id', () => {
    useStore.getState().pushToast({ text: 'hello', type: 'success' });
    const toasts = useStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.text).toBe('hello');
    expect(toasts[0]!.type).toBe('success');
    expect(toasts[0]!.id).toBeTruthy();
  });

  it('popToast removes a toast by id', () => {
    useStore.getState().pushToast({ text: 'a', type: 'info' });
    useStore.getState().pushToast({ text: 'b', type: 'error' });
    const id = useStore.getState().toasts[0]!.id;
    useStore.getState().popToast(id);
    expect(useStore.getState().toasts).toHaveLength(1);
    expect(useStore.getState().toasts[0]!.text).toBe('b');
  });
});

describe('studio actions', () => {
  it('requestStudio sets a studio request with timestamp', () => {
    useStore.getState().requestStudio('sc-1');
    const req = useStore.getState().studioRequest;
    expect(req?.scaffoldId).toBe('sc-1');
    expect(req?.ts).toBeGreaterThan(0);
  });

  it('consumeStudio clears the request', () => {
    useStore.getState().requestStudio('sc-1');
    useStore.getState().consumeStudio();
    expect(useStore.getState().studioRequest).toBeNull();
  });
});

describe('beginChatRequest / endChatRequest', () => {
  it('returns a signal and cleans up on end', () => {
    const signal = useStore.getState().beginChatRequest();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    useStore.getState().endChatRequest(signal);
    expect(useStore.getState().chatAbort).toBeNull();
  });

  it('aborts previous request on new begin', () => {
    const s1 = useStore.getState().beginChatRequest();
    const s2 = useStore.getState().beginChatRequest();
    expect(s1.aborted).toBe(true);
    expect(s2.aborted).toBe(false);
    useStore.getState().endChatRequest(s2);
  });
});

describe('scanInProgress', () => {
  it('toggles scan state', () => {
    useStore.getState().setScanInProgress(true);
    expect(useStore.getState().scanInProgress).toBe(true);
    useStore.getState().setScanInProgress(false);
    expect(useStore.getState().scanInProgress).toBe(false);
  });
});