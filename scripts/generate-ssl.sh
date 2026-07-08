#!/bin/bash
# generate-ssl.sh — 生成自签名证书用于 HTTPS 测试
# 浏览器会提示证书不安全，点击"高级"→"继续前往"即可

CERT_DIR="$(dirname "$0")/../nginx/ssl"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/nginx.crt" ] && [ -f "$CERT_DIR/nginx.key" ]; then
    echo "[SSL] Certificate already exists at $CERT_DIR"
    exit 0
fi

echo "[SSL] Generating self-signed certificate..."
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$CERT_DIR/nginx.key" \
    -out "$CERT_DIR/nginx.crt" \
    -subj "/C=CN/ST=Beijing/L=Beijing/O=RANtern/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:192.168.100.10,IP:127.0.0.1"

echo "[SSL] Done. Files:"
echo "  $CERT_DIR/nginx.crt"
echo "  $CERT_DIR/nginx.key"
echo ""
echo "[SSL] Run: docker compose up --build"
echo "[SSL] Then open https://192.168.100.10/ (accept the certificate warning)"