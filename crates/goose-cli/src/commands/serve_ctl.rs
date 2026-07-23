use anyhow::{Context, Result};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::{sleep, Instant};

const DEFAULT_SERVE_URL: &str = "http://127.0.0.1:3284";
const DEFAULT_SERVE_PORT: u16 = 3284;
const HEALTH_TIMEOUT_SECS: u64 = 15;
const HEALTH_POLL_MS: u64 = 200;

pub fn default_serve_url() -> &'static str {
    DEFAULT_SERVE_URL
}

async fn is_serve_healthy(url: &str) -> bool {
    let health_url = format!("{}/health", url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap_or_default();
    client
        .get(&health_url)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

async fn try_start_via_systemd() -> bool {
    let status = Command::new("systemctl")
        .args(["--user", "start", "goose-serve"])
        .status()
        .await;
    matches!(status, Ok(s) if s.success())
}

/// Ensure `goose serve` is running, starting it if needed.
///
/// Returns the URL of the running serve instance on success.
/// Priority: already running → systemd user service → direct spawn.
pub async fn ensure_serve_running(url: Option<&str>) -> Result<String> {
    let serve_url = url.unwrap_or(DEFAULT_SERVE_URL).to_owned();

    if is_serve_healthy(&serve_url).await {
        return Ok(serve_url);
    }

    if try_start_via_systemd().await {
        let deadline = Instant::now() + Duration::from_secs(HEALTH_TIMEOUT_SECS);
        while Instant::now() < deadline {
            if is_serve_healthy(&serve_url).await {
                return Ok(serve_url);
            }
            sleep(Duration::from_millis(HEALTH_POLL_MS)).await;
        }
    }

    tracing::info!(
        "Starting goose serve directly on port {}",
        DEFAULT_SERVE_PORT
    );
    let _child = Command::new("goose")
        .args([
            "serve",
            "--host",
            "127.0.0.1",
            "--port",
            &DEFAULT_SERVE_PORT.to_string(),
            "--dangerously-unauthenticated",
        ])
        .spawn()
        .context("Failed to spawn goose serve — is goose installed?")?;

    let deadline = Instant::now() + Duration::from_secs(HEALTH_TIMEOUT_SECS);
    while Instant::now() < deadline {
        if is_serve_healthy(&serve_url).await {
            return Ok(serve_url);
        }
        sleep(Duration::from_millis(HEALTH_POLL_MS)).await;
    }

    anyhow::bail!(
        "goose serve did not become healthy at {} within {}s",
        serve_url,
        HEALTH_TIMEOUT_SECS
    )
}
