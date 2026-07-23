use crate::config::tls::provider_tls_config_from_config;
use crate::config::Config;
#[cfg(feature = "local-inference")]
use crate::dictation::whisper::LOCAL_WHISPER_MODEL_CONFIG_KEY;
use crate::providers::api_client::{ApiClient, AuthMethod};
use crate::providers::http_helpers::build_provider_client;
use crate::providers::model_native::ModelNativeResolved;
use crate::providers::openai::parse_openai_base_url;
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64_STD, Engine as _};
use serde::{Deserialize, Serialize};
#[cfg(feature = "local-inference")]
use std::sync::Mutex;
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const OPENAI_VERSIONLESS_TRANSCRIPTIONS_PATH: &str = "audio/transcriptions";
type OpenAiDictationTarget = (String, Vec<(String, String)>, String);

#[cfg(feature = "local-inference")]
static LOCAL_TRANSCRIBER: once_cell::sync::Lazy<
    Mutex<Option<(String, super::whisper::WhisperTranscriber)>>,
> = once_cell::sync::Lazy::new(|| Mutex::new(None));

#[cfg(feature = "local-inference")]
const WHISPER_TOKENIZER_JSON: &str = include_str!("whisper_data/tokens.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DictationProvider {
    OpenAI,
    ElevenLabs,
    Groq,
    #[serde(rename = "model")]
    ModelNative,
    #[cfg(feature = "local-inference")]
    Local,
}

pub struct DictationProviderDef {
    pub provider: DictationProvider,
    pub config_key: &'static str,
    pub default_base_url: &'static str,
    pub endpoint_path: &'static str,
    pub host_key: Option<&'static str>,
    pub description: &'static str,
    pub uses_provider_config: bool,
    pub settings_path: Option<&'static str>,
}

pub const PROVIDERS: &[DictationProviderDef] = &[
    DictationProviderDef {
        provider: DictationProvider::OpenAI,
        config_key: "OPENAI_API_KEY",
        default_base_url: "https://api.openai.com",
        endpoint_path: "v1/audio/transcriptions",
        host_key: Some("OPENAI_HOST"),
        description: "Uses OpenAI Whisper API for high-quality transcription.",
        uses_provider_config: true,
        settings_path: Some("Settings > Models"),
    },
    DictationProviderDef {
        provider: DictationProvider::Groq,
        config_key: "GROQ_API_KEY",
        default_base_url: "https://api.groq.com/openai/v1",
        endpoint_path: "audio/transcriptions",
        host_key: None,
        description: "Uses Groq's ultra-fast Whisper implementation with LPU acceleration.",
        uses_provider_config: false,
        settings_path: None,
    },
    DictationProviderDef {
        provider: DictationProvider::ElevenLabs,
        config_key: "ELEVENLABS_API_KEY",
        default_base_url: "https://api.elevenlabs.io",
        endpoint_path: "v1/speech-to-text",
        host_key: None,
        description: "Uses ElevenLabs speech-to-text API for advanced voice processing.",
        uses_provider_config: false,
        settings_path: None,
    },
];

#[cfg(feature = "local-inference")]
pub const LOCAL_PROVIDER_DEF: DictationProviderDef = DictationProviderDef {
    provider: DictationProvider::Local,
    config_key: LOCAL_WHISPER_MODEL_CONFIG_KEY,
    default_base_url: "",
    endpoint_path: "",
    host_key: None,
    description: "Uses local Whisper model for transcription. No API key needed.",
    uses_provider_config: false,
    settings_path: None,
};

pub const MODEL_NATIVE_PROVIDER_DEF: DictationProviderDef = DictationProviderDef {
    provider: DictationProvider::ModelNative,
    config_key: "",
    default_base_url: "",
    endpoint_path: "",
    host_key: None,
    description: "Uses your active chat model for transcription. Supports models with native audio input (e.g. Gemini, GPT-4o-audio, Gemma4). No separate API key needed.",
    uses_provider_config: true,
    settings_path: Some("Settings > Models"),
};

