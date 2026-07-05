use crate::auth::AuthInterceptor;
use crate::request_context::RequestContext;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use tonic::body::BoxBody;
use tonic::codegen::http::{Request as HttpRequest, Response as HttpResponse};
use tower::{Layer, Service};
use tracing::Instrument;

/// Tower layer that authenticates HTTP/2 gRPC requests before tonic dispatch.
#[derive(Clone)]
pub struct AuthLayer {
    interceptor: AuthInterceptor,
}

impl AuthLayer {
    pub fn new(interceptor: AuthInterceptor) -> Self {
        Self { interceptor }
    }
}

impl<S> Layer<S> for AuthLayer {
    type Service = AuthMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        AuthMiddleware {
            inner,
            interceptor: self.interceptor.clone(),
        }
    }
}

#[derive(Clone)]
pub struct AuthMiddleware<S> {
    inner: S,
    interceptor: AuthInterceptor,
}

impl<S> Service<HttpRequest<BoxBody>> for AuthMiddleware<S>
where
    S: Service<HttpRequest<BoxBody>, Response = HttpResponse<BoxBody>> + Clone + Send + 'static,
    S::Error: Send + 'static,
    S::Future: Send + 'static,
{
    type Response = HttpResponse<BoxBody>;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, mut req: HttpRequest<BoxBody>) -> Self::Future {
        let interceptor = self.interceptor.clone();
        let request_context = RequestContext::from_http_request(&req);
        req.extensions_mut().insert(request_context.clone());
        let task_context = request_context.clone();
        let response_context = request_context.clone();
        let span = request_context.span();

        // Use the instance that was just polled ready, and leave a clone behind.
        let clone = self.inner.clone();
        let mut inner = std::mem::replace(&mut self.inner, clone);

        Box::pin(async move {
            task_context
                .scope(
                    async move {
                        if let Err(status) = interceptor.authenticate_http_request(&mut req).await {
                            let mut response = status.into_http();
                            response_context.insert_response_headers(&mut response);
                            return Ok(response);
                        }

                        let mut response = inner.call(req).await?;
                        response_context.insert_response_headers(&mut response);
                        Ok(response)
                    }
                    .instrument(span),
                )
                .await
        })
    }
}
