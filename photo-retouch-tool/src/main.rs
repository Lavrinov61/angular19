use std::io::{self, Read};
use std::path::PathBuf;

use photo_retouch_tool::{
    CropDocumentInput, ToolRequest, ToolResponse, crop_document_to_path, detect_crop_lines,
};

fn main() {
    let response = run();
    let status_ok = response.success;
    let _ = serde_json::to_writer(io::stdout(), &response);
    if !status_ok {
        std::process::exit(1);
    }
}

fn run() -> ToolResponse {
    let mut input = String::new();
    if let Err(err) = io::stdin().read_to_string(&mut input) {
        return ToolResponse::error(format!("failed to read stdin: {err}"));
    }

    let request: ToolRequest = match serde_json::from_str(&input) {
        Ok(value) => value,
        Err(err) => return ToolResponse::error(format!("invalid request JSON: {err}")),
    };

    match request {
        ToolRequest::Health => ToolResponse::ok(serde_json::json!({ "status": "ok" })),
        ToolRequest::DetectCropLines { image_path } => {
            match detect_crop_lines(PathBuf::from(image_path).as_path()) {
                Ok(result) => ToolResponse::ok(result),
                Err(err) => ToolResponse::error(err.to_string()),
            }
        }
        ToolRequest::CropDocument(input) => {
            let output_path = PathBuf::from(&input.output_path);
            match crop_document_to_path(CropDocumentInput {
                output_path,
                ..input
            }) {
                Ok(result) => ToolResponse::ok(result),
                Err(err) => ToolResponse::error(err.to_string()),
            }
        }
    }
}
