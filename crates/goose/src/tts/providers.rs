use crate::config::tls::provider_tls_config_from_config;
use crate::config::Config;
use crate::providers::openai::parse_openai_base_url;
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64_STD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

const TTS_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TtsProvider {
    OpenAI,
    ElevenLabs,
    Browser,
    #[serde(rename = "model")]
    ModelNative,
}

pub struct TtsProviderDef {
    pub provider: TtsProvider,
    pub config_key: &'static str,
    pub default_base_url: &'static str,
    pub description: &'static str,
    pub uses_provider_config: bool,
    pub settings_path: Option<&'static str>,
}

pub const PROVIDERS: &[TtsProviderDef] = &[
    TtsProviderDef {
        provider: TtsProvider::OpenAI,
        config_key: "OPENAI_API_KEY",
        default_base_url: "https://api.openai.com",
        description: "Uses OpenAI TTS API for high-quality speech synthesis.",
        uses_provider_config: true,
        settings_path: Some("Settings > Models"),
    },
    TtsProviderDef {
        provider: TtsProvider::ElevenLabs,
        config_key: "ELEVENLABS_API_KEY",
        default_base_url: "https://api.elevenlabs.io",
        description: "Uses ElevenLabs API for realistic voice synthesis.",
        uses_provider_config: false,
        settings_path: None,
    },
];

pub const BROWSER_PROVIDER_DEF: TtsProviderDef = TtsProviderDef {
    provider: TtsProvider::Browser,
    config_key: "",
    default_base_url: "",
    description: "Uses your browser's built-in speech synthesis. No API key needed.",
    uses_provider_config: false,
    settings_path: None,
};

pub const MODEL_NATIVE_PROVIDER_DEF: TtsProviderDef = TtsProviderDef {
    provider: TtsProvider::ModelNative,
    config_key: "",
    default_base_url: "",
    description: "Uses your active chat model for speech synthesis. Supports models with native audio output (e.g. GPT-4o-audio). No separate API key needed.",
    uses_provider_config: true,
    settings_path: Some("Settings > Models"),
};

pub fn all_tts_providers() -> Vec<&'static TtsProviderDef> {
    let mut all: Vec<&TtsProviderDef> = PROVIDERS.iter().collect();
    all.push(&BROWSER_PROVIDER_DEF);
    all.push(&MODEL_NATIVE_PROVIDER_DEF);
    all
}

pub fn get_tts_provider_def(provider: TtsProvider) -> &'static TtsProviderDef {
    if provider == TtsProvider::Browser {
        return &BROWSER_PROVIDER_DEF;
    }
    if provider == TtsProvider::ModelNative {
        return &MODEL_NATIVE_PROVIDER_DEF;
    }
    PROVIDERS
        .iter()
        .find(|def| def.provider == provider)
        .unwrap()
}

