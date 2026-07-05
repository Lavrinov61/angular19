//! SNMP v2c polling for Canon printer status (RFC 3805).
//!
//! Implements raw ASN.1/BER encoding/decoding for SNMP GET requests over UDP.
//! Zero external SNMP dependencies — uses only `std::net::UdpSocket`.
//!
//! OID reference (Printer MIB, RFC 3805):
//! - sysDescr:       .1.3.6.1.2.1.1.1.0
//! - deviceStatus:   .1.3.6.1.2.1.43.5.1.1.1.1
//! - paper level:    .1.3.6.1.2.1.43.8.2.1.10.1.1
//! - supply name:    .1.3.6.1.2.1.43.11.1.1.6.1.{1-4}
//! - supply max:     .1.3.6.1.2.1.43.11.1.1.8.1.{1-4}
//! - supply current: .1.3.6.1.2.1.43.11.1.1.9.1.{1-4}

use std::net::UdpSocket;
use std::time::Duration;

use tracing::{debug, warn};

// ── Data types ──

/// Complete SNMP-polled printer data.
#[derive(Debug, Clone, serde::Serialize, Default)]
pub struct SnmpPrinterData {
    pub sys_descr: String,
    pub device_status: u32,
    pub supplies: Vec<SnmpSupply>,
    pub paper_level: Option<i32>,
    pub firmware: String,
}

/// A single supply (toner cartridge, drum unit, etc).
#[derive(Debug, Clone, serde::Serialize)]
pub struct SnmpSupply {
    pub name: String,
    pub max_capacity: i32,
    pub current_level: i32,
    /// Color name derived from supply description (Black, Cyan, Magenta, Yellow).
    pub color: String,
}

// ── OID constants ──

/// Standard Printer MIB OIDs.
const OID_SYS_DESCR: &[u32] = &[1, 3, 6, 1, 2, 1, 1, 1, 0];
const OID_DEVICE_STATUS: &[u32] = &[1, 3, 6, 1, 2, 1, 43, 5, 1, 1, 1, 1];
const OID_PAPER_LEVEL: &[u32] = &[1, 3, 6, 1, 2, 1, 43, 8, 2, 1, 10, 1, 1];

/// Supply OID templates (last component is supply index 1-4 for CMYK).
const OID_SUPPLY_NAME_PREFIX: &[u32] = &[1, 3, 6, 1, 2, 1, 43, 11, 1, 1, 6, 1];
const OID_SUPPLY_MAX_PREFIX: &[u32] = &[1, 3, 6, 1, 2, 1, 43, 11, 1, 1, 8, 1];
const OID_SUPPLY_LEVEL_PREFIX: &[u32] = &[1, 3, 6, 1, 2, 1, 43, 11, 1, 1, 9, 1];

/// Number of supply slots to poll (Canon C3226i: 4 = CMYK toner).
const SUPPLY_SLOTS: u32 = 4;

// ── Public API ──

/// Poll a printer via SNMP (async wrapper around blocking UDP).
///
/// Returns `None` if the printer is unreachable or all OID queries fail.
pub async fn poll_printer(ip: &str, community: &str, timeout_ms: u64) -> Option<SnmpPrinterData> {
    let ip = ip.to_string();
    let community = community.to_string();
    tokio::task::spawn_blocking(move || poll_printer_sync(&ip, &community, timeout_ms))
        .await
        .ok()
        .flatten()
}