/// Returns all provider definitions, including Local when the `local-inference` feature is enabled.
pub fn all_providers() -> Vec<&'static DictationProviderDef> {
    #[cfg(not(feature = "local-inference"))]
    {
        let mut all: Vec<&DictationProviderDef> = PROVIDERS.iter().collect();
        all.push(&MODEL_NATIVE_PROVIDER_DEF);
        all
    }
    #[cfg(feature = "local-inference")]
    {
        let mut all: Vec<&DictationProviderDef> = PROVIDERS.iter().collect();
        all.push(&LOCAL_PROVIDER_DEF);
        all.push(&MODEL_NATIVE_PROVIDER_DEF);
        all
    }
}

pub fn get_provider_def(provider: DictationProvider) -> &'static DictationProviderDef {
    #[cfg(feature = "local-inference")]
    if provider == DictationProvider::Local {
        return &LOCAL_PROVIDER_DEF;
    }
    if provider == DictationProvider::ModelNative {
        return &MODEL_NATIVE_PROVIDER_DEF;
    }
    PROVIDERS
        .iter()
        .find(|def| def.provider == provider)
        .unwrap()
}

pub fn is_configured(provider: DictationProvider) -> bool {
    let config = Config::global();

    match provider {
        #[cfg(feature = "local-inference")]
        DictationProvider::Local => config
            .get(LOCAL_WHISPER_MODEL_CONFIG_KEY, false)
            .ok()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .and_then(|id| super::whisper::get_model(&id))
            .is_some_and(|m| m.is_downloaded()),
        DictationProvider::ModelNative => {
            // Only configured if the active provider can be resolved for
            // model-native dictation (OpenAI-compatible endpoint required).
            if let Some(name) = crate::config::providers::get_active_provider(config) {
                resolve_model_native_config(config, &name).is_ok()
            } else {
                false
            }
        }
        _ => {
            let def = get_provider_def(provider);
            config.get_secret::<String>(def.config_key).is_ok()
        }
    }
}

#[cfg(feature = "local-inference")]
pub async fn transcribe_local(audio_bytes: Vec<u8>) -> Result<String> {
    tokio::task::spawn_blocking(move || {
        let config = Config::global();
        let model_id = config
            .get(LOCAL_WHISPER_MODEL_CONFIG_KEY, false)
            .ok()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .ok_or_else(|| anyhow::anyhow!("Local Whisper model not configured"))?;

        let model = super::whisper::get_model(&model_id)
            .ok_or_else(|| anyhow::anyhow!("Unknown model: {}", model_id))?;
        let model_path = model.local_path();

        let mut transcriber_lock = LOCAL_TRANSCRIBER
            .lock()
            .map_err(|e| anyhow::anyhow!("Failed to lock transcriber: {}", e))?;

        let model_path_str = model_path.to_string_lossy().to_string();
        let needs_reload = match transcriber_lock.as_ref() {
            None => true,
            Some((cached_path, _)) => cached_path != &model_path_str,
        };

        if needs_reload {
            tracing::info!("Loading Whisper model from: {}", model_path.display());

            let transcriber = super::whisper::WhisperTranscriber::new_with_tokenizer(
                &model_id,
                &model_path,
                WHISPER_TOKENIZER_JSON,
            )?;

            *transcriber_lock = Some((model_path_str, transcriber));
        }

        let (_, transcriber) = transcriber_lock.as_mut().unwrap();
        let text = transcriber.transcribe(&audio_bytes).map_err(|e| {
            tracing::error!("Transcription failed: {}", e);
            e
        })?;

        Ok(text)
    })
    .await
    .map_err(|e| {
        tracing::error!("Transcription task failed: {}", e);
        anyhow::anyhow!(e)
    })?
}

