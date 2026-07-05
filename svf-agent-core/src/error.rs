//! Unified error types for SVF agents.
//!
//! Classifies errors as transient (retryable) or permanent (non-retryable)
//! to drive retry logic and circuit breaker decisions.

use std::fmt;

/// Top-level agent error.
#[derive(Debug)]
pub enum AgentError {
    /// Retryable failure (network timeout, broker disconnect, etc.)
    Transient(TransientError),
    /// Non-retryable failure (invalid config, auth rejected, bad payload).
    Permanent(PermanentError),
    /// Configuration error (missing field, parse failure).
    Config(String),
    /// IO error (file system, pipe, etc.)
    Io(std::io::Error),
    /// MQTT client error.
    Mqtt(rumqttc::ClientError),
}

/// A retryable error with an optional cause.
#[derive(Debug)]
pub struct TransientError {
    pub message: String,
    pub source: Option<Box<dyn std::error::Error + Send + Sync>>,
}

/// A non-retryable error with an optional cause.
#[derive(Debug)]
pub struct PermanentError {
    pub message: String,
    pub source: Option<Box<dyn std::error::Error + Send + Sync>>,
}

// ── Builder helpers ────────────────────────────────────────────

impl AgentError {
    /// Create a transient (retryable) error from a message.
    pub fn transient(msg: impl Into<String>) -> Self {
        Self::Transient(TransientError {
            message: msg.into(),
            source: None,
        })
    }

    /// Create a transient error with an underlying cause.
    pub fn transient_with(
        msg: impl Into<String>,
        source: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self::Transient(TransientError {
            message: msg.into(),
            source: Some(Box::new(source)),
        })
    }

    /// Create a permanent (non-retryable) error from a message.
    pub fn permanent(msg: impl Into<String>) -> Self {
        Self::Permanent(PermanentError {
            message: msg.into(),
            source: None,
        })
    }

    /// Create a permanent error with an underlying cause.
    pub fn permanent_with(
        msg: impl Into<String>,
        source: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self::Permanent(PermanentError {
            message: msg.into(),
            source: Some(Box::new(source)),
        })
    }

    /// Create a configuration error.
    pub fn config(msg: impl Into<String>) -> Self {
        Self::Config(msg.into())
    }

    /// Returns `true` for errors that are safe to retry.
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Transient(_) | Self::Io(_) | Self::Mqtt(_))
    }
}

// ── Display ────────────────────────────────────────────────────

impl fmt::Display for AgentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transient(e) => write!(f, "transient: {}", e.message),
            Self::Permanent(e) => write!(f, "permanent: {}", e.message),
            Self::Config(msg) => write!(f, "config: {msg}"),
            Self::Io(e) => write!(f, "io: {e}"),
            Self::Mqtt(e) => write!(f, "mqtt: {e}"),
        }
    }
}

impl std::error::Error for AgentError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Transient(e) => e.source.as_deref().map(|s| s as &dyn std::error::Error),
            Self::Permanent(e) => e.source.as_deref().map(|s| s as &dyn std::error::Error),
            Self::Io(e) => Some(e),
            Self::Mqtt(e) => Some(e),
            Self::Config(_) => None,
        }
    }
}

// ── From conversions ───────────────────────────────────────────

impl From<std::io::Error> for AgentError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<rumqttc::ClientError> for AgentError {
    fn from(e: rumqttc::ClientError) -> Self {
        Self::Mqtt(e)
    }
}

impl From<anyhow::Error> for AgentError {
    fn from(e: anyhow::Error) -> Self {
        Self::Permanent(PermanentError {
            message: e.to_string(),
            source: Some(e.into()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transient_is_retryable() {
        let err = AgentError::transient("timeout");
        assert!(err.is_retryable());
    }

    #[test]
    fn test_permanent_not_retryable() {
        let err = AgentError::permanent("invalid proto");
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_config_not_retryable() {
        let err = AgentError::config("empty studio_id");
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_io_is_retryable() {
        let err = AgentError::from(std::io::Error::new(std::io::ErrorKind::TimedOut, "timeout"));
        assert!(err.is_retryable());
    }

    #[test]
    fn test_display() {
        let err = AgentError::transient("connection reset");
        assert!(err.to_string().contains("transient"));
        assert!(err.to_string().contains("connection reset"));
    }
}
