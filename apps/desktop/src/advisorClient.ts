// Browser-side AI advisor client — talks to OpenAI / Anthropic / Gemini / Ollama
// directly from the browser, so the preview mode can give real answers.
//
// Settings persist through the shared localStorage facade; see persist.ts.
//
// One provider table, one HTTP path, one SSE parser. The four providers used
// to be inlined twice (once for JSON-mode advisor, once for chat) — this
// version folds them into a single runCompletion() with optional streaming
// and AbortSignal support.

import type { AdvisorRequest, AdvisorResponse } from './types';
import { getJson, setJson, removeKey } from './persist';
import { SYSTEM_PROMPT, CHAT_SYSTEM, OVERVIEW_SYSTEM } from './prompts';
import { redactAdvisorRequest, redactPath, redactSample, redactSamples } from './privacy';

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'ollama';

export interface AdvancedSettings {
  temperature: number;
  maxTokens: number;
  stream: boolean;
  systemPromptOverride: string;
}

export const DEFAULT_ADVANCED: AdvancedSettings = {
  temperature: 0.2,
  maxTokens: 2048,
  stream: true,
  systemPromptOverride: '',
};

export interface AdvisorSettings {
  provider: Provider;
  model: string;
  baseUrl: string;
  advanced?: AdvancedSettings;
}

/// The single keyring slot we use for the advisor's API key. The
/// frontend treats this as an opaque id — it has no inherent meaning to
/// the webview beyond being a reference to ask the backend about.
export const ADVISOR_KEY_ACCOUNT = 'pinkbin:advisor-key';

export interface ChatImage {
  dataUrl: string;
  mimeType: string;
}

export interface CompletionRequest {
  system: string;
  user: string;
  images?: ChatImage[];
  jsonMode?: boolean;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
}

export function loadSettings(): AdvisorSettings | null {
  const parsed = getJson<AdvisorSettings | null>('advisor', null);
  if (!parsed) return null;
  if (!parsed.provider || !parsed.model) return null;
  return parsed;
}

export function saveSettings(s: AdvisorSettings) {
  setJson('advisor', s);
}

export function clearSettings() {
  removeKey('advisor');
}

/// `true` if the user has both a model and (for non-Ollama providers)
/// an API key. Async because the key check now requires a round-trip
/// to the OS credential store via the backend.
export async function isConfiguredAsync(
  s: AdvisorSettings | null,
): Promise<boolean> {
  if (!s) return false;
  if (s.provider === 'ollama') return Boolean(s.model?.trim());
  if (!s.model?.trim()) return false;
  const key = await getApiKey();
  return Boolean(key?.trim());
}

/// Cached `loadSecret` result. The key is only fetched once per session
/// (until the next `invalidateApiKey` call after a save/wipe). This keeps
/// the per-chat round-trip cost down — the chat can fire 10 requests
/// during streaming without re-reading the keychain 10 times.
let cachedKey: { value: string | null } | null = null;

export async function getApiKey(): Promise<string | null> {
  if (cachedKey) return cachedKey.value;
  // Lazy import to avoid a circular dep with `./api`.
  const { api } = await import('./api');
  const v = await api.loadSecret(ADVISOR_KEY_ACCOUNT);
  cachedKey = { value: v ?? null };
  return cachedKey.value;
}

/// Drop the in-memory key cache. Call after `storeSecret` / `deleteSecret`
/// so the next `getApiKey()` re-reads from the keychain.
export function invalidateApiKey() {
  cachedKey = null;
}

// ─── Provider table ─────────────────────────────────────────────────────

type FormatArgs = {
  system: string;
  user: string;
  images?: ChatImage[];
  jsonMode: boolean;
  model: string;
  stream: boolean;
  temperature: number;
  maxTokens: number;
};

type ProviderConfig = {
  defaultBaseUrl: string;
  url: (s: AdvisorSettings, key: string, stream: boolean) => string;
  headers: (s: AdvisorSettings, key: string) => Record<string, string>;
  formatRequest: (args: FormatArgs) => unknown;
  extract: (data: unknown) => string;
  extractDelta: (event: unknown) => string;
};