/// Synchronous SNMP polling over raw UDP.
fn poll_printer_sync(ip: &str, community: &str, timeout_ms: u64) -> Option<SnmpPrinterData> {
    let addr = format!("{ip}:161");
    let timeout = Duration::from_millis(timeout_ms);

    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(e) => {
            warn!("Failed to bind UDP socket: {e}");
            return None;
        }
    };

    if let Err(e) = socket.set_read_timeout(Some(timeout)) {
        warn!("Failed to set socket timeout: {e}");
        return None;
    }

    if let Err(e) = socket.connect(&addr) {
        warn!(addr, "Failed to connect UDP to printer: {e}");
        return None;
    }

    let mut data = SnmpPrinterData::default();
    let mut request_id: u32 = 1;

    // sysDescr
    if let Some(val) = snmp_get_string(&socket, community, OID_SYS_DESCR, &mut request_id) {
        // Try to extract firmware version from sysDescr
        // Canon typically includes "Ver.X.XX" or similar
        if let Some(fw_pos) = val.to_lowercase().find("ver") {
            let fw_start = &val[fw_pos..];
            let fw_end = fw_start.find(';').unwrap_or(fw_start.len());
            data.firmware = fw_start[..fw_end].trim().to_string();
        }
        data.sys_descr = val;
    }

    // deviceStatus (hrDeviceStatus)
    if let Some(val) = snmp_get_integer(&socket, community, OID_DEVICE_STATUS, &mut request_id) {
        data.device_status = val as u32;
    }

    // Paper level
    if let Some(val) = snmp_get_integer(&socket, community, OID_PAPER_LEVEL, &mut request_id) {
        data.paper_level = Some(val);
    }

    // Supplies (4 slots for Canon CMYK)
    for slot in 1..=SUPPLY_SLOTS {
        let mut name_oid = OID_SUPPLY_NAME_PREFIX.to_vec();
        name_oid.push(slot);
        let mut max_oid = OID_SUPPLY_MAX_PREFIX.to_vec();
        max_oid.push(slot);
        let mut level_oid = OID_SUPPLY_LEVEL_PREFIX.to_vec();
        level_oid.push(slot);

        let name = snmp_get_string(&socket, community, &name_oid, &mut request_id)
            .unwrap_or_default();
        let max_capacity =
            snmp_get_integer(&socket, community, &max_oid, &mut request_id).unwrap_or(0);
        let current_level =
            snmp_get_integer(&socket, community, &level_oid, &mut request_id).unwrap_or(0);

        if !name.is_empty() {
            let color = detect_color(&name);
            data.supplies.push(SnmpSupply {
                name,
                max_capacity,
                current_level,
                color,
            });
        }
    }

    debug!(
        sys_descr = %data.sys_descr,
        status = data.device_status,
        supplies = data.supplies.len(),
        "SNMP poll completed"
    );

    Some(data)
}

// ── SNMP GET helpers ──

/// Send SNMP GET for an OID, return the string value.
fn snmp_get_string(
    socket: &UdpSocket,
    community: &str,
    oid: &[u32],
    request_id: &mut u32,
) -> Option<String> {
    let response = snmp_get_raw(socket, community, oid, request_id)?;
    extract_string_value(&response)
}

/// Send SNMP GET for an OID, return the integer value.
fn snmp_get_integer(
    socket: &UdpSocket,
    community: &str,
    oid: &[u32],
    request_id: &mut u32,
) -> Option<i32> {
    let response = snmp_get_raw(socket, community, oid, request_id)?;
    extract_integer_value(&response)
}

/// Send an SNMP v2c GET-Request and receive the raw response bytes.
fn snmp_get_raw(
    socket: &UdpSocket,
    community: &str,
    oid: &[u32],
    request_id: &mut u32,
) -> Option<Vec<u8>> {
    let id = *request_id;
    *request_id += 1;

    let packet = build_snmp_get_request(community, oid, id);

    if let Err(e) = socket.send(&packet) {
        debug!(?oid, "SNMP send failed: {e}");
        return None;
    }

    let mut buf = [0u8; 4096];
    match socket.recv(&mut buf) {
        Ok(n) => Some(buf[..n].to_vec()),
        Err(e) => {
            debug!(?oid, "SNMP recv failed: {e}");
            None
        }
    }
}

// ── ASN.1 BER encoding (SNMP v2c GET-Request) ──

