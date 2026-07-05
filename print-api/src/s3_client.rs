/// S3 uploads target local MinIO in production; never inherit process HTTP_PROXY.
pub fn no_proxy_http_client() -> aws_sdk_s3::config::SharedHttpClient {
    aws_smithy_http_client::Builder::new()
        .tls_provider(aws_smithy_http_client::tls::Provider::Rustls(
            aws_smithy_http_client::tls::rustls_provider::CryptoMode::AwsLc,
        ))
        .build_https()
}
