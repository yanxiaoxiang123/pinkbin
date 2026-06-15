import { useEffect, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { X, CheckCircle2, Info, Eye, EyeOff } from 'lucide-react';
import { api } from '../api';
import { isTauri } from '../env';
import {
  loadSettings,
  saveSettings,
  clearSettings,
  ADVISOR_KEY_ACCOUNT,
  invalidateApiKey,
  type Provider,
} from '../advisorClient';

type Props = { onClose: () => void };

// Detect which on-the-wire protocol to use from the Base URL alone, so the
// user doesn't have to think about "协议". Heuristics cover the cases users
// actually run into; everything else falls through to OpenAI (the de-facto
// universal standard for relays + national providers).
function detectProvider(baseUrl: string): Provider {
  const u = baseUrl.toLowerCase();
  if (!u) return 'openai';
  if (u.includes('11434') || u.includes('localhost') || u.includes('127.0.0.1') || u.includes('/api/chat')) return 'ollama';
  // 识别带 anthropic 字样的代理子域名（如 anthropic.novadiffusion.com），
  // 不仅是官方 anthropic.com。误识别风险极小——OpenAI 协议代理几乎不会
  // 把 anthropic 写进域名里。
  if (u.includes('anthropic') || u.includes('/v1/messages')) return 'anthropic';
  if (u.includes('googleapis.com') || u.includes('generativelanguage')) return 'gemini';
  return 'openai';
}

export function Settings({ onClose }: Props) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existing = loadSettings();
    if (existing) {
      setModel(existing.model);
      setBaseUrl(existing.baseUrl);
      setSaved(true);
    }
    // The key is not in localStorage — it lives in the OS credential
    // manager. We pull it on mount so the input field is pre-filled
    // (so the user can verify or edit), but never write it back to disk
    // in plaintext.
    api.loadSecret(ADVISOR_KEY_ACCOUNT)
      .then((k) => { if (k) setApiKey(k); })
      .catch(() => { /* empty slot or keychain unavailable — leave field blank */ });
  }, []);

  const provider = detectProvider(baseUrl);
  const needsKey = provider !== 'ollama';

  const save = async () => {
    setErr(null); setMsg(null);
    if (!baseUrl.trim()) { setErr('请填 Base URL'); return; }
    if (!model.trim())   { setErr('请填 Model 名'); return; }
    if (needsKey && !apiKey.trim()) { setErr('请填 API Key'); return; }
    try {
      // Non-secret config (provider/model/baseUrl) goes to localStorage so
      // it survives reload without an OS keychain round-trip on startup.
      // The key itself goes to the credential manager — never to
      // localStorage, which is a plaintext file on disk.
      saveSettings({ provider, model, baseUrl });
      if (needsKey) {
        await api.storeSecret(ADVISOR_KEY_ACCOUNT, apiKey);
      } else {
        await api.deleteSecret(ADVISOR_KEY_ACCOUNT);
      }
      invalidateApiKey(); // re-read on next AI call
      if (isTauri) {
        await api.setAdvisor(provider, model, baseUrl);
      }
      setMsg('已保存 · key 只存在你本机系统钥匙串 (Credential Manager / Keychain / libsecret)');
      setSaved(true);
    } catch (e) {
      setErr(String(e));
    }
  };

  const wipe = async () => {
    try {
      await api.deleteSecret(ADVISOR_KEY_ACCOUNT);
    } catch { /* idempotent */ }
    invalidateApiKey();
    clearSettings();
    setApiKey('');
    setBaseUrl('');
    setModel('');
    setSaved(false);
    setMsg('已清除本地保存的配置和钥匙串里的 key');
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <FocusTrap focusTrapOptions={{ escapeDeactivates: false, allowOutsideClick: true }}>
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="AI 顾问设置"
          onClick={(e) => e.stopPropagation()}
        >
        <div className="modal-head">
          <div>AI 顾问设置 {saved && <CheckCircle2 size={16} style={{ verticalAlign: 'middle', marginLeft: 6, color: 'var(--pink-deep)' }} />}</div>
          <button className="ghost icon" onClick={onClose}><X size={16} /></button>
        </div>

        <p className="hint">
          <Info size={12} />
          <span>填你服务商给你的 Base URL、API Key 和模型名。OpenAI、DeepSeek、Kimi、各种中转都直接填就能用；本地 Ollama 不用 Key。</span>
        </p>

        <label className="field">
          <span>Base URL</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </label>

        {needsKey && (
          <label className="field">
            <span>API Key（只存本机，永不上传）</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="ghost icon"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? '隐藏' : '显示'}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>
        )}

        <label className="field">
          <span>Model · 模型名</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini · deepseek-chat · claude-haiku-4-5 …"
          />
        </label>

        {msg && <div className="ok">{msg}</div>}
        {err && <div className="error">{err}</div>}

        <div className="modal-actions">
          {saved && <button className="ghost" onClick={wipe}>清除</button>}
          <button className="primary" onClick={save}>保存</button>
          <button className="ghost" onClick={onClose} aria-label="关闭">关闭</button>
        </div>

        <p className="muted small" style={{ marginTop: 4 }}>
          Pinkbin 只把目录元数据发给 AI（路径、大小、文件数、扩展名分布、抽样路径），<strong>不会</strong>读取或上传文件内容。
        </p>
        </div>
      </FocusTrap>
    </div>
  );
}
