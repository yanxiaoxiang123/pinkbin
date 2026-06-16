use async_trait::async_trait;

use crate::client::AdvisorClient;
use crate::SecretString;

pub struct AnthropicClient {
    pub api_key: SecretString,
    pub model: String,
    pub base_url: String,
}

#[async_trait]
impl AdvisorClient for AnthropicClient {
    async fn send(&self, client: &reqwest::Client, system: &str, user_prompt: &str) -> anyhow::Result<String> {
        let body = serde_json::json!({
            "model": self.model,
            "max_tokens": 2048,
            "system": system,
            "messages": [{ "role": "user", "content": user_prompt }]
        });
        let r = client
            .post(format!("{}/v1/messages", self.base_url.trim_end_matches('/')))
            .header("x-api-key", self.api_key.as_ref())
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("anthropic: {e}"))?;
        let v: serde_json::Value = r.json().await
            .map_err(|e| anyhow::anyhow!("anthropic: json parse: {e}"))?;
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
            anyhow::bail!("anthropic: empty text block (stop_reason={stop})");
        }
        Ok(text)
    }
}