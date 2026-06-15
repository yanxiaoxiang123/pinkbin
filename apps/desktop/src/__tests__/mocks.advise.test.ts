import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock `advisorClient` so we can swap the real callAdvisor with one that
// either succeeds, throws, or is bypassed entirely (no settings).
// The mocks.advise function picks its code path based on what
// `loadSettings()` / `isConfiguredAsync()` see, plus what callAdvisor
// returns. We stub all three.
vi.mock('../advisorClient', async () => {
  const actual = await vi.importActual<typeof import('../advisorClient')>('../advisorClient');
  return {
    ...actual,
    loadSettings: vi.fn(),
    isConfiguredAsync: vi.fn(),
    callAdvisor: vi.fn(),
  };
});

// And `persist` — mocks.advise indirectly depends on localStorage, which
// jsdom provides, but we want a clean slate per test.
import { loadSettings, isConfiguredAsync, callAdvisor } from '../advisorClient';
import { advise, AdvisorCallError } from '../mocks';
import type { AdvisorRequest, AdvisorResponse } from '../types';

const REQ: AdvisorRequest = {
  path: 'C:\\Users\\test\\AppData\\Local\\something',
  size_bytes: 1024,
  file_count: 10,
  top_extensions: [],
  sample_paths: [],
  neighbors: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mocks.advise — no-silent-fallback guarantee', () => {
  it('returns canned advice with is_fallback=true when no key is configured', async () => {
    vi.mocked(loadSettings).mockReturnValue(null);
    vi.mocked(isConfiguredAsync).mockResolvedValue(false);
    const out = await advise(REQ);
    expect(out.is_fallback).toBe(true);
    // Conservative: canned "no key" advice must never recommend delete.
    expect(out.action).not.toBe('delete');
    expect(vi.mocked(callAdvisor)).not.toHaveBeenCalled();
  });

  it('returns canned advice with is_fallback=true even when key IS set, but callAdvisor throws', async () => {
    // Wait — we changed the contract: when the user has configured a key
    // and the real call fails, we MUST throw AdvisorCallError rather
    // than return canned advice. This test pins that behaviour.
    vi.mocked(loadSettings).mockReturnValue({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
    });
    vi.mocked(isConfiguredAsync).mockResolvedValue(true);
    vi.mocked(callAdvisor).mockRejectedValue(new Error('CORS preflight failed'));
    await expect(advise(REQ)).rejects.toBeInstanceOf(AdvisorCallError);
    // The error must surface actionable detail — the original cause AND
    // a pointer to what could be wrong.
    try {
      await advise(REQ);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('CORS preflight failed');
      expect(msg).toMatch(/网络|CORS|限流|SSL|baseUrl|model/);
      expect(msg).toContain('不可信');
    }
  });

  it('returns the real callAdvisor response unchanged when the call succeeds', async () => {
    const real: AdvisorResponse = {
      what: 'Edge browser cache',
      category: 'browser_cache',
      safe_to_delete: true,
      risk: 'low',
      action: 'recycle',
      reasoning: 'looks safe',
      needs_inspection: false,
    };
    vi.mocked(loadSettings).mockReturnValue({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
    });
    vi.mocked(isConfiguredAsync).mockResolvedValue(true);
    vi.mocked(callAdvisor).mockResolvedValue(real);
    const out = await advise(REQ);
    expect(out).toBe(real);
    expect(out.is_fallback).toBeUndefined();
  });
});