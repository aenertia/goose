use super::*;
use crate::tts::providers::{
    all_tts_providers, get_tts_provider_def, is_tts_configured, list_voices, synthesize_with_model,
    synthesize_with_provider, TtsProvider,
};

impl GooseAcpAgent {
    pub(super) async fn on_tts_synthesize(
        &self,
        req: TtsSynthesizeRequest,
    ) -> Result<TtsSynthesizeResponse, agent_client_protocol::Error> {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

        let provider: TtsProvider = serde_json::from_value(serde_json::Value::String(
            req.provider.clone(),
        ))
        .map_err(|_| {
            agent_client_protocol::Error::invalid_params()
                .data(format!("Unknown TTS provider: {}", req.provider))
        })?;

        if provider == TtsProvider::Browser {
            return Err(agent_client_protocol::Error::invalid_params()
                .data("Browser TTS is handled client-side via speechSynthesis"));
        }

        let speed = if req.speed <= 0.0 { 1.0 } else { req.speed };

        let (audio_bytes, mime_type) = if provider == TtsProvider::ModelNative {
            synthesize_with_model(&req.text).await
        } else {
            synthesize_with_provider(provider, &req.text, &req.voice, speed).await
        }
        .internal_err()?;

        let audio = BASE64.encode(&audio_bytes);

        Ok(TtsSynthesizeResponse { audio, mime_type })
    }

    pub(super) async fn on_tts_config(
        &self,
        _req: TtsConfigRequest,
    ) -> Result<TtsConfigResponse, agent_client_protocol::Error> {
        let mut providers = std::collections::HashMap::new();

        for def in all_tts_providers() {
            let provider = def.provider;

            let provider_key = serde_json::to_value(provider)
                .ok()
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| format!("{:?}", provider).to_lowercase());

            providers.insert(
                provider_key,
                TtsProviderStatusEntry {
                    configured: is_tts_configured(provider),
                    description: def.description.to_string(),
                    uses_provider_config: def.uses_provider_config,
                    settings_path: def.settings_path.map(|s| s.to_string()),
                },
            );
        }

        Ok(TtsConfigResponse { providers })
    }

    pub(super) async fn on_tts_voices(
        &self,
        req: TtsVoicesRequest,
    ) -> Result<TtsVoicesResponse, agent_client_protocol::Error> {
        let provider: TtsProvider = serde_json::from_value(serde_json::Value::String(
            req.provider.clone(),
        ))
        .map_err(|_| {
            agent_client_protocol::Error::invalid_params()
                .data(format!("Unknown TTS provider: {}", req.provider))
        })?;

        let voices = list_voices(provider).await.internal_err()?;

        let voices = voices
            .into_iter()
            .map(|v| TtsVoiceInfo {
                id: v.id,
                name: v.name,
                preview_url: v.preview_url,
            })
            .collect();

        Ok(TtsVoicesResponse { voices })
    }

    pub(super) async fn on_tts_secret_save(
        &self,
        req: TtsSecretSaveRequest,
    ) -> Result<EmptyResponse, agent_client_protocol::Error> {
        let provider = parse_tts_provider(&req.provider)?;
        let key = tts_secret_config_key(provider)?;
        let config = self.config()?;
        config.set_secret(key, &req.value).internal_err()?;
        Config::global().invalidate_secrets_cache();
        Ok(EmptyResponse {})
    }

    pub(super) async fn on_tts_secret_delete(
        &self,
        req: TtsSecretDeleteRequest,
    ) -> Result<EmptyResponse, agent_client_protocol::Error> {
        let provider = parse_tts_provider(&req.provider)?;
        let key = tts_secret_config_key(provider)?;
        let config = self.config()?;
        config.delete_secret(key).internal_err()?;
        Config::global().invalidate_secrets_cache();
        Ok(EmptyResponse {})
    }
}

fn parse_tts_provider(provider: &str) -> Result<TtsProvider, agent_client_protocol::Error> {
    serde_json::from_value(serde_json::Value::String(provider.to_string())).map_err(|_| {
        agent_client_protocol::Error::invalid_params()
            .data(format!("Unknown TTS provider: {provider}"))
    })
}

fn tts_secret_config_key(
    provider: TtsProvider,
) -> Result<&'static str, agent_client_protocol::Error> {
    match provider {
        TtsProvider::ModelNative => Err(agent_client_protocol::Error::invalid_params()
            .data("Model-native TTS uses the active chat provider's credentials.")),
        TtsProvider::Browser => Err(agent_client_protocol::Error::invalid_params()
            .data("Browser TTS does not use an API key.")),
        _ => {
            let def = get_tts_provider_def(provider);
            if def.uses_provider_config {
                Err(agent_client_protocol::Error::invalid_params().data(
                    "TTS provider uses the main provider configuration. Configure its credentials in provider settings instead.",
                ))
            } else {
                Ok(def.config_key)
            }
        }
    }
}
