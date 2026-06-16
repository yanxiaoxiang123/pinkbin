use async_trait::async_trait;

use crate::client::AdvisorClient;
use crate::SecretString;

pub struct GeminiClient {
    pub api_key: SecretString,
    pub model: String,
    pub base_url: String,
}

#[async_trait]
impl AdvisorClient for GeminiClient {
    async fn send(&self, client: &reqwest::Client, system: &str, user_prompt: &str) -> anyhow::Result<String> {
        let body = serde_json::json!({
            "systemInstruction": { "parts": [{ "text": system }] },
            "contents": [{ "role": "user", "parts": [{ "text": user_prompt }] }],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.2
            }
        });
        let url = format!(
            "{}/v1beta/models/{}:generateContent",
            self.base_url.trim_end_matches('/'),
            self.model,
        );
        let r = client
            .post(url)
            .header("x-goog-api-key", self.api_key.as_ref())
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("gemini: {e}"))?;
        let v: serde_json::Value = r.json().await
            .map_err(|e| anyhow::anyhow!("gemini: json parse: {e}"))?;
        v["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("gemini: missing candidates[0].content.parts[0].text"))
            .map(|s| s.to_string())
    }
}