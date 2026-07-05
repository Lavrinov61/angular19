fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        .build_server(true)
        .build_client(false)
        .file_descriptor_set_path("src/descriptor.bin")
        .compile_protos(
            &[
                "../proto/svf/common/v1/common.proto",
                "../proto/svf/platform/v1/config.proto",
                "../proto/svf/auth/v1/auth.proto",
                "../proto/svf/chat/v1/chat.proto",
                "../proto/svf/orders/v1/orders.proto",
                "../proto/svf/media/v1/media.proto",
                "../proto/grpc/health/v1/health.proto",
            ],
            &["../proto/svf", "../proto"],
        )?;
    Ok(())
}
