use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{Request, Response, StatusCode},
    middleware::Next,
};
use governor::{
    clock::DefaultClock,
    state::{InMemoryState, NotKeyed},
    Quota, RateLimiter,
};
use std::{
    collections::HashMap,
    net::SocketAddr,
    num::NonZeroU32,
    sync::Arc,
    time::Duration,
};
use tokio::sync::RwLock;

/// Per-IP rate limiter using token bucket algorithm.
///
/// Default: 120 requests per minute per IP (configurable via kb_config).
/// Burst: 20 requests (allows short bursts without throttling).
///
/// Returns 429 Too Many Requests with Retry-After header when exceeded.
#[derive(Clone)]
pub struct RateLimitState {
    limiters: Arc<RwLock<HashMap<String, Arc<RateLimiter<NotKeyed, InMemoryState, DefaultClock>>>>>,
    requests_per_minute: u32,
    burst_size: u32,
}

impl RateLimitState {
    pub fn new(requests_per_minute: u32, burst_size: u32) -> Self {
        Self {
            limiters: Arc::new(RwLock::new(HashMap::new())),
            requests_per_minute,
            burst_size,
        }
    }

    async fn get_limiter(
        &self,
        key: &str,
    ) -> Arc<RateLimiter<NotKeyed, InMemoryState, DefaultClock>> {
        // Fast path: check if limiter exists
        {
            let limiters = self.limiters.read().await;
            if let Some(limiter) = limiters.get(key) {
                return Arc::clone(limiter);
            }
        }

        // Slow path: create limiter
        let mut limiters = self.limiters.write().await;
        // Double-check after acquiring write lock
        if let Some(limiter) = limiters.get(key) {
            return Arc::clone(limiter);
        }

        let quota = Quota::with_period(Duration::from_secs(60))
            .unwrap()
            .allow_burst(
                NonZeroU32::new(self.burst_size).unwrap_or(NonZeroU32::new(1).unwrap()),
            );

        // Apply per-minute rate by using per_second with calculated rate
        let per_second_rate =
            NonZeroU32::new(self.requests_per_minute / 60).unwrap_or(NonZeroU32::new(2).unwrap());
        let quota = Quota::per_second(per_second_rate)
            .allow_burst(NonZeroU32::new(self.burst_size).unwrap_or(NonZeroU32::new(1).unwrap()));

        let limiter = Arc::new(RateLimiter::direct(quota));
        limiters.insert(key.to_string(), Arc::clone(&limiter));
        limiter
    }

    /// Periodic cleanup of stale limiters (call from background task)
    pub async fn cleanup_stale(&self) {
        let mut limiters = self.limiters.write().await;
        // Keep map from growing unbounded — remove entries that haven't been used
        // In production, use a more sophisticated eviction strategy
        if limiters.len() > 10_000 {
            limiters.clear();
            tracing::info!("Cleared rate limiter cache ({} entries)", limiters.len());
        }
    }
}

/// Rate limiting middleware
pub async fn rate_limit(
    rate_limit_state: Option<axum::Extension<RateLimitState>>,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    req: Request<Body>,
    next: Next,
) -> Result<Response<Body>, StatusCode> {
    let Some(state) = rate_limit_state else {
        // Rate limiting not configured — pass through
        return Ok(next.run(req).await);
    };

    // Extract client IP
    let client_ip = connect_info
        .map(|ci| ci.0.ip().to_string())
        .or_else(|| {
            // Try X-Forwarded-For (behind nginx)
            req.headers()
                .get("x-forwarded-for")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.split(',').next())
                .map(|s| s.trim().to_string())
        })
        .or_else(|| {
            // Try X-Real-IP
            req.headers()
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string());

    let limiter = state.get_limiter(&client_ip).await;

    match limiter.check() {
        Ok(()) => Ok(next.run(req).await),
        Err(_) => {
            tracing::warn!("Rate limit exceeded for IP: {client_ip}");
            let retry_after = 60 / state.requests_per_minute.max(1);
            let response = Response::builder()
                .status(StatusCode::TOO_MANY_REQUESTS)
                .header("Retry-After", retry_after.to_string())
                .header("Content-Type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "error": "Too many requests",
                        "retry_after_seconds": retry_after
                    })
                    .to_string(),
                ))
                .unwrap();
            Ok(response)
        }
    }
}
