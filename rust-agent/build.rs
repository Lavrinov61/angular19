fn main() {
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let proto_file = "proto/print.proto";

    if std::path::Path::new(proto_file).exists() {
        match prost_build::compile_protos(&[proto_file], &["proto/"]) {
            Ok(()) => return,
            Err(e) => {
                println!("cargo:warning=protobuf compilation failed: {e}");
                println!("cargo:warning=Install protoc: apt install protobuf-compiler");
            }
        }
    }

    // Fallback: empty module so include! always works
    let path = std::path::Path::new(&out_dir).join("svf.print.rs");
    std::fs::write(path, "// Proto not compiled. Install protoc: apt install protobuf-compiler\n").unwrap();
}
