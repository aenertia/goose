use crate::config::tls::provider_tls_config_from_config;
use crate::config::Config;
use anyhow::Result;
use std::time::Duration;

/// Build a `reqwest::Client` with the given timeout and TLS config from provider settings.
pub(crate) fn build_provider_client(config: &Config, timeout: Duration) -> Result<reqwest::Client> {
    let tls = provider_tls_config_from_config(config)?;
    #[allow(unused_mut)]
    let mut client_builder = reqwest::Client::builder().timeout(timeout);
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
    client_builder.build().map_err(Into::into)
}