/// Build a complete SNMP v2c GET-Request packet.
///
/// Structure:
/// ```text
/// SEQUENCE {
///   INTEGER version (1 = v2c)
///   OCTET STRING community
///   GetRequest-PDU [0] {
///     INTEGER request-id
///     INTEGER error-status (0)
///     INTEGER error-index (0)
///     SEQUENCE { SEQUENCE { OID, NULL } }
///   }
/// }
/// ```
fn build_snmp_get_request(community: &str, oid: &[u32], request_id: u32) -> Vec<u8> {
    // Encode OID
    let oid_bytes = encode_oid(oid);

    // VarBind: SEQUENCE { OID, NULL }
    let varbind = encode_sequence(&[&encode_oid_tlv(&oid_bytes), &[0x05, 0x00]]);

    // VarBindList: SEQUENCE { varbind }
    let varbind_list = encode_sequence(&[&varbind]);

    // PDU contents: request-id, error-status, error-index, varbind-list
    let pdu_contents = [
        encode_integer(request_id as i64).as_slice(),
        encode_integer(0).as_slice(), // error-status
        encode_integer(0).as_slice(), // error-index
        varbind_list.as_slice(),
    ]
    .concat();

    // GetRequest-PDU: context-specific [0] constructed
    let pdu = encode_tlv(0xA0, &pdu_contents);

    // Message: version, community, pdu
    let message_contents = [
        encode_integer(1).as_slice(), // v2c
        encode_octet_string(community.as_bytes()).as_slice(),
        pdu.as_slice(),
    ]
    .concat();

    // Top-level SEQUENCE
    encode_sequence(&[&message_contents])
}

/// Encode an OID value (just the value bytes, not the TLV).
fn encode_oid(oid: &[u32]) -> Vec<u8> {
    let mut bytes = Vec::new();
    if oid.len() < 2 {
        return bytes;
    }

    // First two components are encoded as 40*X + Y
    bytes.push((oid[0] * 40 + oid[1]) as u8);

    for &component in &oid[2..] {
        if component < 128 {
            bytes.push(component as u8);
        } else {
            // Multi-byte encoding for values >= 128
            let mut parts = Vec::new();
            let mut val = component;
            parts.push((val & 0x7F) as u8);
            val >>= 7;
            while val > 0 {
                parts.push((val & 0x7F) as u8 | 0x80);
                val >>= 7;
            }
            parts.reverse();
            bytes.extend(parts);
        }
    }

    bytes
}

/// Encode OID as full TLV (tag=0x06, length, value).
fn encode_oid_tlv(oid_bytes: &[u8]) -> Vec<u8> {
    encode_tlv(0x06, oid_bytes)
}

/// Encode an ASN.1 INTEGER.
fn encode_integer(val: i64) -> Vec<u8> {
    let mut bytes = Vec::new();

    if val == 0 {
        bytes.push(0);
    } else {
        let mut v = val;
        let negative = v < 0;
        let mut parts = Vec::new();

        if negative {
            // Two's complement for negative values
            while v < -1 || (!parts.is_empty() && parts.last().map_or(true, |&b: &u8| b & 0x80 == 0))
            {
                parts.push((v & 0xFF) as u8);
                v >>= 8;
                if parts.len() > 8 {
                    break;
                }
            }
            if parts.is_empty() {
                parts.push((v & 0xFF) as u8);
            }
        } else {
            while v > 0 {
                parts.push((v & 0xFF) as u8);
                v >>= 8;
            }
            // Add leading zero if high bit is set (would be interpreted as negative)
            if let Some(&last) = parts.last() {
                if last & 0x80 != 0 {
                    parts.push(0);
                }
            }
        }

        parts.reverse();
        bytes = parts;
    }

    encode_tlv(0x02, &bytes)
}

/// Encode an ASN.1 OCTET STRING.
fn encode_octet_string(data: &[u8]) -> Vec<u8> {
    encode_tlv(0x04, data)
}

/// Encode an ASN.1 SEQUENCE from concatenated encoded components.
fn encode_sequence(components: &[&[u8]]) -> Vec<u8> {
    let contents: Vec<u8> = components.iter().flat_map(|c| c.iter().copied()).collect();
    encode_tlv(0x30, &contents)
}

/// Encode a TLV (Tag, Length, Value) triplet.
fn encode_tlv(tag: u8, value: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(2 + value.len());
    result.push(tag);
    encode_length(value.len(), &mut result);
    result.extend_from_slice(value);
    result
}

/// Encode ASN.1 BER length.
fn encode_length(len: usize, out: &mut Vec<u8>) {
    if len < 128 {
        out.push(len as u8);
    } else if len < 256 {
        out.push(0x81);
        out.push(len as u8);
    } else {
        out.push(0x82);
        out.push((len >> 8) as u8);
        out.push((len & 0xFF) as u8);
    }
}