const PROVIDERS: Record<Provider, ProviderConfig> = {
  openai: {
    defaultBaseUrl: 'https://api.openai.com/v1',
    url: (s) => {
      const base = (s.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
      return `${base}/chat/completions`;
    },
    headers: (_s, key) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    }),
    formatRequest: ({ system, user, images, jsonMode, model, stream, temperature, maxTokens }) => {
      const userContent: unknown = !images || images.length === 0
        ? user
        : [
            { type: 'text', text: user },
            ...images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
          ];
      const body: Record<string, unknown> = {
        model,
        stream,
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      };
      if (jsonMode) body.response_format = { type: 'json_object' };
      return body;
    },
    extract: (data) => extractField(data, ['choices', 0, 'message', 'content']),
    extractDelta: (event) => extractField(event, ['choices', 0, 'delta', 'content']),
  },
  anthropic: {
    defaultBaseUrl: 'https://api.anthropic.com',
    url: (s) => {
      const base = (s.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
      return `${base}/v1/messages`;
    },
    headers: (_s, key) => ({
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }),
    formatRequest: ({ system, user, images, model, stream, temperature, maxTokens }) => {
      const content: unknown[] = [];
      if (images && images.length > 0) {
        for (const img of images) {
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: img.mimeType, data: dataUrlBase64(img.dataUrl) },
          });
        }
      }
      content.push({ type: 'text', text: user });
      return {
        model,
        max_tokens: maxTokens,
        temperature,
        stream,
        system,
        messages: [{ role: 'user', content }],
      };
    },
    extract: extractAnthropicText,
    extractDelta: (event) => {
      const e = event as { type?: string; delta?: { type?: string; text?: string } };
      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        return e.delta.text ?? '';
      }
      return '';
    },
  },
  gemini: {
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    url: (s, key, stream) => {
      const base = (s.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
      const endpoint = stream ? 'streamGenerateContent' : 'generateContent';
      return `${base}/v1beta/models/${encodeURIComponent(s.model)}:${endpoint}?key=${encodeURIComponent(key)}`;
    },
    headers: () => ({ 'Content-Type': 'application/json' }),
    formatRequest: ({ system, user, images, jsonMode, stream, temperature, maxTokens }) => {
      const parts: unknown[] = [];
      if (images && images.length > 0) {
        for (const img of images) {
          parts.push({ inline_data: { mime_type: img.mimeType, data: dataUrlBase64(img.dataUrl) } });
        }
      }
      parts.push({ text: user });
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
      };
      body.generationConfig = {
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        temperature,
        maxOutputTokens: maxTokens,
      };
      return body;
    },
    extract: (data) => extractField(data, ['candidates', 0, 'content', 'parts', 0, 'text']),
    extractDelta: (event) => extractField(event, ['candidates', 0, 'content', 'parts', 0, 'text']),
  },
  ollama: {
    defaultBaseUrl: 'http://localhost:11434',
    url: (s) => {
      const base = (s.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
      return `${base}/api/chat`;
    },
    headers: () => ({ 'Content-Type': 'application/json' }),
    formatRequest: ({ system, user, images, model, stream, temperature }) => {
      const userMsg: Record<string, unknown> = { role: 'user', content: user };
      if (images && images.length > 0) userMsg.images = images.map((i) => dataUrlBase64(i.dataUrl));
      return {
        model,
        stream,
        options: { temperature },
        messages: [
          { role: 'system', content: system },
          userMsg,
        ],
      };
    },
    extract: (data) => extractField(data, ['message', 'content']),
    extractDelta: (event) => extractField(event, ['message', 'content']),
  },
};

// ─── Public API ──────────────────────────────────────────────────────────

