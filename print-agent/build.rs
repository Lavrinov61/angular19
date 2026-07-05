fn main() -> std::io::Result<()> {
    // Compile print-specific protobuf
    prost_build::Config::new()
        .compile_protos(&["proto/print.proto"], &["proto/"])?;

    // Compile infra protobuf (shared with svf-agent-core)
    prost_build::Config::new()
        .compile_protos(&["proto/infra.proto"], &["proto/"])?;

    Ok(())
}