// ── ASN.1 BER decoding (SNMP response) ──

/// Decode ASN.1 BER length, return (length, bytes consumed).
fn decode_length(data: &[u8]) -> Option<(usize, usize)> {
    if data.is_empty() {
        return None;
    }

    let first = data[0];
    if first < 128 {
        Some((first as usize, 1))
    } else {
        let num_bytes = (first & 0x7F) as usize;
        if data.len() < 1 + num_bytes {
            return None;
        }
        let mut len = 0usize;
        for i in 0..num_bytes {
            len = (len << 8) | data[1 + i] as usize;
        }
        Some((len, 1 + num_bytes))
    }
}

/// Skip a TLV element, returning the value bytes and remaining data.
fn decode_tlv(data: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    if data.is_empty() {
        return None;
    }
    let tag = data[0];
    let (len, len_bytes) = decode_length(&data[1..])?;
    let value_start = 1 + len_bytes;
    let value_end = value_start + len;
    if data.len() < value_end {
        return None;
    }
    Some((tag, &data[value_start..value_end], &data[value_end..]))
}

/// Extract a string value from an SNMP GET-Response packet.
///
/// Navigates: SEQUENCE → skip version → skip community → PDU → skip req-id →
/// skip error-status → skip error-index → VarBindList → VarBind → value
fn extract_string_value(data: &[u8]) -> Option<String> {
    let value = navigate_to_varbind_value(data)?;
    // Value could be OCTET STRING (0x04) or any other printable type
    let (tag, val_bytes, _) = decode_tlv(value)?;
    if tag == 0x04 {
        Some(String::from_utf8_lossy(val_bytes).to_string())
    } else {
        None
    }
}

/// Extract an integer value from an SNMP GET-Response packet.
fn extract_integer_value(data: &[u8]) -> Option<i32> {
    let value = navigate_to_varbind_value(data)?;
    let (tag, val_bytes, _) = decode_tlv(value)?;
    if tag == 0x02 {
        // Decode BER integer
        let mut result: i32 = 0;
        for (i, &byte) in val_bytes.iter().enumerate() {
            if i == 0 && byte & 0x80 != 0 {
                result = -1; // sign extend
            }
            result = (result << 8) | byte as i32;
        }
        Some(result)
    } else if tag == 0x41 || tag == 0x42 || tag == 0x43 || tag == 0x46 {
        // Counter32, Gauge32, TimeTicks, Counter64 — treat as unsigned
        let mut result: i32 = 0;
        for &byte in val_bytes {
            result = (result << 8) | byte as i32;
        }
        Some(result)
    } else {
        None
    }
}

/// Navigate SNMP response to the varbind value bytes.
fn navigate_to_varbind_value(data: &[u8]) -> Option<&[u8]> {
    // Top-level SEQUENCE
    let (tag, content, _) = decode_tlv(data)?;
    if tag != 0x30 {
        return None;
    }

    // Skip version INTEGER
    let (_, _, rest) = decode_tlv(content)?;
    // Skip community OCTET STRING
    let (_, _, rest) = decode_tlv(rest)?;
    // PDU (GetResponse = 0xA2)
    let (tag, pdu_content, _) = decode_tlv(rest)?;
    if tag != 0xA2 {
        return None;
    }

    // Skip request-id
    let (_, _, rest) = decode_tlv(pdu_content)?;
    // Skip error-status
    let (_, _, rest) = decode_tlv(rest)?;
    // Skip error-index
    let (_, _, rest) = decode_tlv(rest)?;

    // VarBindList SEQUENCE
    let (_, vbl_content, _) = decode_tlv(rest)?;
    // First VarBind SEQUENCE
    let (_, vb_content, _) = decode_tlv(vbl_content)?;
    // Skip OID
    let (_, _, rest) = decode_tlv(vb_content)?;

    // Return pointer to the value TLV
    Some(rest)
}

// ── Utility ──

