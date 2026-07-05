use std::io;
use std::path::Path;

use tokio::fs;
use uuid::Uuid;

use crate::mime_parser::ParsedAttachment;

#[derive(Debug, Clone)]
pub struct StoredAttachment {
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub storage_url: String,
}

pub async fn store_attachments(
    base_dir: &Path,
    url_prefix: &str,
    email_id: i32,
    attachments: &[ParsedAttachment],
) -> io::Result<Vec<StoredAttachment>> {
    if attachments.is_empty() {
        return Ok(Vec::new());
    }

    let email_dir = base_dir.join(email_id.to_string());
    fs::create_dir_all(&email_dir).await?;

    let mut stored = Vec::with_capacity(attachments.len());
    for attachment in attachments {
        let stored_name = build_stored_filename(&attachment.filename);
        let file_path = email_dir.join(&stored_name);
        fs::write(&file_path, &attachment.content).await?;

        stored.push(StoredAttachment {
            filename: display_filename(&attachment.filename),
            mime_type: attachment.mime_type.clone(),
            size_bytes: attachment.content.len() as i64,
            storage_url: build_storage_url(url_prefix, email_id, &stored_name),
        });
    }

    Ok(stored)
}

fn display_filename(filename: &str) -> String {
    let trimmed = filename.trim();
    if trimmed.is_empty() {
        "attachment".to_string()
    } else {
        trimmed.to_string()
    }
}

fn build_stored_filename(filename: &str) -> String {
    let basename = filename
        .rsplit(|ch| ch == '/' || ch == '\\')
        .next()
        .unwrap_or("attachment")
        .trim();
    let basename = if basename.is_empty() {
        "attachment"
    } else {
        basename
    };

    let (stem, ext) = split_safe_extension(basename);
    let sanitized_stem = sanitize_path_part(stem);
    let stem = if sanitized_stem.is_empty() {
        "attachment".to_string()
    } else {
        sanitized_stem
    };

    let id = Uuid::new_v4().simple();
    if let Some(ext) = ext {
        format!("{id}_{stem}.{ext}")
    } else {
        format!("{id}_{stem}")
    }
}

fn split_safe_extension(filename: &str) -> (&str, Option<String>) {
    let Some(dot_index) = filename.rfind('.') else {
        return (filename, None);
    };
    if dot_index == 0 || dot_index + 1 >= filename.len() {
        return (filename, None);
    }

    let ext = &filename[dot_index + 1..];
    if ext.len() > 16 || !ext.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return (filename, None);
    }

    (&filename[..dot_index], Some(ext.to_ascii_lowercase()))
}

fn sanitize_path_part(value: &str) -> String {
    let mut result = String::with_capacity(value.len().min(80));
    let mut last_was_separator = false;

    for ch in value.chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            Some(ch.to_ascii_lowercase())
        } else if ch == '-' || ch == '_' || ch.is_ascii_whitespace() {
            Some('_')
        } else {
            None
        };

        if let Some(ch) = mapped {
            if ch == '_' {
                if last_was_separator {
                    continue;
                }
                last_was_separator = true;
            } else {
                last_was_separator = false;
            }
            result.push(ch);
            if result.len() >= 80 {
                break;
            }
        }
    }

    result.trim_matches('_').to_string()
}

fn build_storage_url(prefix: &str, email_id: i32, stored_name: &str) -> String {
    let prefix = prefix.trim_end_matches('/');
    if prefix.starts_with('/') {
        format!("{prefix}/{email_id}/{stored_name}")
    } else {
        format!("/{prefix}/{email_id}/{stored_name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_safe_storage_name_and_url_from_untrusted_filename() {
        let stored_name = build_stored_filename("../скан паспорта?.pdf");

        assert!(stored_name.ends_with("_attachment.pdf"));
        assert!(!stored_name.contains('/'));
        assert!(!stored_name.contains(".."));
        assert_eq!(
            build_storage_url("/uploads/email-attachments/", 225, &stored_name),
            format!("/uploads/email-attachments/225/{stored_name}")
        );
    }

    #[tokio::test]
    async fn stores_attachment_file_and_returns_downloadable_metadata() {
        let base_dir =
            std::env::temp_dir().join(format!("mail-api-attachment-test-{}", Uuid::new_v4()));
        let attachments = vec![ParsedAttachment {
            filename: "invoice.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            content: b"pdf bytes".to_vec(),
        }];

        let stored = store_attachments(&base_dir, "/uploads/email-attachments", 17, &attachments)
            .await
            .expect("attachment should be stored");

        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].filename, "invoice.pdf");
        assert_eq!(stored[0].mime_type, "application/pdf");
        assert_eq!(stored[0].size_bytes, 9);
        assert!(stored[0]
            .storage_url
            .starts_with("/uploads/email-attachments/17/"));

        let stored_name = stored[0].storage_url.rsplit('/').next().unwrap();
        let file_path = base_dir.join("17").join(stored_name);
        assert_eq!(
            fs::read(&file_path)
                .await
                .expect("stored file should exist"),
            b"pdf bytes"
        );

        let _ = fs::remove_dir_all(base_dir).await;
    }
}
