use async_trait::async_trait;

/// Provider-agnostic interface for AI advisor backends.
/// Each provider implements `send` to build the HTTP request, dispatch it,
/// and parse the raw JSON response into the canonical `AdvisorResponse`.
#[async_trait]
pub trait AdvisorClient: Send + Sync {
    /// Build and send the advisor request, returning the raw response text
    /// (JSON or JSON-in-codefence). The caller handles caching + parse.
    async fn send(&self, client: &reqwest::Client, system: &str, user_prompt: &str) -> anyhow::Result<String>;
}