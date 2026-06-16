mod anthropic;
mod gemini;
mod ollama;
mod openai;

pub use anthropic::AnthropicClient;
pub use gemini::GeminiClient;
pub use ollama::OllamaClient;
pub use openai::OpenAIClient;

use crate::client::AdvisorClient;
use crate::Provider;

/// Dispatch a `Provider` enum to the corresponding `AdvisorClient` impl.
pub fn client_for_provider(provider: &Provider) -> Box<dyn AdvisorClient> {
    match provider {
        Provider::OpenAI { api_key, model, base_url } => Box::new(OpenAIClient {
            api_key: api_key.clone(),
            model: model.clone(),
            base_url: base_url.clone(),
        }),
        Provider::Anthropic { api_key, model, base_url } => Box::new(AnthropicClient {
            api_key: api_key.clone(),
            model: model.clone(),
            base_url: base_url.clone(),
        }),
        Provider::Gemini { api_key, model, base_url } => Box::new(GeminiClient {
            api_key: api_key.clone(),
            model: model.clone(),
            base_url: base_url.clone(),
        }),
        Provider::Ollama { base_url, model } => Box::new(OllamaClient {
            base_url: base_url.clone(),
            model: model.clone(),
        }),
    }
}