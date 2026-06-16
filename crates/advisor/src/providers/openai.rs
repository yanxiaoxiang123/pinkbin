use async_trait::async_trait;

use crate::client::AdvisorClient;
use crate::SecretString;

pub struct OpenAIClient {
    pub api_key: SecretString,
    pub model: String,
    pub base_url: String,
}

#[async_trait]
impl AdvisorClient for OpenAIClient {
    async fn send(&self, client: &reqwest::Client, system: &str, user_prompt: &str) -> anyhow::Result<String> {
        let body = serde_json::json!({
            "model": self.model,
            "max_tokens": 1024,
            "response_format": { "type": "json_object" },
            "messages": [
                { "role": "system", "content": system },
                { "role": "user",   "content": user_prompt }
            ]
        });
        let r = client
            .post(format!(
                "{}/chat/completions",
                self.base_url.trim_end_matches('/')
            ))
            .bearer_auth(self.api_key.as_ref())
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("openai: {e}"))?;
        let v: serde_json::Value = r.json().await
            .map_err(|e| anyhow::anyhow!("openai: json parse: {e}"))?;
        v["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("openai: missing message.content"))
            .map(|s| s.to_string())
    }
}