/// Detect toner color from supply description string.
///
/// Canon typically reports: "Black Toner", "Cyan Toner", "Magenta Toner", "Yellow Toner".
fn detect_color(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("black") || lower.contains("bk") || lower.contains("noir") {
        "black".into()
    } else if lower.contains("cyan") || lower.contains("cy") {
        "cyan".into()
    } else if lower.contains("magenta") || lower.contains("mg") {
        "magenta".into()
    } else if lower.contains("yellow") || lower.contains("yw") || lower.contains("jaune") {
        "yellow".into()
    } else {
        "unknown".into()
    }
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_oid_simple() {
        // .1.3.6.1.2.1.1.1.0 (sysDescr)
        let oid = &[1, 3, 6, 1, 2, 1, 1, 1, 0];
        let encoded = encode_oid(oid);
        // 1*40 + 3 = 43 = 0x2B, then 6, 1, 2, 1, 1, 1, 0
        assert_eq!(encoded, vec![0x2B, 6, 1, 2, 1, 1, 1, 0]);
    }

    #[test]
    fn test_encode_oid_large_component() {
        // .1.3.6.1.2.1.43.11.1.1.6.1.1 (supply name, slot 1)
        let oid = &[1, 3, 6, 1, 2, 1, 43, 11, 1, 1, 6, 1, 1];
        let encoded = encode_oid(oid);
        // 43 = 0x2B (value >= 128 is not needed since 43 < 128)
        assert_eq!(encoded[0], 0x2B); // 1*40+3
        assert_eq!(encoded[1], 6);
        assert_eq!(encoded[5], 43); // component 43 < 128, single byte
    }

    #[test]
    fn test_encode_oid_multibyte_component() {
        // Test component 128 which requires multi-byte encoding
        let oid = &[1, 3, 6, 1, 128];
        let encoded = encode_oid(oid);
        assert_eq!(encoded[0], 0x2B);
        // 128 = 0x80 → encoded as [0x81, 0x00]
        assert_eq!(encoded[3], 0x81);
        assert_eq!(encoded[4], 0x00);
    }

    #[test]
    fn test_encode_integer_zero() {
        let encoded = encode_integer(0);
        assert_eq!(encoded, vec![0x02, 0x01, 0x00]);
    }

    #[test]
    fn test_encode_integer_small() {
        let encoded = encode_integer(1);
        assert_eq!(encoded, vec![0x02, 0x01, 0x01]);
    }

    #[test]
    fn test_encode_integer_larger() {
        let encoded = encode_integer(256);
        assert_eq!(encoded, vec![0x02, 0x02, 0x01, 0x00]);
    }

    #[test]
    fn test_encode_length_short() {
        let mut out = Vec::new();
        encode_length(10, &mut out);
        assert_eq!(out, vec![10]);
    }

    #[test]
    fn test_encode_length_medium() {
        let mut out = Vec::new();
        encode_length(200, &mut out);
        assert_eq!(out, vec![0x81, 200]);
    }

    #[test]
    fn test_decode_tlv_basic() {
        let data = [0x02, 0x01, 0x05, 0xFF]; // INTEGER 5, trailing byte
        let (tag, value, rest) = decode_tlv(&data).unwrap();
        assert_eq!(tag, 0x02);
        assert_eq!(value, &[0x05]);
        assert_eq!(rest, &[0xFF]);
    }

    #[test]
    fn test_detect_color() {
        assert_eq!(detect_color("Black Toner"), "black");
        assert_eq!(detect_color("Cyan Toner"), "cyan");
        assert_eq!(detect_color("Magenta Toner"), "magenta");
        assert_eq!(detect_color("Yellow Toner"), "yellow");
        assert_eq!(detect_color("Drum Unit"), "unknown");
    }

    #[test]
    fn test_build_snmp_get_request_not_empty() {
        let packet = build_snmp_get_request("public", OID_SYS_DESCR, 1);
        assert!(!packet.is_empty());
        // Should start with SEQUENCE tag
        assert_eq!(packet[0], 0x30);
    }

    #[test]
    fn test_roundtrip_encode_decode_tlv() {
        let original_value = b"hello";
        let encoded = encode_tlv(0x04, original_value);
        let (tag, value, rest) = decode_tlv(&encoded).unwrap();
        assert_eq!(tag, 0x04);
        assert_eq!(value, original_value);
        assert!(rest.is_empty());
    }
}
