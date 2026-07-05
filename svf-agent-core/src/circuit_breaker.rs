//! Circuit breaker for protecting remote calls (MQTT publish, HTTP, SNMP).
//!
//! State machine: Closed → Open (on threshold failures) → HalfOpen (after
//! timeout) → Closed (on probe success) or back to Open (on probe failure).

use std::time::{Duration, Instant};

/// Circuit breaker state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    /// Normal operation — requests flow through.
    Closed,
    /// Failures exceeded threshold — requests are rejected immediately.
    Open,
    /// Timeout elapsed — one probe request is allowed through.
    HalfOpen,
}

/// A non-thread-safe circuit breaker (use behind `Mutex` if shared).
#[derive(Debug)]
pub struct CircuitBreaker {
    state: CircuitState,
    failure_count: u32,
    threshold: u32,
    reset_timeout: Duration,
    last_failure_at: Option<Instant>,
    name: String,
}

impl CircuitBreaker {
    /// Create a new circuit breaker.
    ///
    /// * `name` — label used in log messages.
    /// * `threshold` — consecutive failures before opening the circuit.
    /// * `reset_timeout` — time to wait in Open before allowing a probe.
    pub fn new(name: impl Into<String>, threshold: u32, reset_timeout: Duration) -> Self {
        Self {
            state: CircuitState::Closed,
            failure_count: 0,
            threshold,
            reset_timeout,
            last_failure_at: None,
            name: name.into(),
        }
    }

    /// Current state of the breaker.
    pub fn state(&self) -> CircuitState {
        self.state
    }

    /// Check whether a request is allowed.
    ///
    /// Returns `Ok(())` if the call may proceed, or `Err(remaining)` with the
    /// duration until the circuit transitions to HalfOpen.
    pub fn check(&mut self) -> Result<(), Duration> {
        match self.state {
            CircuitState::Closed => Ok(()),
            CircuitState::HalfOpen => Ok(()),
            CircuitState::Open => {
                let elapsed = self
                    .last_failure_at
                    .map(|t| t.elapsed())
                    .unwrap_or(Duration::ZERO);

                if elapsed >= self.reset_timeout {
                    tracing::info!(
                        circuit = %self.name,
                        "circuit breaker transitioning Open -> HalfOpen"
                    );
                    self.state = CircuitState::HalfOpen;
                    Ok(())
                } else {
                    Err(self.reset_timeout - elapsed)
                }
            }
        }
    }

    /// Record a successful call. Resets the breaker to Closed.
    pub fn record_success(&mut self) {
        if self.state != CircuitState::Closed {
            tracing::info!(
                circuit = %self.name,
                prev_state = ?self.state,
                "circuit breaker transitioning to Closed"
            );
        }
        self.state = CircuitState::Closed;
        self.failure_count = 0;
        self.last_failure_at = None;
    }

    /// Record a failed call. May trip the breaker to Open.
    pub fn record_failure(&mut self) {
        self.failure_count += 1;
        self.last_failure_at = Some(Instant::now());

        match self.state {
            CircuitState::Closed => {
                if self.failure_count >= self.threshold {
                    tracing::warn!(
                        circuit = %self.name,
                        failures = self.failure_count,
                        "circuit breaker transitioning Closed -> Open"
                    );
                    self.state = CircuitState::Open;
                }
            }
            CircuitState::HalfOpen => {
                tracing::warn!(
                    circuit = %self.name,
                    "probe failed, circuit breaker transitioning HalfOpen -> Open"
                );
                self.state = CircuitState::Open;
            }
            CircuitState::Open => {
                // Already open — nothing to do.
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closed_to_open_on_threshold() {
        let mut cb = CircuitBreaker::new("test", 3, Duration::from_secs(5));
        assert_eq!(cb.state(), CircuitState::Closed);

        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Closed);

        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);
    }

    #[test]
    fn open_rejects_then_half_open_after_timeout() {
        let mut cb = CircuitBreaker::new("test", 1, Duration::from_millis(1));
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);

        // Immediately should still be open.
        assert!(cb.check().is_err());

        // After the tiny timeout it should transition.
        std::thread::sleep(Duration::from_millis(5));
        assert!(cb.check().is_ok());
        assert_eq!(cb.state(), CircuitState::HalfOpen);
    }

    #[test]
    fn half_open_success_closes() {
        let mut cb = CircuitBreaker::new("test", 1, Duration::from_millis(1));
        cb.record_failure();
        std::thread::sleep(Duration::from_millis(5));
        let _ = cb.check();
        assert_eq!(cb.state(), CircuitState::HalfOpen);

        cb.record_success();
        assert_eq!(cb.state(), CircuitState::Closed);
    }

    #[test]
    fn half_open_failure_reopens() {
        let mut cb = CircuitBreaker::new("test", 1, Duration::from_millis(1));
        cb.record_failure();
        std::thread::sleep(Duration::from_millis(5));
        let _ = cb.check();
        assert_eq!(cb.state(), CircuitState::HalfOpen);

        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);
    }
}
