use crate::config::Config;
use anyhow::Result;
use std::collections::HashMap;

pub(crate) struct ModelNativeResolved {
    pub(crate) api_key: String,
    pub(crate) base_url: String,
    pub(crate) headers: Option<HashMap<String, String>>,
}

/// Resolve base URL for OpenAI from env/config, matching openai_def.rs logic.
pub(crate) fn resolve_openai_base_url(config: &Config) -> String {
    if let Ok(h) = std::env::var("OPENAI_HOST") {
        return h;
    }
    if let Ok(u) = config.get_param::<String>("OPENAI_BASE_URL") {
        let trimmed = u.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    config
        .get_param::<String>("OPENAI_HOST")
        .unwrap_or_else(|_| "https://api.openai.com".to_string())
}

/// Try to resolve model-native config for declarative providers and OpenAI.
/// Returns `Ok(Some(..))` on match, `Ok(None)` if the provider is not handled.
pub(crate) fn resolve_model_native_config(
    config: &Config,
    provider_name: &str,
) -> Result<Option<ModelNativeResolved>> {
    if let Ok(loaded) = crate::config::declarative_providers::load_provider(provider_name) {
        let mut cfg = loaded.config;
        use goose_providers::declarative::ProviderEngine;
        match cfg.engine {
            ProviderEngine::OpenAI | ProviderEngine::Ollama => {}
            ProviderEngine::Anthropic => {
                anyhow::bail!(
                    "Provider '{}' uses the Anthropic engine which does not support model-native audio",
                    provider_name
                )
            }
        }
        if let Some(ref env_vars) = cfg.env_vars {
            cfg.base_url =
                crate::config::declarative_providers::expand_env_vars(&cfg.base_url, env_vars)?;
        }
        let api_key = if cfg.api_key_env.is_empty() || !cfg.requires_auth {
            String::new()
        } else {
            config.get_secret::<String>(&cfg.api_key_env).map_err(|_| {
                anyhow::anyhow!(
                    "API key '{}' required for provider '{}' but not configured",
                    cfg.api_key_env,
                    provider_name
                )
            })?
        };
        let headers = cfg.headers.clone();
        return Ok(Some(ModelNativeResolved {
            api_key,
            base_url: cfg.base_url,
            headers,
        }));
    }

    if provider_name == "openai" {
        let api_key = config
            .get_secret::<String>("OPENAI_API_KEY")
            .unwrap_or_default();
        let base_url = resolve_openai_base_url(config);
        let mut headers: HashMap<String, String> = config
            .get_secret::<String>("OPENAI_CUSTOM_HEADERS")
            .ok()
            .map(crate::providers::openai::parse_custom_headers)
            .unwrap_or_default();
        if let Ok(org) = config.get_param::<String>("OPENAI_ORGANIZATION") {
            headers.insert("OpenAI-Organization".to_string(), org);
        }
        if let Ok(project) = config.get_param::<String>("OPENAI_PROJECT") {
            headers.insert("OpenAI-Project".to_string(), project);
        }
        let headers = if headers.is_empty() {
            None
        } else {
            Some(headers)
        };
        return Ok(Some(ModelNativeResolved {
            api_key,
            base_url,
            headers,
        }));
    }

    Ok(None)
}
