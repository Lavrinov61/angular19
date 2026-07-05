/// DKIM — генерация ключей и DNS-запись
use base64::Engine;
use rsa::pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey, LineEnding};
use rsa::RsaPrivateKey;
use std::path::Path;
use tracing::{info, warn};

/// Загрузить или сгенерировать DKIM private key
pub fn load_or_generate_dkim_key(path: &str) -> Result<RsaPrivateKey, Box<dyn std::error::Error>> {
    let key_path = Path::new(path);

    if key_path.exists() {
        info!("Загружаем DKIM private key из {}", path);
        let pem = std::fs::read_to_string(key_path)?;
        let key = RsaPrivateKey::from_pkcs8_pem(&pem)?;
        Ok(key)
    } else {
        warn!("DKIM key не найден, генерируем новый: {}", path);

        // Создаём директорию если нужно
        if let Some(parent) = key_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut rng = rand::thread_rng();
        let key = RsaPrivateKey::new(&mut rng, 2048)?;

        // Сохраняем PEM
        let pem = key.to_pkcs8_pem(LineEnding::LF)?;
        std::fs::write(key_path, pem.as_bytes())?;

        // Устанавливаем права 600
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(key_path, std::fs::Permissions::from_mode(0o600))?;
        }

        info!("DKIM key сгенерирован и сохранён в {}", path);
        Ok(key)
    }
}

/// Получить DNS TXT запись для DKIM
pub fn get_dkim_dns_record(
    key: &RsaPrivateKey,
    selector: &str,
    domain: &str,
) -> Result<DkimDnsRecord, Box<dyn std::error::Error>> {
    let public_key = rsa::RsaPublicKey::from(key);
    let public_der = public_key.to_public_key_der()?;
    let public_b64 = base64::engine::general_purpose::STANDARD.encode(public_der.as_bytes());

    let name = format!("{selector}._domainkey.{domain}");
    let value = format!("v=DKIM1; k=rsa; p={public_b64}");

    Ok(DkimDnsRecord { name, value })
}

/// DNS-запись для DKIM
#[derive(Debug, serde::Serialize)]
pub struct DkimDnsRecord {
    pub name: String,
    pub value: String,
}
