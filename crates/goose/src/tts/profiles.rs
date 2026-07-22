use crate::config::paths::Paths;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

/// Directory name under config dir for TTS profile JSON files.
const TTS_PROFILES_DIR: &str = "tts_profiles";

/// A named TTS voice profile storing provider, endpoint, credentials, and voice
/// settings. Persisted as individual JSON files in `<config>/tts_profiles/`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtsProfile {
    pub id: String,
    pub name: String,
    /// One of: "openai", "elevenlabs", "browser", "model"
    pub provider: String,
    /// Custom endpoint URL. Empty string means use provider default.
    #[serde(default)]
    pub endpoint_url: String,
    /// Config key name for the API key (stored in the secret store, not inline).
    /// e.g. "TTS_PROFILE_<ID>_API_KEY"
    #[serde(default)]
    pub api_key_env: String,
    /// Voice identifier (provider-specific).
    #[serde(default)]
    pub voice: String,
    /// Playback speed multiplier (0.25–4.0).
    #[serde(default = "default_speed")]
    pub speed: f32,
}

fn default_speed() -> f32 {
    1.0
}

fn profiles_dir() -> PathBuf {
    Paths::config_dir().join(TTS_PROFILES_DIR)
}

fn profile_path(id: &str) -> PathBuf {
    profiles_dir().join(format!("{}.json", id))
}

/// List all saved TTS profiles.
pub fn list_profiles() -> Result<Vec<TtsProfile>> {
    let dir = profiles_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut profiles = Vec::new();
    for entry in fs::read_dir(&dir).context("Failed to read tts_profiles directory")? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json") {
            match fs::read_to_string(&path) {
                Ok(contents) => match serde_json::from_str::<TtsProfile>(&contents) {
                    Ok(profile) => profiles.push(profile),
                    Err(e) => {
                        tracing::warn!("Skipping malformed TTS profile {:?}: {}", path, e);
                    }
                },
                Err(e) => {
                    tracing::warn!("Failed to read TTS profile {:?}: {}", path, e);
                }
            }
        }
    }

    profiles.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(profiles)
}

/// Get a single TTS profile by ID.
pub fn get_profile(id: &str) -> Result<Option<TtsProfile>> {
    let path = profile_path(id);
    if !path.exists() {
        return Ok(None);
    }
    let contents =
        fs::read_to_string(&path).with_context(|| format!("Failed to read TTS profile {}", id))?;
    let profile: TtsProfile = serde_json::from_str(&contents)
        .with_context(|| format!("Failed to parse TTS profile {}", id))?;
    Ok(Some(profile))
}

/// Save (create or update) a TTS profile. If `profile.id` is empty, a new UUID
/// is generated. Returns the saved profile (with id populated).
pub fn save_profile(mut profile: TtsProfile) -> Result<TtsProfile> {
    if profile.id.is_empty() {
        profile.id = Uuid::new_v4().to_string();
    }

    // Derive a secret-store key name for this profile's API key.
    if profile.api_key_env.is_empty() && !profile.id.is_empty() {
        profile.api_key_env = api_key_env_for_id(&profile.id);
    }

    profile.speed = profile.speed.clamp(0.25, 4.0);

    let dir = profiles_dir();
    fs::create_dir_all(&dir).context("Failed to create tts_profiles directory")?;

    let path = profile_path(&profile.id);
    let json = serde_json::to_string_pretty(&profile).context("Failed to serialize TTS profile")?;
    fs::write(&path, json).with_context(|| format!("Failed to write TTS profile to {:?}", path))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    Ok(profile)
}

/// Delete a TTS profile by ID. Returns true if the file existed and was removed.
pub fn delete_profile(id: &str) -> Result<bool> {
    let path = profile_path(id);
    if path.exists() {
        fs::remove_file(&path).with_context(|| format!("Failed to delete TTS profile {}", id))?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Derive the secret-store key name for a profile's API key.
///
/// Uses SHA-256 of the profile ID so that reading the profile JSON file does
/// not reveal the keyring key name.
pub fn api_key_env_for_id(profile_id: &str) -> String {
    use sha2::{Digest, Sha256};

    let hash = Sha256::digest(profile_id.as_bytes());
    let hex: String = hash.iter().map(|b| format!("{:02x}", b)).collect();
    format!("TTS_KEY_{}", hex)
}
