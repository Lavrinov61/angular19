#!/usr/bin/env bash
# Генерирует подвал листа «Комплект на документы»: логотип + городской телефон + адреса.
# Встраивается в print-api (src/cups/pipeline.rs → DOCUMENT_SET_FOOTER_BYTES).
# Запуск: bash print-api/scripts/gen-document-set-footer.sh
set -euo pipefail
cd "$(dirname "$0")/../.."   # → angular-dev
F=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
FB=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
OUT=src/assets/images/document-set-footer.png
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

convert src/assets/images/svoefoto-logo-black.png -background none -resize x340 "$TMP/logo.png"
convert -background none -fill '#1a1a1a' -font "$FB" -pointsize 92 \
  label:'svoefoto.ru     +7 (863) 322-65-75' "$TMP/line1.png"
convert -background none -fill '#444444' -font "$F" -pointsize 76 \
  label:'Соборный 21      2-я Баррикадная 4' "$TMP/line2.png"
convert -background none -gravity Center "$TMP/line1.png" -splice 0x28 "$TMP/line2.png" -append "$TMP/text.png"
convert -size 10x300 xc:'#f59e0b' "$TMP/sep.png"
convert -size 110x10 xc:none "$TMP/gap.png"
convert "$TMP/logo.png" "$TMP/gap.png" "$TMP/sep.png" "$TMP/gap.png" "$TMP/text.png" \
  -background none -gravity Center +append "$TMP/row.png"
convert "$TMP/row.png" -background none -gravity Center -bordercolor none -border 60 "$OUT"
identify "$OUT"
