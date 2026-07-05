fn main() {
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let proto_files = ["proto/print.proto", "proto/infra.proto"];

    let existing: Vec<&str> = proto_files
        .iter()
        .filter(|f| std::path::Path::new(f).exists())
        .copied()
        .collect();

    if !existing.is_empty() {
        match prost_build::compile_protos(&existing, &["proto/"]) {
            Ok(()) => return,
            Err(e) => {
                println!("cargo:warning=protobuf compilation failed: {e}");
                println!("cargo:warning=Install protoc: apt install protobuf-compiler");
            }
        }
    }

    // Generate empty modules as fallback so include! always works
    for name in ["svf.print.rs", "svf.infra.rs"] {
        let path = std::path::Path::new(&out_dir).join(name);
        if !path.exists() {
            std::fs::write(
                path,
                "// Proto not compiled. Install protoc: apt install protobuf-compiler\n",
            )
            .unwrap();
        }
    }
}