fn openai_dictation_target(raw_url: &str) -> Result<OpenAiDictationTarget> {
    let (host, query_params, has_v1) = parse_openai_base_url(raw_url)?;
    let endpoint_path = if has_v1 {
        "v1/audio/transcriptions".to_string()
    } else {
        OPENAI_VERSIONLESS_TRANSCRIPTIONS_PATH.to_string()
    };
    Ok((host, query_params, endpoint_path))
}

fn resolve_openai_base_url_target(raw_url: Option<&str>) -> Result<Option<OpenAiDictationTarget>> {
    raw_url
        .map(str::trim)
        .filter(|raw_url| !raw_url.is_empty())
        .map(openai_dictation_target)
        .transpose()
}

fn build_api_client(provider: DictationProvider) -> Result<(ApiClient, String)> {
    let config = Config::global();
    let def = get_provider_def(provider);

    let api_key = config.get_secret(def.config_key).map_err(|e| {
        tracing::error!("{} not configured: {}", def.config_key, e);
        anyhow::anyhow!("{} not configured", def.config_key)
    })?;

    let (base_url, query_params, endpoint_path) = if provider == DictationProvider::OpenAI {
        let openai_base_url = config.get_param::<String>("OPENAI_BASE_URL").ok();

        if let Ok(host) = std::env::var("OPENAI_HOST") {
            (host, vec![], def.endpoint_path.to_string())
        } else if let Some(target) = resolve_openai_base_url_target(openai_base_url.as_deref())? {
            target
        } else if let Ok(host) = config.get_param::<String>("OPENAI_HOST") {
            (host, vec![], def.endpoint_path.to_string())
        } else {
            (
                def.default_base_url.to_string(),
                vec![],
                def.endpoint_path.to_string(),
            )
        }
    } else if let Some(host_key) = def.host_key {
        let base_url = config
            .get(host_key, false)
            .ok()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| def.default_base_url.to_string());
        (base_url, vec![], def.endpoint_path.to_string())
    } else {
        (
            def.default_base_url.to_string(),
            vec![],
            def.endpoint_path.to_string(),
        )
    };

    // voice_stt_endpoint overrides the resolved base URL when set
    let base_url = config
        .get_param::<String>("voice_stt_endpoint")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or(base_url);

    let auth = match provider {
        DictationProvider::OpenAI => AuthMethod::BearerToken(api_key),
        DictationProvider::Groq => AuthMethod::BearerToken(api_key),
        DictationProvider::ElevenLabs => AuthMethod::ApiKey {
            header_name: "xi-api-key".to_string(),
            key: api_key,
        },
        DictationProvider::ModelNative => {
            anyhow::bail!("ModelNative does not use the dictation API client")
        }
        #[cfg(feature = "local-inference")]
        DictationProvider::Local => anyhow::bail!("Local provider should not use API client"),
    };

    let tls = provider_tls_config_from_config(config)?;
    let mut client = ApiClient::with_timeout_and_tls(base_url, auth, REQUEST_TIMEOUT, tls)
        .map_err(|e| {
            tracing::error!("Failed to create API client: {}", e);
            e
        })?;
    if !query_params.is_empty() {
        client = client.with_query(query_params);
    }
    Ok((client, endpoint_path))
}

