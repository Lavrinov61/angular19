fn main() {
    let proto_file = "proto/infra.proto";
    if std::path::Path::new(proto_file).exists() {
        match prost_build::compile_protos(&[proto_file], &["proto/"]) {
            Ok(()) => return,
            Err(e) => {
                println!("cargo:warning=protobuf compilation failed: {e}");
                println!("cargo:warning=Install protoc: apt install protobuf-compiler");
            }
        }
    }

    let out_dir = std::env::var("OUT_DIR").unwrap();
    let path = std::path::Path::new(&out_dir).join("svf.infra.rs");
    if !path.exists() {
        std::fs::write(path, "// Proto not compiled\n").unwrap();
    }
}
