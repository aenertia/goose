use crate::agents::extension::PlatformExtensionContext;
use crate::agents::mcp_client::{Error, McpClientTrait};
use crate::agents::tool_execution::ToolCallContext;
use crate::session::extension_data::ExtensionState;
use anyhow::Result;
use async_trait::async_trait;
use indoc::indoc;
use rmcp::model::{
    CallToolResult, Content, Implementation, InitializeResult, JsonObject, ListToolsResult,
    ServerCapabilities, Tool, ToolAnnotations,
};
use schemars::{schema_for, JsonSchema};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

pub static EXTENSION_NAME: &str = "honk";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HonkExtState {
    pub mode: Option<String>,
    pub screen_reader_active: Option<bool>,
}

impl ExtensionState for HonkExtState {
    const EXTENSION_NAME: &'static str = "honk";
    const VERSION: &'static str = "v0";
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
struct HonkModeParams {
    mode: String,
}

pub struct HonkClient {
    info: InitializeResult,
    context: PlatformExtensionContext,
}

impl HonkClient {
    pub fn new(context: PlatformExtensionContext) -> Result<Self> {
        let info = InitializeResult::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new(EXTENSION_NAME.to_string(), "1.0.0".to_string())
                    .with_title("HONK Integration"),
            )
            .with_instructions(
                indoc! {r#"
                HONK Integration extension for Goose. Provides tools to check voice capabilities
                and control conversation mode.

                Use honk_status to check what voice features are available before attempting
                voice operations. Use honk_mode to switch between conversation modes.
            "#}
                .to_string(),
            );

        Ok(Self { info, context })
    }

    fn read_config_value(key: &str) -> Option<String> {
        let config = crate::config::Config::global();
        config
            .get(key, false)
            .ok()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .filter(|s| !s.is_empty())
    }

    fn voice_configured() -> bool {
        Self::read_config_value("VOICE_TTS_PROVIDER").is_some()
    }

    fn dictation_configured() -> bool {
        Self::read_config_value("VOICE_DICTATION_PROVIDER").is_some()
    }

    async fn handle_status(&self, _session_id: &str) -> Result<Vec<Content>, String> {
        let tts_provider = Self::read_config_value("VOICE_TTS_PROVIDER")
            .unwrap_or_else(|| "not configured".to_string());
        let tts_voice =
            Self::read_config_value("VOICE_TTS_VOICE").unwrap_or_else(|| "default".to_string());
        let tts_format =
            Self::read_config_value("VOICE_TTS_FORMAT").unwrap_or_else(|| "opus".to_string());
        let stt_provider = Self::read_config_value("VOICE_DICTATION_PROVIDER")
            .unwrap_or_else(|| "not configured".to_string());

        let tts_ready = tts_provider != "not configured";
        let stt_ready = stt_provider != "not configured";

        let status = format!(
            "HONK Status:\n\
             TTS: {} (provider: {}, voice: {}, format: {})\n\
             STT: {} (provider: {})\n\
             Conversation mode: {}",
            if tts_ready { "ready" } else { "not configured" },
            tts_provider,
            tts_voice,
            tts_format,
            if stt_ready { "ready" } else { "not configured" },
            stt_provider,
            if tts_ready && stt_ready {
                "available (use /honk on in TUI or voice button in desktop)"
            } else {
                "unavailable (requires both TTS and STT providers)"
            },
        );

        Ok(vec![Content::text(status)])
    }

    async fn handle_mode(
        &self,
        session_id: &str,
        arguments: Option<JsonObject>,
    ) -> Result<Vec<Content>, String> {
        let mode = arguments
            .as_ref()
            .ok_or("Missing arguments")?
            .get("mode")
            .and_then(|v| v.as_str())
            .ok_or("Missing required parameter: mode")?
            .to_string();

        let valid_modes = ["honk", "text", "off"];
        if !valid_modes.contains(&mode.as_str()) {
            return Err(format!(
                "Invalid mode '{}' — use one of: {}",
                mode,
                valid_modes.join(", ")
            ));
        }

        let manager = &self.context.session_manager;
        match manager.get_session(session_id, false).await {
            Ok(mut session) => {
                let state = HonkExtState {
                    mode: Some(mode.clone()),
                    screen_reader_active: None,
                };
                state
                    .to_extension_data(&mut session.extension_data)
                    .map_err(|e| format!("Failed to serialize honk state: {e}"))?;

                manager
                    .update(session_id)
                    .extension_data(session.extension_data)
                    .apply()
                    .await
                    .map_err(|_| "Failed to update session".to_string())?;

                Ok(vec![Content::text(format!("HONK mode set to: {}", mode))])
            }
            Err(_) => Err("Failed to read session".to_string()),
        }
    }

    fn get_tools() -> Vec<Tool> {
        let mode_schema = schema_for!(HonkModeParams);
        let mode_schema_value =
            serde_json::to_value(mode_schema).expect("Failed to serialize HonkModeParams schema");

        vec![
            Tool::new(
                "honk_status".to_string(),
                "Check HONK voice I/O capabilities: TTS provider, STT provider, \
                 conversation mode availability. Call this before attempting \
                 HONK operations to know what is configured."
                    .to_string(),
                serde_json::Map::new(),
            )
            .annotate(ToolAnnotations::from_raw(
                Some("HONK Status".to_string()),
                Some(true),
                Some(true),
                Some(false),
                Some(false),
            )),
            Tool::new(
                "honk_mode".to_string(),
                indoc! {r#"
                    Switch HONK interaction mode:
                    - "honk": Full conversation mode (TTS + STT, always-on mic with barge-in)
                    - "text": Text-only mode (disable TTS/STT, standard text interaction)
                    - "off": Disable all HONK features

                    Use this when the interaction style should change, e.g. switching to
                    text mode before showing code, or activating honk mode for discussion.
                "#}
                .to_string(),
                mode_schema_value.as_object().unwrap().clone(),
            )
            .annotate(ToolAnnotations::from_raw(
                Some("HONK Mode".to_string()),
                Some(false),
                Some(true),
                Some(false),
                Some(false),
            )),
        ]
    }
}

#[async_trait]
impl McpClientTrait for HonkClient {
    async fn list_tools(
        &self,
        _session_id: &str,
        _next_cursor: Option<String>,
        _cancellation_token: CancellationToken,
    ) -> Result<ListToolsResult, Error> {
        Ok(ListToolsResult {
            tools: Self::get_tools(),
            next_cursor: None,
            meta: None,
        })
    }

    async fn call_tool(
        &self,
        ctx: &ToolCallContext,
        name: &str,
        arguments: Option<JsonObject>,
        _cancellation_token: CancellationToken,
    ) -> Result<CallToolResult, Error> {
        let session_id = &ctx.session_id;
        let content = match name {
            "honk_status" => self.handle_status(session_id).await,
            "honk_mode" => self.handle_mode(session_id, arguments).await,
            _ => Err(format!("Unknown tool: {}", name)),
        };

        match content {
            Ok(content) => Ok(CallToolResult::success(content)),
            Err(error) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {}",
                error
            ))])),
        }
    }

    fn get_info(&self) -> Option<&InitializeResult> {
        Some(&self.info)
    }

    async fn get_moim(&self, _session_id: &str) -> Option<String> {
        if !Self::voice_configured() {
            return None;
        }
        let mut parts = Vec::new();
        parts.push("HONK voice I/O is available.".to_string());
        if Self::dictation_configured() {
            parts.push(
                "The user may be speaking via microphone. Full conversation mode is available."
                    .to_string(),
            );
        }
        Some(parts.join(" "))
    }
}