export async function runCompletion(
  settings: AdvisorSettings,
  key: string,
  req: CompletionRequest,
): Promise<string> {
  const cfg = PROVIDERS[settings.provider];
  if (!cfg) throw new Error(`Unknown provider: ${settings.provider}`);

  const adv = settings.advanced ?? DEFAULT_ADVANCED;
  const stream = adv.stream && Boolean(req.onChunk) && !req.jsonMode;
  const url = cfg.url(settings, key, stream);
  const headers = cfg.headers(settings, key);
  const body = cfg.formatRequest({
    system: req.system,
    user: req.user,
    images: req.images ?? [],
    jsonMode: Boolean(req.jsonMode),
    model: settings.model,
    stream,
    temperature: adv.temperature,
    maxTokens: adv.maxTokens,
  });

  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: req.signal ?? null,
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`${settings.provider} ${r.status}: ${errText}`);
  }

  if (stream && r.body) {
    const text = await consumeSSE(r.body, cfg, req.onChunk!, req.signal);
    return req.jsonMode ? stripCodeFence(text) : text;
  }
  const data = await r.json();
  const text = cfg.extract(data);
  return req.jsonMode ? stripCodeFence(text) : text;
}

export async function callAdvisor(
  settings: AdvisorSettings,
  req: AdvisorRequest,
): Promise<AdvisorResponse> {
  const key = await getApiKey();
  if (!key && settings.provider !== 'ollama') {
    throw new Error('AI 未配置 — 在右上角的设置里填一个 API key');
  }
  // Scrub the JSON payload before it leaves the webview: collapse paths
  // (hides username / machine name) and strip prompt-injection tokens
  // (filenames that try to coerce the model). See privacy.ts.
  const safeReq = redactAdvisorRequest(req as unknown as Parameters<typeof redactAdvisorRequest>[0]);
  const userPrompt = JSON.stringify(safeReq, null, 2);
  const adv = settings.advanced ?? DEFAULT_ADVANCED;
  const systemPrompt = adv.systemPromptOverride?.trim() || SYSTEM_PROMPT;
  const text = await runCompletion(settings, key ?? '', {
    system: systemPrompt,
    user: userPrompt,
    jsonMode: true,
  });
  if (!text) throw new Error('Empty response from advisor');
  return JSON.parse(text) as AdvisorResponse;
}

export async function overviewChat(
  summary: object,
  opts?: { onChunk?: (text: string) => void; signal?: AbortSignal },
): Promise<string> {
  return runWithLoadedSettings({
    system: OVERVIEW_SYSTEM,
    user: JSON.stringify(redactOverviewSummary(summary), null, 2),
    ...(opts?.onChunk ? { onChunk: opts.onChunk } : {}),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });
}

export async function freeChat(
  context: string,
  userMessage: string,
  images?: ChatImage[],
  opts?: { onChunk?: (text: string) => void; signal?: AbortSignal },
): Promise<string> {
  const userText = context ? `${context}\n\n用户的问题：${userMessage}` : userMessage;
  return runWithLoadedSettings({
    system: CHAT_SYSTEM,
    user: userText,
    ...(images ? { images } : {}),
    ...(opts?.onChunk ? { onChunk: opts.onChunk } : {}),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });
}

// ─── SSE consumer ────────────────────────────────────────────────────────

