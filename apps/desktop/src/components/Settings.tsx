import { useEffect, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { X, CheckCircle2, Info, Eye, EyeOff } from 'lucide-react';
import { api, errorMessage } from '../api';
import { t } from '../messages';
import { isTauri } from '../env';
import { useStore } from '../store';
import {
  loadSettings,
  saveSettings,
  clearSettings,
  ADVISOR_KEY_ACCOUNT,
  invalidateApiKey,
  DEFAULT_ADVANCED,
  type Provider,
  type AdvancedSettings,
} from '../advisorClient';

type Props = { onClose: () => void };

// Suggest a provider from the URL heuristics, but never mandate it — the
// user picks explicitly via radio buttons. The hint text nudges: "我们猜
// 你是 X，错了点 Y". Falls through to `null` when nothing matches.
function suggestProvider(baseUrl: string): Provider | null {
  const u = baseUrl.toLowerCase();
  if (!u) return null;
  if (u.includes('11434') || u.includes('localhost') || u.includes('127.0.0.1') || u.includes('/api/chat')) return 'ollama';
  if (u.includes('anthropic') || u.includes('/v1/messages')) return 'anthropic';
  if (u.includes('googleapis.com') || u.includes('generativelanguage')) return 'gemini';
  // Pure OpenAI URL → explicitly show it; ambiguous/non-matching → null
  // so the user must pick (don't silently default to openai).
  if (u.includes('openai.com')) return 'openai';
  return null;
}

export function Settings({ onClose }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState<Provider>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedSettings>({ ...DEFAULT_ADVANCED });

  useEffect(() => {
    const existing = loadSettings();
    if (existing) {
      setProvider(existing.provider);
      setModel(existing.model);
      setBaseUrl(existing.baseUrl);
      if (existing.advanced) setAdvanced(existing.advanced);
      setSaved(true);
    }
    // Mark loaded only after both sync settings and the async keychain
    // read complete, so the form never renders '' → user types → async
    // overwrites. loadSettings() is always sync; the keychain read is
    // the only async leg — mark loaded when it settles (success or not).
    api.loadSecret(ADVISOR_KEY_ACCOUNT)
      .then((k) => { if (k) setApiKey(k); })
      .catch(() => { /* empty slot or keychain unavailable */ })
      .finally(() => setLoaded(true));
  }, []);

  const suggested = suggestProvider(baseUrl);
  const needsKey = provider !== 'ollama';

  const save = async () => {
    setErr(null); setMsg(null);
    if (!baseUrl.trim()) { setErr(t('settings.err.baseUrl')); return; }
    if (!model.trim())   { setErr(t('settings.err.model')); return; }
    if (needsKey && !apiKey.trim()) { setErr(t('settings.err.apiKey')); return; }
    try {
      // Non-secret config (provider/model/baseUrl) goes to localStorage so
      // it survives reload without an OS keychain round-trip on startup.
      // The key itself goes to the credential manager — never to
      // localStorage, which is a plaintext file on disk.
      saveSettings({ provider, model, baseUrl, advanced });
      if (needsKey) {
        await api.storeSecret(ADVISOR_KEY_ACCOUNT, apiKey);
      } else {
        await api.deleteSecret(ADVISOR_KEY_ACCOUNT);
      }
      invalidateApiKey(); // re-read on next AI call
      if (isTauri) {
        await api.setAdvisor(provider, model, baseUrl);
      }
      setMsg(t('settings.saved'));
      setSaved(true);
      useStore.getState().setAdvisorReady(true);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  const wipe = async () => {
    try {
      await api.deleteSecret(ADVISOR_KEY_ACCOUNT);
    } catch { /* idempotent */ }
    invalidateApiKey();
    clearSettings();
    setProvider('openai');
    setApiKey('');
    setBaseUrl('');
    setModel('');
    setAdvanced({ ...DEFAULT_ADVANCED });
    setSaved(false);
    setMsg(t('settings.wiped'));
    useStore.getState().setAdvisorReady(false);
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
          <div>{t('settings.title')} {saved && <CheckCircle2 size={16} style={{ verticalAlign: 'middle', marginLeft: 6, color: 'var(--pink-deep)' }} />}</div>
          <button className="ghost icon" onClick={onClose}><X size={16} /></button>
        </div>

        {!loaded ? (
          <div className="settings-skeleton">
            <div className="skeleton-line" style={{ width: '70%' }} />
            <div className="skeleton-field" />
            <div className="skeleton-field" />
            <div className="skeleton-field" />
          </div>
        ) : (
          <><p className="hint">
          <Info size={12} />
          <span>{t('settings.hint')}</span>
        </p>
        <label className="field">
          <span>{t('settings.protocol')}</span>
          <div className="provider-radio-group">
            {(['openai', 'anthropic', 'gemini', 'ollama'] as const).map((p) => (
              <label key={p} className="provider-radio">
                <input
                  type="radio"
                  name="provider"
                  value={p}
                  checked={provider === p}
                  onChange={() => setProvider(p)}
                  disabled={!loaded}
                />
                <span>{p === 'openai' ? t('settings.openai') : p === 'anthropic' ? t('settings.anthropic') : p === 'gemini' ? t('settings.gemini') : t('settings.ollama')}</span>
              </label>
            ))}
          </div>
          {suggested && suggested !== provider && (
            <p className="provider-hint">{t('settings.suggested', { provider: suggested })}</p>
          )}
        </label>
        <label className="field">
          <span>{t('settings.baseUrl')}</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            disabled={!loaded}
          />
        </label>

        {needsKey && (
          <label className="field">
            <span>{t('settings.apiKey')}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                style={{ flex: 1 }}
                disabled={!loaded}
              />
              <button
                type="button"
                className="ghost icon"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? t('settings.hide') : t('settings.show')}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>
        )}

        <label className="field">
          <span>{t('settings.model')}</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini · deepseek-chat · claude-haiku-4-5 …"
            disabled={!loaded}
          />
        </label>

        <div className="settings-advanced-toggle">
          <button
            type="button"
            className="ghost"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? t('settings.advanced.close') : t('settings.advanced.open')}
          </button>
        </div>

        {showAdvanced && (
          <div className="settings-advanced-panel">
            <label className="field">
              <span>{t('settings.temperature')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={advanced.temperature}
                  onChange={(e) => setAdvanced((a) => ({ ...a, temperature: Number(e.target.value) }))}
                  style={{ flex: 1 }}
                />
                <span className="mono-num" style={{ minWidth: 36, textAlign: 'right' }}>{advanced.temperature}</span>
              </div>
            </label>

            <label className="field">
              <span>{t('settings.maxTokens')}</span>
              <input
                type="number"
                min={256}
                max={16384}
                step={256}
                value={advanced.maxTokens}
                onChange={(e) => setAdvanced((a) => ({ ...a, maxTokens: Number(e.target.value) }))}
              />
            </label>

            <label className="field">
              <span>{t('settings.streaming')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={advanced.stream}
                  onChange={(e) => setAdvanced((a) => ({ ...a, stream: e.target.checked }))}
                />
                <span className="muted small">{advanced.stream ? t('settings.streamOn') : t('settings.streamOff')}</span>
              </div>
            </label>

            <label className="field">
              <span>{t('settings.promptOverride')}</span>
              <textarea
                value={advanced.systemPromptOverride}
                onChange={(e) => setAdvanced((a) => ({ ...a, systemPromptOverride: e.target.value }))}
                placeholder={t('settings.promptPlaceholder')}
                rows={4}
                maxLength={4000}
                style={{ resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
              <span className="muted small" style={{ textAlign: 'right' }}>
                {advanced.systemPromptOverride.length} / 4000
              </span>
            </label>

            <button
              type="button"
              className="ghost"
              onClick={() => setAdvanced({ ...DEFAULT_ADVANCED })}
              style={{ fontSize: 11 }}
            >
              {t('settings.resetDefault')}
            </button>
          </div>
        )}

        {msg && <div className="ok">{msg}</div>}
        {err && <div className="error">{err}</div>}

        <div className="modal-actions">
          {saved && <button className="ghost" onClick={wipe}>{t('settings.clear')}</button>}
          <button className="primary" onClick={save}>{t('settings.save')}</button>
          <button className="ghost" onClick={onClose} aria-label={t('settings.close')}>{t('settings.close')}</button>
        </div>

        <p className="muted small" style={{ marginTop: 4 }}>
          Pinkbin 只把目录元数据发给 AI（路径、大小、文件数、扩展名分布、抽样路径），<strong>不会</strong>读取或上传文件内容。
        </p></>
        )}
        </div>
      </FocusTrap>
    </div>
  );
}
