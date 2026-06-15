//! AI advisor: provider-agnostic, JSON-mode structured output.
//!
//! Sends only directory metadata and sample paths — never file contents.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Simple in-memory response cache keyed by a hash of the serialized request.
/// Prevents duplicate API calls for the same directory data within a session.
const CACHE_CAP: usize = 64;
static RESPONSE_CACHE: once_cell::sync::Lazy<Mutex<HashMap<u64, AdvisorResponse>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::with_capacity(CACHE_CAP)));

/// 包装字符串，Debug 只输出 `***` 避免密钥泄露。
/// `AsRef<str>` 用于实际 API 调用时的明文传递。
#[derive(Clone)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(s: String) -> Self {
        SecretString(s)
    }
}

impl std::fmt::Debug for SecretString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("***")
    }
}

impl AsRef<str> for SecretString {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtShare {
    pub ext: String,
    pub share: f32,
}

impl std::hash::Hash for ExtShare {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.ext.hash(state);
        self.share.to_bits().hash(state);
    }
}

#[derive(Debug, Clone, Hash, Serialize, Deserialize)]
pub struct AdvisorRequest {
    pub path: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub top_extensions: Vec<ExtShare>,
    pub sample_paths: Vec<String>,
    pub neighbors: Vec<String>,
    pub scaffold_hint: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AdvisorResponse {
    pub what: String,
    pub category: String,
    pub safe_to_delete: bool,
    pub risk: String,
    pub action: String,
    pub reasoning: String,
    #[serde(default)]
    pub needs_inspection: bool,
    #[serde(default)]
    pub suggested_scaffold: Option<String>,
}

#[derive(Clone, Debug)]
pub enum Provider {
    OpenAI {
        api_key: SecretString,
        model: String,
        base_url: String,
    },
    Anthropic {
        api_key: SecretString,
        model: String,
        base_url: String,
    },
    Ollama {
        base_url: String,
        model: String,
    },
    Gemini {
        api_key: SecretString,
        model: String,
        base_url: String,
    },
}

const SYSTEM: &str = r#"You are Pinkbin's local file advisor. Given a folder's metadata, decide what it is and whether it can be cleaned. Reply in strict JSON ONLY, matching this schema exactly:

{
  "what": "string",
  "category": "browser_cache|app_cache|package_cache|build_artifact|game_data|user_content|system|model_weights|unknown",
  "safe_to_delete": true|false,
  "risk": "low|medium|high",
  "action": "keep|recycle|delete|custom",
  "reasoning": "short string, one sentence",
  "needs_inspection": true|false,
  "suggested_scaffold": "string or null"
}

Rules:
- Be conservative. If uncertain, set needs_inspection=true and action="keep".
- "user_content" (Documents/Pictures/Music/Source code) is never safe_to_delete.
- "model_weights" (HuggingFace, Ollama models) is medium risk: deletable but expensive to redownload.
- Do not include any prose outside the JSON object."#;

pub async fn advise(provider: &Provider, req: &AdvisorRequest) -> anyhow::Result<AdvisorResponse> {
    // Issue 35: response cache — skip network if same request already seen.
    let cache_key = {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        req.hash(&mut h);
        h.finish()
    };
    {
        let cache = RESPONSE_CACHE.lock().unwrap();
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let user_prompt = serde_json::to_string_pretty(req)?;

    // Issue 33: retry up to 2 times with exponential backoff on transient failure.
    const MAX_RETRIES: u32 = 2;
    let mut last_err = None;

    for attempt in 0..=MAX_RETRIES {
        if attempt > 0 {
            let backoff = std::time::Duration::from_millis(500 * (1u64 << attempt));
            tokio::time::sleep(backoff).await;
        }

        let raw = match provider {
            Provider::OpenAI {
                api_key,
                model,
                base_url,
            } => {
                let body = serde_json::json!({
                    "model": model,
                    "max_tokens": 1024, // Issue 34: limit response length
                    "response_format": { "type": "json_object" },
                    "messages": [
                        { "role": "system", "content": SYSTEM },
                        { "role": "user",   "content": user_prompt }
                    ]
                });
                match client
                    .post(format!(
                        "{}/chat/completions",
                        base_url.trim_end_matches('/')
                    ))
                    .bearer_auth(api_key.as_ref())
                    .json(&body)
                    .send()
                    .await
                {
                    Ok(r) => {
                        let v: serde_json::Value = match r.json().await {
                            Ok(v) => v,
                            Err(e) => { last_err = Some(anyhow::anyhow!("openai: json parse: {e}")); continue; }
                        };
                        v["choices"][0]["message"]["content"]
                            .as_str()
                            .ok_or_else(|| anyhow::anyhow!("openai: missing message.content"))?
                            .to_string()
                    }
                    Err(e) => { last_err = Some(anyhow::anyhow!("openai: {e}")); continue; }
                }
            }
            Provider::Anthropic {
                api_key,
                model,
                base_url,
            } => {
                let body = serde_json::json!({
                    "model": model,
                    "max_tokens": 2048,
                    "system": SYSTEM,
                    "messages": [{ "role": "user", "content": user_prompt }]
                });
                match client
                    .post(format!("{}/v1/messages", base_url.trim_end_matches('/')))
                    .header("x-api-key", api_key.as_ref())
                    .header("anthropic-version", "2023-06-01")
                    .json(&body)
                    .send()
                    .await
                {
                    Ok(r) => {
                        let v: serde_json::Value = match r.json().await {
                            Ok(v) => v,
                            Err(e) => { last_err = Some(anyhow::anyhow!("anthropic: json parse: {e}")); continue; }
                        };
                        let text = v["content"]
                            .as_array()
                            .map(|blocks| {
                                blocks
                                    .iter()
                                    .filter(|b| b["type"] == "text")
                                    .filter_map(|b| b["text"].as_str())
                                    .collect::<Vec<_>>()
                                    .join("")
                            })
                            .unwrap_or_default();
                        if text.trim().is_empty() {
                            let stop = v["stop_reason"].as_str().unwrap_or("unknown");
                            anyhow::bail!(
                                "anthropic: empty text block (stop_reason={stop})"
                            );
                        }
                        text
                    }
                    Err(e) => { last_err = Some(anyhow::anyhow!("anthropic: {e}")); continue; }
                }
            }
            Provider::Gemini {
                api_key,
                model,
                base_url,
            } => {
                let body = serde_json::json!({
                    "systemInstruction": { "parts": [{ "text": SYSTEM }] },
                    "contents": [{ "role": "user", "parts": [{ "text": user_prompt }] }],
                    "generationConfig": {
                        "responseMimeType": "application/json",
                        "temperature": 0.2
                    }
                });
                let url = format!(
                    "{}/v1beta/models/{}:generateContent",
                    base_url.trim_end_matches('/'),
                    model,
                );
                match client
                    .post(url)
                    .header("x-goog-api-key", api_key.as_ref())
                    .json(&body)
                    .send()
                    .await
                {
                    Ok(r) => {
                        let v: serde_json::Value = match r.json().await {
                            Ok(v) => v,
                            Err(e) => { last_err = Some(anyhow::anyhow!("gemini: json parse: {e}")); continue; }
                        };
                        v["candidates"][0]["content"]["parts"][0]["text"]
                            .as_str()
                            .ok_or_else(|| {
                                anyhow::anyhow!("gemini: missing candidates[0].content.parts[0].text")
                            })?
                            .to_string()
                    }
                    Err(e) => { last_err = Some(anyhow::anyhow!("gemini: {e}")); continue; }
                }
            }
            Provider::Ollama { base_url, model } => {
                let body = serde_json::json!({
                    "model": model,
                    "format": "json",
                    "stream": false,
                    "messages": [
                        { "role": "system", "content": SYSTEM },
                        { "role": "user",   "content": user_prompt }
                    ]
                });
                match client
                    .post(format!("{}/api/chat", base_url.trim_end_matches('/')))
                    .json(&body)
                    .send()
                    .await
                {
                    Ok(r) => {
                        let v: serde_json::Value = match r.json().await {
                            Ok(v) => v,
                            Err(e) => { last_err = Some(anyhow::anyhow!("ollama: json parse: {e}")); continue; }
                        };
                        v["message"]["content"]
                            .as_str()
                            .ok_or_else(|| anyhow::anyhow!("ollama: missing message.content"))?
                            .to_string()
                    }
                    Err(e) => { last_err = Some(anyhow::anyhow!("ollama: {e}")); continue; }
                }
            }
        };

        let parsed: AdvisorResponse =
            serde_json::from_str(&raw).or_else(|_| serde_json::from_str(strip_codefence(&raw)))?;

        // Cache successful responses (Issue 35).
        let mut cache = RESPONSE_CACHE.lock().unwrap();
        cache.insert(cache_key, parsed.clone());
        if cache.len() > CACHE_CAP {
            cache.clear();
        }
        return Ok(parsed);
    }

    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("advisor: all retries exhausted")))
}

fn strip_codefence(s: &str) -> &str {
    let s = s.trim();
    let s = s.strip_prefix("```json").unwrap_or(s);
    let s = s.strip_prefix("```").unwrap_or(s);
    // 用 rfind 而非 strip_suffix——后者要求字符串正好以 ``` 结尾，
    // 无法处理 ```extra 跟在闭合围栏后面的情况。
    if let Some(end) = s.rfind("```") {
        s[..end].trim()
    } else {
        s.trim()
    }
}