async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  cfg: ProviderConfig,
  onChunk: (text: string) => void,
  signal: AbortSignal | undefined,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';

  const onAbort = () => { reader.cancel().catch(() => {}); };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const delta = parseSSEBlock(block, cfg);
        if (delta) {
          accumulated += delta;
          onChunk(delta);
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    // Trailing block without final blank line.
    if (buffer.trim()) {
      const delta = parseSSEBlock(buffer, cfg);
      if (delta) {
        accumulated += delta;
        onChunk(delta);
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  return accumulated;
}

function parseSSEBlock(block: string, cfg: ProviderConfig): string {
  let dataStr = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) {
      dataStr += line.startsWith('data: ') ? line.slice(6) : line.slice(5);
    }
  }
  if (!dataStr || dataStr === '[DONE]') return '';
  try {
    return cfg.extractDelta(JSON.parse(dataStr));
  } catch {
    return '';
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────

async function runWithLoadedSettings(
  args: {
    system: string;
    user: string;
    images?: ChatImage[];
    onChunk?: (text: string) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const settings = loadSettings();
  if (!settings) {
    throw new Error('AI 未配置 — 在右上角的设置里填一个 API key');
  }
  const key = await getApiKey();
  if (!key && settings.provider !== 'ollama') {
    throw new Error('AI 未配置 — 在右上角的设置里填一个 API key');
  }
  return runCompletion(settings, key ?? '', {
    system: args.system,
    user: args.user,
    images: args.images ?? [],
    ...(args.onChunk ? { onChunk: args.onChunk } : {}),
    ...(args.signal ? { signal: args.signal } : {}),
  });
}

function extractField(data: unknown, path: ReadonlyArray<string | number>): string {
  let cur: unknown = data;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return '';
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return typeof cur === 'string' ? cur : '';
}

function stripCodeFence(s: string): string {
  let t = s.trim();
  if (t.startsWith('```json')) t = t.slice(7);
  else if (t.startsWith('```')) t = t.slice(3);
  if (t.endsWith('```')) t = t.slice(0, -3);
  return t.trim();
}

function dataUrlBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

// Anthropic 响应里 content 是 block 数组，extended-thinking 模型（如 DeepSeek
// 的 anthropic 兼容端点）会先返一个 {type:"thinking",...} 再返 {type:"text",...}，
// 不能假设 content[0] 是 text。stop_reason="max_tokens" 时还可能根本没 text
// block（thinking 把额度吃光），给明确错误而不是静默返回空串。
function extractAnthropicText(data: unknown): string {
  const d = data as { content?: Array<{ type?: string; text?: string }>; stop_reason?: string };
  const blocks = d?.content ?? [];
  const text = blocks
    .filter((b) => b?.type === 'text')
    .map((b) => b?.text ?? '')
    .join('')
    .trim();
  if (!text) {
    const stop = d?.stop_reason ?? 'unknown';
    if (stop === 'max_tokens') {
      throw new Error('AI 在 thinking 阶段被截断（max_tokens 太小，思考把额度吃光了）。把 max_tokens 调大重试。');
    }
    throw new Error(`Anthropic: 没拿到 text block（stop_reason=${stop}）`);
  }
  return text;
}

// `buildOverviewSummary` (chatUtils.ts) produces a fixed shape:
//   { root, total_size_human, total_files, top_entries: [{ path, ... }] }
// We only need to redact the path fields; everything else is size/count
// data and not user-identifying.
function redactOverviewSummary(summary: object): object {
  const s = summary as {
    root?: string;
    top_entries?: Array<{ path?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  };
  return {
    ...s,
    root: typeof s.root === 'string' ? redactPath(redactSample(s.root)) : s.root,
    top_entries: Array.isArray(s.top_entries)
      ? s.top_entries.map((e) => ({
          ...e,
          path: typeof e.path === 'string' ? redactPath(redactSample(e.path)) : e.path,
        }))
      : s.top_entries,
  };
}

// `useChat` builds chat prompts that include JSON blocks of
// `{ path, sample_children, sample_paths, ... }`. We export a small
// helper to redact that shape too, so callers don't have to re-walk
// fields by hand.
export function redactChatContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...ctx };
  if (typeof out.path === 'string') {
    out.path = redactPath(redactSample(out.path));
  }
  if (Array.isArray(out.sample_paths)) {
    out.sample_paths = redactSamples(out.sample_paths as string[]);
  }
  if (Array.isArray(out.top_children)) {
    out.top_children = (out.top_children as Array<{ name: string }>).map((c) => ({
      ...c,
      name: redactSample(c.name),
    }));
  }
  if (Array.isArray(out.sample_children)) {
    out.sample_children = (out.sample_children as Array<{ name: string }>).map((c) => ({
      ...c,
      name: redactSample(c.name),
    }));
  }
  return out;
}