pub fn is_tts_configured(provider: TtsProvider) -> bool {
    let config = Config::global();

    match provider {
        TtsProvider::Browser => true,
        TtsProvider::ModelNative => {
            if let Some(name) = crate::config::providers::get_active_provider(config) {
                resolve_model_native_config(config, &name).is_ok()
            } else {
                false
            }
        }
        _ => {
            let has_endpoint = config
                .get_param::<String>("voice_tts_endpoint_url")
                .ok()
                .is_some_and(|u| !u.trim().is_empty());
            if has_endpoint {
                return true;
            }
            let def = get_tts_provider_def(provider);
            config.get_secret::<String>(def.config_key).is_ok()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    pub preview_url: Option<String>,
}

const OPENAI_VOICES: &[(&str, &str)] = &[
    ("alloy", "Alloy"),
    ("ash", "Ash"),
    ("ballad", "Ballad"),
    ("coral", "Coral"),
    ("echo", "Echo"),
    ("fable", "Fable"),
    ("nova", "Nova"),
    ("onyx", "Onyx"),
    ("sage", "Sage"),
    ("shimmer", "Shimmer"),
];

pub async fn list_voices(provider: TtsProvider) -> Result<Vec<VoiceInfo>> {
    let config = Config::global();
    let custom_endpoint = config
        .get_param::<String>("voice_tts_endpoint_url")
        .ok()
        .filter(|u| !u.trim().is_empty());

    match provider {
        TtsProvider::OpenAI => {
            if let Some(ref endpoint) = custom_endpoint {
                if let Ok(voices) = list_custom_endpoint_voices(endpoint).await {
                    if !voices.is_empty() {
                        return Ok(voices);
                    }
                }
            }
            Ok(OPENAI_VOICES
                .iter()
                .map(|(id, name)| VoiceInfo {
                    id: id.to_string(),
                    name: name.to_string(),
                    preview_url: None,
                })
                .collect())
        }
        TtsProvider::ElevenLabs => {
            if let Some(ref endpoint) = custom_endpoint {
                if let Ok(voices) = list_custom_endpoint_voices(endpoint).await {
                    if !voices.is_empty() {
                        return Ok(voices);
                    }
                }
            }
            list_elevenlabs_voices().await
        }
        TtsProvider::Browser | TtsProvider::ModelNative => Ok(vec![]),
    }
}

async fn list_custom_endpoint_voices(endpoint: &str) -> Result<Vec<VoiceInfo>> {
    let base = endpoint.trim_end_matches('/');
    let client = reqwest::Client::builder()
        .timeout(TTS_REQUEST_TIMEOUT)
        .build()?;

    // Try /v1/audio/voices first (OpenAI-compatible)
    if let Ok(resp) = client
        .get(format!("{}/v1/audio/voices", base))
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                let voices: Vec<VoiceInfo> = data["voices"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| {
                                let id = v["voice_id"]
                                    .as_str()
                                    .or_else(|| v["id"].as_str())?
                                    .to_string();
                                let name = v["name"]
                                    .as_str()
                                    .unwrap_or_else(|| v["voice_id"].as_str().unwrap_or(&id))
                                    .to_string();
                                Some(VoiceInfo {
                                    id,
                                    name,
                                    preview_url: v["preview_url"].as_str().map(|s| s.to_string()),
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                if !voices.is_empty() {
                    return Ok(voices);
                }
            }
        }
    }

    // Try /get_reference_files (Chatterbox TTS)
    if let Ok(resp) = client
        .get(format!("{}/get_reference_files", base))
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(files) = resp.json::<Vec<String>>().await {
                let voices: Vec<VoiceInfo> = files
                    .into_iter()
                    .map(|f| {
                        let name = f
                            .strip_suffix(".wav")
                            .or_else(|| f.strip_suffix(".mp3"))
                            .or_else(|| f.strip_suffix(".ogg"))
                            .or_else(|| f.strip_suffix(".flac"))
                            .unwrap_or(&f)
                            .replace(['-', '_'], " ");
                        VoiceInfo {
                            id: f,
                            name,
                            preview_url: None,
                        }
                    })
                    .collect();
                if !voices.is_empty() {
                    return Ok(voices);
                }
            }
        }
    }

    Ok(vec![])
}

async fn list_elevenlabs_voices() -> Result<Vec<VoiceInfo>> {
    let config = Config::global();
    let api_key: String = config.get_secret("ELEVENLABS_API_KEY").map_err(|e| {
        tracing::error!("ELEVENLABS_API_KEY not configured: {}", e);
        anyhow::anyhow!("ELEVENLABS_API_KEY not configured")
    })?;

    let client = reqwest::Client::builder()
        .timeout(TTS_REQUEST_TIMEOUT)
        .build()?;

    let response = client
        .get("https://api.elevenlabs.io/v1/voices")
        .header("xi-api-key", &api_key)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("ElevenLabs voices request failed: {}", e))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("ElevenLabs voices error: {}", body);
    }

    let data: serde_json::Value = response.json().await?;
    let voices = data["voices"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    Some(VoiceInfo {
                        id: v["voice_id"].as_str()?.to_string(),
                        name: v["name"].as_str()?.to_string(),
                        preview_url: v["preview_url"].as_str().map(|s| s.to_string()),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(voices)
}

/// Optional overrides for TTS synthesis — used by profile-based synthesis.
#[derive(Debug, Default)]
pub struct TtsSynthesizeOverrides {
    /// Custom base URL (e.g. `http://awa:9002` for F5-TTS). Empty = provider default.
    pub endpoint_url: String,
    /// API key to use instead of the global config value. Empty = use global.
    pub api_key: String,
    /// Audio response format: "opus"|"wav"|"mp3"|"pcm"|"ogg"|"flac". Empty = "opus".
    pub response_format: String,
    /// Quality hint for compressed formats: "low"|"medium"|"high". Empty = provider default.
    pub quality: String,
}

pub async fn synthesize_with_provider(
    provider: TtsProvider,
    text: &str,
    voice: &str,
    speed: f32,
) -> Result<(Vec<u8>, String)> {
    synthesize_with_provider_overrides(provider, text, voice, speed, &TtsSynthesizeOverrides::default()).await
}

pub async fn synthesize_with_provider_overrides(
    provider: TtsProvider,
    text: &str,
    voice: &str,
    speed: f32,
    overrides: &TtsSynthesizeOverrides,
) -> Result<(Vec<u8>, String)> {
    match provider {
        TtsProvider::OpenAI => synthesize_openai_compatible(text, voice, speed, overrides).await,
        TtsProvider::ElevenLabs => synthesize_elevenlabs(text, voice, overrides).await,
        TtsProvider::Browser => {
            anyhow::bail!("Browser TTS is handled client-side via speechSynthesis")
        }
        TtsProvider::ModelNative => {
            anyhow::bail!("Use synthesize_with_model for model-native TTS")
        }
    }
}

/// Synthesize using a saved TTS profile (looked up by ID).
pub async fn synthesize_with_profile(
    profile_id: &str,
    text: &str,
) -> Result<(Vec<u8>, String)> {
    let profile = crate::tts::profiles::get_profile(profile_id)?
        .ok_or_else(|| anyhow::anyhow!("TTS profile '{}' not found", profile_id))?;

    let provider: TtsProvider =
        serde_json::from_value(serde_json::Value::String(profile.provider.clone()))
            .map_err(|_| anyhow::anyhow!("Unknown TTS provider in profile: {}", profile.provider))?;

    if provider == TtsProvider::Browser {
        anyhow::bail!("Browser TTS is handled client-side via speechSynthesis");
    }
    if provider == TtsProvider::ModelNative {
        return synthesize_with_model(text).await;
    }

    // Resolve API key: try profile-specific secret, fall back to provider default.
    let config = Config::global();
    let api_key = if !profile.api_key_env.is_empty() {
        config
            .get_secret::<String>(&profile.api_key_env)
            .unwrap_or_default()
    } else {
        String::new()
    };

    let overrides = TtsSynthesizeOverrides {
        endpoint_url: profile.endpoint_url.clone(),
        api_key,
        response_format: String::new(),
        quality: String::new(),
    };

    synthesize_with_provider_overrides(
        provider,
        text,
        &profile.voice,
        profile.speed,
        &overrides,
    )
    .await
}

async fn synthesize_openai_compatible(
    text: &str,
    voice: &str,
    speed: f32,
    overrides: &TtsSynthesizeOverrides,
) -> Result<(Vec<u8>, String)> {
    let config = Config::global();

    let has_custom_endpoint = !overrides.endpoint_url.is_empty();

    let api_key: String = if !overrides.api_key.is_empty() {
        overrides.api_key.clone()
    } else if has_custom_endpoint {
        config
            .get_secret::<String>("OPENAI_API_KEY")
            .unwrap_or_default()
    } else {
        config.get_secret("OPENAI_API_KEY").map_err(|e| {
            tracing::error!("OPENAI_API_KEY not configured: {}", e);
            anyhow::anyhow!("OPENAI_API_KEY not configured")
        })?
    };

    let base_url = if has_custom_endpoint {
        overrides.endpoint_url.clone()
    } else {
        resolve_openai_base_url(config)
    };
    let (host, query_params, has_v1) = parse_openai_base_url(&base_url)?;
    let endpoint = if has_v1 {
        "v1/audio/speech"
    } else {
        "audio/speech"
    };

    let mut url = url::Url::parse(&format!("{}/{}", host, endpoint))
        .map_err(|e| anyhow::anyhow!("Invalid URL: {}", e))?;
    for (k, v) in &query_params {
        url.query_pairs_mut().append_pair(k, v);
    }

    let resolved_voice: String = if !voice.is_empty() {
        voice.to_string()
    } else if has_custom_endpoint {
        let config = Config::global();
        config
            .get_param::<String>("voice_tts_voice")
            .unwrap_or_default()
    } else {
        "alloy".to_string()
    };

    let fmt = if overrides.response_format.is_empty() {
        "opus"
    } else {
        &overrides.response_format
    };

    let body = serde_json::json!({
        "model": "tts-1",
        "input": text,
        "voice": if resolved_voice.is_empty() { "default" } else { &resolved_voice },
        "speed": speed,
        "response_format": fmt,
    });

    let tls = provider_tls_config_from_config(config)?;
    #[allow(unused_mut)]
    let mut client_builder = reqwest::Client::builder().timeout(TTS_REQUEST_TIMEOUT);
    #[cfg(any(feature = "rustls-tls", feature = "native-tls"))]
    if let Some(ref tls_config) = tls {
        if let Some(ref ca_cert_path) = tls_config.ca_cert_path {
            let ca_pem = std::fs::read_to_string(ca_cert_path)?;
            let certs = reqwest::Certificate::from_pem_bundle(ca_pem.as_bytes())?;
            for cert in certs {
                client_builder = client_builder.add_root_certificate(cert);
            }
        }
        if let Some(ref id) = tls_config.client_identity {
            let cert_pem = std::fs::read_to_string(&id.cert_path)?;
            let key_pem = std::fs::read_to_string(&id.key_path)?;
            let combined = format!("{}\n{}", cert_pem, key_pem);
            let identity = reqwest::Identity::from_pem(combined.as_bytes())?;
            client_builder = client_builder.identity(identity);
        }
    }
    #[cfg(not(any(feature = "rustls-tls", feature = "native-tls")))]
    let _ = &tls;

    let client = client_builder.build()?;

    let mut headers_map: HashMap<String, String> = config
        .get_secret::<String>("OPENAI_CUSTOM_HEADERS")
        .ok()
        .map(crate::providers::openai::parse_custom_headers)
        .unwrap_or_default();
    if let Ok(org) = config.get_param::<String>("OPENAI_ORGANIZATION") {
        headers_map.insert("OpenAI-Organization".to_string(), org);
    }
    if let Ok(project) = config.get_param::<String>("OPENAI_PROJECT") {
        headers_map.insert("OpenAI-Project".to_string(), project);
    }

    let mut req = client
        .post(url.as_str())
        .header("Content-Type", "application/json")
        .json(&body);

    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }
    for (k, v) in &headers_map {
        req = req.header(k, v);
    }

    let response = req.send().await.map_err(|e| {
        tracing::error!("OpenAI TTS request failed: {}", e);
        anyhow::anyhow!("TTS request failed: {}", e)
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if status.as_u16() == 401 {
            anyhow::bail!("Invalid API key");
        }
        anyhow::bail!("OpenAI TTS error ({}): {}", status, body);
    }

    let audio_bytes = response.bytes().await?.to_vec();
    let mime_type = match fmt {
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "pcm" => "audio/pcm",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        _ => "audio/ogg", // opus → ogg container
    };
    Ok((audio_bytes, mime_type.to_string()))
}

async fn synthesize_elevenlabs(
    text: &str,
    voice: &str,
    overrides: &TtsSynthesizeOverrides,
) -> Result<(Vec<u8>, String)> {
    let config = Config::global();

    let api_key: String = if !overrides.api_key.is_empty() {
        overrides.api_key.clone()
    } else {
        config.get_secret("ELEVENLABS_API_KEY").map_err(|e| {
            tracing::error!("ELEVENLABS_API_KEY not configured: {}", e);
            anyhow::anyhow!("ELEVENLABS_API_KEY not configured")
        })?
    };

    let base_url = if !overrides.endpoint_url.is_empty() {
        overrides.endpoint_url.clone()
    } else {
        "https://api.elevenlabs.io".to_string()
    };

    let voice_id = if voice.is_empty() {
        "21m00Tcm4TlvDq8ikWAM"
    } else {
        voice
    };

    let body = serde_json::json!({
        "text": text,
        "model_id": "eleven_monolingual_v1"
    });

    let client = reqwest::Client::builder()
        .timeout(TTS_REQUEST_TIMEOUT)
        .build()?;

    let response = client
        .post(format!(
            "{}/v1/text-to-speech/{}",
            base_url.trim_end_matches('/'),
            voice_id
        ))
        .header("xi-api-key", &api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("ElevenLabs TTS request failed: {}", e);
            anyhow::anyhow!("TTS request failed: {}", e)
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if status.as_u16() == 401 {
            anyhow::bail!("Invalid API key");
        }
        anyhow::bail!("ElevenLabs TTS error ({}): {}", status, body);
    }

    let audio_bytes = response.bytes().await?.to_vec();
    Ok((audio_bytes, "audio/ogg".to_string()))
}

const MODEL_TTS_TIMEOUT: Duration = Duration::from_secs(60);

pub async fn synthesize_with_model(text: &str) -> Result<(Vec<u8>, String)> {
    let config = Config::global();

    let provider_name = crate::config::providers::get_active_provider(config)
        .ok_or_else(|| anyhow::anyhow!("No active provider configured"))?;

    let model_name = crate::config::providers::get_active_model(config)
        .ok_or_else(|| anyhow::anyhow!("No active model configured"))?;

    let resolved = resolve_model_native_config(config, &provider_name)?;

    let request_body = serde_json::json!({
        "model": model_name,
        "modalities": ["text", "audio"],
        "audio": { "voice": "alloy", "format": "mp3" },
        "messages": [{
            "role": "user",
            "content": text
        }]
    });

    let tls = provider_tls_config_from_config(config)?;
    #[allow(unused_mut)]
    let mut client_builder = reqwest::Client::builder().timeout(MODEL_TTS_TIMEOUT);
    #[cfg(any(feature = "rustls-tls", feature = "native-tls"))]
    if let Some(ref tls_config) = tls {
        if let Some(ref ca_cert_path) = tls_config.ca_cert_path {
            let ca_pem = std::fs::read_to_string(ca_cert_path)?;
            let certs = reqwest::Certificate::from_pem_bundle(ca_pem.as_bytes())?;
            for cert in certs {
                client_builder = client_builder.add_root_certificate(cert);
            }
        }
        if let Some(ref id) = tls_config.client_identity {
            let cert_pem = std::fs::read_to_string(&id.cert_path)?;
            let key_pem = std::fs::read_to_string(&id.key_path)?;
            let combined = format!("{}\n{}", cert_pem, key_pem);
            let identity = reqwest::Identity::from_pem(combined.as_bytes())?;
            client_builder = client_builder.identity(identity);
        }
    }
    #[cfg(not(any(feature = "rustls-tls", feature = "native-tls")))]
    let _ = &tls;
    let client = client_builder.build()?;

    let (host, query_params, has_v1) = parse_openai_base_url(&resolved.base_url)?;
    let endpoint = if has_v1 {
        "v1/chat/completions"
    } else {
        "chat/completions"
    };
    let mut parsed_url = url::Url::parse(&format!("{}/{}", host, endpoint))?;
    for (k, v) in &query_params {
        parsed_url.query_pairs_mut().append_pair(k, v);
    }

    let mut req = client
        .post(parsed_url.as_str())
        .header("Content-Type", "application/json")
        .json(&request_body);

    if !resolved.api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", resolved.api_key));
    }
    if let Some(ref custom_headers) = resolved.headers {
        for (k, v) in custom_headers {
            req = req.header(k, v);
        }
    }

    let response = req.send().await.map_err(|e| {
        tracing::error!("Model-native TTS request failed: {}", e);
        anyhow::anyhow!("TTS request failed: {}", e)
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if status.as_u16() == 401 {
            anyhow::bail!("Invalid API key");
        }
        anyhow::bail!("Chat completions TTS error ({}): {}", status, body);
    }

    let data: serde_json::Value = response.json().await?;

    let audio_b64 = data["choices"][0]["message"]["audio"]["data"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("No audio data in chat completions response"))?;

    let audio_bytes = BASE64_STD
        .decode(audio_b64)
        .map_err(|e| anyhow::anyhow!("Failed to decode audio base64: {}", e))?;

    Ok((audio_bytes, "audio/ogg".to_string()))
}

fn resolve_openai_base_url(config: &Config) -> String {
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

struct ModelNativeResolved {
    api_key: String,
    base_url: String,
    headers: Option<HashMap<String, String>>,
}

fn resolve_model_native_config(
    config: &Config,
    provider_name: &str,
) -> Result<ModelNativeResolved> {
    if let Ok(loaded) = crate::config::declarative_providers::load_provider(provider_name) {
        let mut cfg = loaded.config;
        use goose_providers::declarative::ProviderEngine;
        match cfg.engine {
            ProviderEngine::OpenAI | ProviderEngine::Ollama => {}
            ProviderEngine::Anthropic => {
                anyhow::bail!(
                    "Provider '{}' uses the Anthropic engine which does not support model-native TTS",
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
                    "API key '{}' required for model-native TTS but not configured",
                    cfg.api_key_env
                )
            })?
        };
        let headers = cfg.headers.clone();
        return Ok(ModelNativeResolved {
            api_key,
            base_url: cfg.base_url,
            headers,
        });
    }

    match provider_name {
        "openai" => {
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
            Ok(ModelNativeResolved {
                api_key,
                base_url,
                headers,
            })
        }
        other => {
            anyhow::bail!(
                "Provider '{}' is not supported for model-native TTS. Use a provider with audio output support.",
                other
            )
        }
    }
}
