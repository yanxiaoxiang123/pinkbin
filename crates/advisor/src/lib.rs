//! AI advisor: provider-agnostic, JSON-mode structured output.
//!
//! Sends only directory metadata and sample paths — never file contents.

pub mod client;
pub mod providers;

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

/// Simple in-memory response cache keyed by a hash of the serialized request.
/// Prevents duplicate API calls for the same directory data within a session.
const CACHE_CAP: usize = 64;
static RESPONSE_CACHE: once_cell::sync::Lazy<RwLock<HashMap<u64, AdvisorResponse>>> =
    once_cell::sync::Lazy::new(|| RwLock::new(HashMap::with_capacity(CACHE_CAP)));

/// Shared HTTP client — reused across all advise() calls to avoid repeated
/// DNS resolution, TLS handshakes, and connection pool rebuilds.
static HTTP_CLIENT: once_cell::sync::Lazy<reqwest::Client> =
    once_cell::sync::Lazy::new(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("failed to build shared reqwest client")
    });

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

pub(crate) const SYSTEM: &str = r#"You are Pinkbin's local file advisor. Given a folder's metadata, decide what it is and whether it can be cleaned. Reply in strict JSON ONLY, matching this schema exactly:

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
        let cache = RESPONSE_CACHE.read().unwrap();
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    let user_prompt = serde_json::to_string_pretty(req)?;

    // Issue 33: retry up to 2 times with exponential backoff on transient failure.
    const MAX_RETRIES: u32 = 2;
    let mut last_err = None;

    let adapter = providers::client_for_provider(provider);

    for attempt in 0..=MAX_RETRIES {
        if attempt > 0 {
            let backoff = std::time::Duration::from_millis(500 * (1u64 << attempt));
            tokio::time::sleep(backoff).await;
        }

        let raw = match adapter.send(&HTTP_CLIENT, SYSTEM, &user_prompt).await {
            Ok(r) => r,
            Err(e) => {
                last_err = Some(e);
                continue;
            }
        };

        let parsed: AdvisorResponse =
            serde_json::from_str(&raw).or_else(|_| serde_json::from_str(strip_codefence(&raw)))?;

        // Cache successful responses (Issue 35).
        let mut cache = RESPONSE_CACHE.write().unwrap();
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
    if let Some(end) = s.rfind("```") {
        s[..end].trim()
    } else {
        s.trim()
    }
}