pub async fn transcribe_with_provider(
    provider: DictationProvider,
    model_param: String,
    model_value: String,
    audio_bytes: Vec<u8>,
    extension: &str,
    mime_type: &str,
) -> Result<String> {
    let (client, endpoint_path) = build_api_client(provider)?;

    let part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(format!("audio.{}", extension))
        .mime_str(mime_type)
        .map_err(|e| {
            tracing::error!("Failed to create multipart: {}", e);
            anyhow::anyhow!(e)
        })?;

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text(model_param, model_value);

    let response = client
        .request(&endpoint_path)
        .multipart_post(form)
        .await
        .map_err(|e| {
            tracing::error!("Request failed: {}", e);
            e
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();

        if status == 401 || error_text.contains("Invalid API key") {
            anyhow::bail!("Invalid API key");
        } else if status == 429 || error_text.contains("quota") {
            anyhow::bail!("Rate limit exceeded");
        } else if error_text.contains("too short") {
            return Ok(String::new());
        } else {
            anyhow::bail!("API error: {}", error_text);
        }
    }

    let data: serde_json::Value = response.json().await.map_err(|e| {
        tracing::error!("Failed to parse response: {}", e);
        anyhow::anyhow!(e)
    })?;

    let text = data["text"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Missing 'text' field in response"))?
        .to_string();

    Ok(text)
}

const MODEL_TRANSCRIPTION_TIMEOUT: Duration = Duration::from_secs(60);
const TRANSCRIPTION_SYSTEM_PROMPT: &str =
    "Transcribe the following audio exactly as spoken. Output only the transcription text, with no commentary, labels, formatting, or explanation.";

pub async fn transcribe_with_model(audio_bytes: Vec<u8>, audio_format: &str) -> Result<String> {
    let config = Config::global();

    let provider_name = crate::config::providers::get_active_provider(config)
        .ok_or_else(|| anyhow::anyhow!("No active provider configured"))?;

    let model_name = crate::config::providers::get_active_model(config)
        .ok_or_else(|| anyhow::anyhow!("No active model configured"))?;

    let resolved = resolve_model_native_config(config, &provider_name)?;
    let api_key = &resolved.api_key;
    let base_url = &resolved.base_url;
    let audio_base64 = BASE64_STD.encode(&audio_bytes);

    let request_body = serde_json::json!({
        "model": model_name,
        "messages": [{
            "role": "user",
            "content": [
                { "type": "text", "text": TRANSCRIPTION_SYSTEM_PROMPT },
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": audio_base64,
                        "format": audio_format
                    }
                }
            ]
        }]
    });

    let client = build_provider_client(config, MODEL_TRANSCRIPTION_TIMEOUT)?;

    // Parse the base URL to handle paths and query params correctly.
    let (host, query_params, has_v1) = parse_openai_base_url(base_url)?;
    let endpoint = if has_v1 {
        "v1/chat/completions"
    } else {
        "chat/completions"
    };
    let mut parsed_url = url::Url::parse(&format!("{}/{}", host, endpoint))
        .map_err(|e| anyhow::anyhow!("Invalid URL: {}", e))?;
    for (k, v) in &query_params {
        parsed_url.query_pairs_mut().append_pair(k, v);
    }
    let url = parsed_url.to_string();

    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&request_body);

    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }
    if let Some(ref custom_headers) = resolved.headers {
        for (k, v) in custom_headers {
            req = req.header(k, v);
        }
    }

    let response = req.send().await.map_err(|e| {
        tracing::error!("Model-native transcription request failed: {}", e);
        anyhow::anyhow!("Transcription request failed: {}", e)
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if status.as_u16() == 401 {
            anyhow::bail!("Invalid API key");
        }
        anyhow::bail!("Chat completions error ({}): {}", status, body);
    }

    let data: serde_json::Value = response.json().await.map_err(|e| {
        tracing::error!("Failed to parse chat completions response: {}", e);
        anyhow::anyhow!(e)
    })?;

    let text = data["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("No content in chat completions response"))?
        .to_string();

    Ok(text)
}

fn resolve_model_native_config(
    config: &Config,
    provider_name: &str,
) -> Result<ModelNativeResolved> {
    if let Some(resolved) =
        crate::providers::model_native::resolve_model_native_config(config, provider_name)?
    {
        return Ok(resolved);
    }

    match provider_name {
        "openrouter" => {
            let api_key = config
                .get_secret::<String>("OPENROUTER_API_KEY")
                .unwrap_or_default();
            let mut base_url = config
                .get_param::<String>("OPENROUTER_HOST")
                .unwrap_or_else(|_| "https://openrouter.ai/api/v1".to_string());
            if !base_url.contains("/api") {
                base_url = format!("{}/api/v1", base_url.trim_end_matches('/'));
            } else if base_url.ends_with("/api") {
                base_url = format!("{}/v1", base_url);
            }
            Ok(ModelNativeResolved {
                api_key,
                base_url,
                headers: None,
            })
        }
        "groq" => {
            let api_key = config
                .get_secret::<String>("GROQ_API_KEY")
                .unwrap_or_default();
            let base_url = config
                .get_param::<String>("GROQ_HOST")
                .unwrap_or_else(|_| "https://api.groq.com/openai".to_string());
            Ok(ModelNativeResolved {
                api_key,
                base_url,
                headers: None,
            })
        }
        "ollama" => {
            let base_url = config
                .get_param::<String>("OLLAMA_HOST")
                .unwrap_or_else(|_| "http://localhost:11434".to_string());
            Ok(ModelNativeResolved {
                api_key: String::new(),
                base_url,
                headers: None,
            })
        }
        "google" => {
            let has_custom_host = config.get_param::<String>("GOOGLE_HOST").is_ok();
            let api_key = if has_custom_host {
                config
                    .get_secret::<String>("GOOGLE_API_KEY")
                    .unwrap_or_default()
            } else {
                config.get_secret::<String>("GOOGLE_API_KEY").map_err(|_| {
                    anyhow::anyhow!(
                        "GOOGLE_API_KEY required for model-native dictation \
                         with the hosted Gemini endpoint"
                    )
                })?
            };
            let base_url = config
                .get_param::<String>("GOOGLE_HOST")
                .unwrap_or_else(|_| {
                    "https://generativelanguage.googleapis.com/v1beta/openai".to_string()
                });
            Ok(ModelNativeResolved {
                api_key,
                base_url,
                headers: None,
            })
        }
        other => {
            anyhow::bail!(
                "Provider '{}' is not supported for model-native dictation. \
                 Use a provider with an OpenAI-compatible chat completions endpoint.",
                other
            )
        }
    }
}
#[cfg(test)]
mod tests {
    use super::{
        openai_dictation_target, resolve_openai_base_url_target,
        OPENAI_VERSIONLESS_TRANSCRIPTIONS_PATH,
    };

    #[test]
    fn openai_dictation_target_preserves_prefix_and_query_params() {
        let (host, query_params, endpoint_path) = openai_dictation_target(
            "https://user:pass@gateway.example.com/openai/v1?api-version=2024-02-01",
        )
        .unwrap();
        assert_eq!(host, "https://user:pass@gateway.example.com/openai");
        assert_eq!(
            query_params,
            vec![("api-version".to_string(), "2024-02-01".to_string())]
        );
        assert_eq!(endpoint_path, "v1/audio/transcriptions");
    }

    #[test]
    fn openai_dictation_target_uses_versionless_endpoint_without_v1() {
        let (host, query_params, endpoint_path) =
            openai_dictation_target("https://gateway.example.com/custom/api").unwrap();
        assert_eq!(host, "https://gateway.example.com/custom/api");
        assert!(query_params.is_empty());
        assert_eq!(endpoint_path, OPENAI_VERSIONLESS_TRANSCRIPTIONS_PATH);
    }

    #[test]
    fn openai_dictation_target_keeps_v1_endpoint_for_bare_host() {
        let (host, query_params, endpoint_path) =
            openai_dictation_target("https://api.openai.com").unwrap();
        assert_eq!(host, "https://api.openai.com");
        assert!(query_params.is_empty());
        assert_eq!(endpoint_path, "v1/audio/transcriptions");
    }

    #[test]
    fn resolve_openai_base_url_target_ignores_blank_values() {
        assert!(resolve_openai_base_url_target(Some("   "))
            .unwrap()
            .is_none());
    }
}
