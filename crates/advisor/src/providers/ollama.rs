use async_trait::async_trait;

use crate::client::AdvisorClient;

pub struct OllamaClient {
    pub base_url: String,
    pub model: String,
}

#[async_trait]
impl AdvisorClient for OllamaClient {
    async fn send(&self, client: &reqwest::Client, system: &str, user_prompt: &str) -> anyhow::Result<String> {
        let body = serde_json::json!({
            "model": self.model,
            "format": "json",
            "stream": false,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user",   "content": user_prompt }
            ]
        });
        let r = client
            .post(format!("{}/api/chat", self.base_url.trim_end_matches('/')))
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("ollama: {e}"))?;
        let v: serde_json::Value = r.json().await
            .map_err(|e| anyhow::anyhow!("ollama: json parse: {e}"))?;
        v["message"]["content"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("ollama: missing message.content"))
            .map(|s| s.to_string())
    }
}