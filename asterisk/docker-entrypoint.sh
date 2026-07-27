#!/bin/sh
set -e

ASTERISK_WS_PORT="${ASTERISK_WS_PORT:-8089}"
ASTERISK_EXTERNAL_IP="${ASTERISK_EXTERNAL_IP:-${PUBLIC_HOST:-127.0.0.1}}"
if [ -z "$ASTERISK_EXTERNAL_IP" ]; then
  ASTERISK_EXTERNAL_IP="127.0.0.1"
fi
export ASTERISK_EXTERNAL_IP ASTERISK_WS_PORT
echo "[asterisk] ASTERISK_EXTERNAL_IP=${ASTERISK_EXTERNAL_IP} ASTERISK_WS_PORT=${ASTERISK_WS_PORT}"

strip_crlf() {
  tr -d '\r'
}

AST_BIN="/usr/sbin/asterisk"
[ -x "$AST_BIN" ] || AST_BIN="asterisk"

mkdir -p /var/run/asterisk /var/log/asterisk /var/lib/asterisk 2>/dev/null || true
chmod 755 /var/lib/asterisk 2>/dev/null || true

PJSIP_DIR="/etc/asterisk"
HTTP_OUTPUT="${PJSIP_DIR}/http.conf"

rm -f \
  "${PJSIP_DIR}/pjsip.conf" \
  "${PJSIP_DIR}/pjsip_wizard.conf" \
  "${PJSIP_DIR}/pjsip.global.conf" \
  "${PJSIP_DIR}/pjsip.transport.conf" \
  "${PJSIP_DIR}/pjsip.auth.conf" \
  "${PJSIP_DIR}/pjsip.aor.conf" \
  "${PJSIP_DIR}/pjsip.endpoint.conf" \
  "${PJSIP_DIR}/pjsip.domain.conf" \
  "${PJSIP_DIR}/pjsip.identify.conf" \
  "${PJSIP_DIR}/pjsip.registration.conf" \
  2>/dev/null || true

for conf in extconfig.conf extensions.conf rtp.conf modules.conf; do
  src="${PJSIP_DIR}/${conf}"
  if [ -f "$src" ]; then
    strip_crlf < "$src" > "/tmp/${conf}"
    mv "/tmp/${conf}" "$src"
  fi
done

# Always write sorcery at runtime — baked image may still have default contact=config,pjsip.conf.
generate_sorcery_conf() {
  cat > "${PJSIP_DIR}/sorcery.conf" <<'EOF'
; Generated at container start — maps split pjsip.*.conf files (see docker-entrypoint.sh).
[res_pjsip]
global=config,pjsip.global.conf
transport=config,pjsip.transport.conf
auth=config,pjsip.auth.conf
aor=config,pjsip.aor.conf
endpoint=config,pjsip.endpoint.conf
domain_alias=config,pjsip.domain.conf
identify=config,pjsip.identify.conf
registration=config,pjsip.registration.conf
contact=memory
EOF
  strip_crlf < "${PJSIP_DIR}/sorcery.conf" > /tmp/sorcery.conf
  mv /tmp/sorcery.conf "${PJSIP_DIR}/sorcery.conf"
}

# Split PJSIP into separate files so [1001] type=aor and [1001] type=endpoint do not merge.
generate_pjsip_configs() {
  cat > "${PJSIP_DIR}/pjsip.global.conf" <<EOF
[global]
type=global
endpoint_identifier_order=auth_username,username
default_realm=${ASTERISK_EXTERNAL_IP}
dtls_auto_generate_cert=yes
send_contact_status_on_update_registration=yes
contact_expiration_check_interval=30
EOF

  cat > "${PJSIP_DIR}/pjsip.transport.conf" <<EOF
[transport-wss]
type=transport
protocol=ws
bind=0.0.0.0:${ASTERISK_WS_PORT}
external_signaling_address=${ASTERISK_EXTERNAL_IP}
external_media_address=${ASTERISK_EXTERNAL_IP}
local_net=10.0.0.0/8
local_net=172.16.0.0/12
local_net=192.168.0.0/16
EOF

  cat > "${PJSIP_DIR}/pjsip.auth.conf" <<EOF
[1001-auth]
type=auth
auth_type=userpass
username=1001
password=1001
realm=${ASTERISK_EXTERNAL_IP}

[1002-auth]
type=auth
auth_type=userpass
username=1002
password=1002
realm=${ASTERISK_EXTERNAL_IP}
EOF

  cat > "${PJSIP_DIR}/pjsip.aor.conf" <<EOF
[1001]
type=aor
max_contacts=1
remove_existing=yes
qualify_frequency=0
support_path=no

[1002]
type=aor
max_contacts=1
remove_existing=yes
qualify_frequency=0
support_path=no
EOF

  cat > "${PJSIP_DIR}/pjsip.endpoint.conf" <<EOF
[1001]
type=endpoint
transport=transport-wss
context=internal
aors=1001
auth=1001-auth
from_user=1001
from_domain=${ASTERISK_EXTERNAL_IP}
disallow=all
allow=opus,ulaw,alaw
webrtc=yes
media_encryption=dtls
dtls_verify=fingerprint
dtls_setup=actpass
ice_support=yes
media_use_received_transport=yes
rtcp_mux=yes
use_avpf=yes
identify_by=auth_username,username
force_rport=yes
rewrite_contact=yes
rtp_symmetric=yes
direct_media=no
send_pai=yes
trust_id_inbound=yes
trust_id_outbound=yes
outgoing_call_offer_pref=local
incoming_call_offer_pref=local
follow_early_media_fork=yes

[1002]
type=endpoint
transport=transport-wss
context=internal
aors=1002
auth=1002-auth
from_user=1002
from_domain=${ASTERISK_EXTERNAL_IP}
disallow=all
allow=opus,ulaw,alaw
webrtc=yes
media_encryption=dtls
dtls_verify=fingerprint
dtls_setup=actpass
ice_support=yes
media_use_received_transport=yes
rtcp_mux=yes
use_avpf=yes
identify_by=auth_username,username
force_rport=yes
rewrite_contact=yes
rtp_symmetric=yes
direct_media=no
send_pai=yes
trust_id_inbound=yes
trust_id_outbound=yes
outgoing_call_offer_pref=local
incoming_call_offer_pref=local
follow_early_media_fork=yes
EOF

  cat > "${PJSIP_DIR}/pjsip.domain.conf" <<EOF
[${ASTERISK_EXTERNAL_IP}]
type=domain
domains=${ASTERISK_EXTERNAL_IP}
EOF
  : > "${PJSIP_DIR}/pjsip.identify.conf"
  : > "${PJSIP_DIR}/pjsip.registration.conf"

  for f in pjsip.global.conf pjsip.transport.conf pjsip.auth.conf pjsip.aor.conf pjsip.endpoint.conf pjsip.domain.conf pjsip.identify.conf pjsip.registration.conf; do
    strip_crlf < "${PJSIP_DIR}/${f}" > "/tmp/${f}"
    mv "/tmp/${f}" "${PJSIP_DIR}/${f}"
  done
}

generate_extensions_conf() {
  cat > "${PJSIP_DIR}/extensions.conf" <<'EOF'
[internal]

; r = only send 180 to caller when callee endpoint is actually ringing (not fake early ring).
exten => _10XX,1,NoOp(Call ${EXTEN} from ${CALLERID(num)})
 same => n,Dial(PJSIP/${EXTEN}@${EXTEN},30,r)
 same => n,Hangup()
EOF
  strip_crlf < "${PJSIP_DIR}/extensions.conf" > /tmp/extensions.conf
  mv /tmp/extensions.conf "${PJSIP_DIR}/extensions.conf"
}

generate_tls_certs() {
  TLS_DIR="/etc/asterisk/keys"
  mkdir -p "$TLS_DIR"
  if [ ! -f "$TLS_DIR/asterisk.crt" ] && command -v openssl >/dev/null 2>&1; then
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout "$TLS_DIR/asterisk.key" \
      -out "$TLS_DIR/asterisk.crt" \
      -subj "/CN=${ASTERISK_EXTERNAL_IP}"
    chmod 640 "$TLS_DIR/asterisk.key" "$TLS_DIR/asterisk.crt" 2>/dev/null || true
    chown asterisk:asterisk "$TLS_DIR" "$TLS_DIR"/* 2>/dev/null || true
    echo "[asterisk] TLS cert for WSS (CN=${ASTERISK_EXTERNAL_IP})"
  fi
}

generate_http_conf() {
  TLS_DIR="/etc/asterisk/keys"
  if [ -f "$TLS_DIR/asterisk.crt" ] && [ -f "$TLS_DIR/asterisk.key" ]; then
    cat > "$HTTP_OUTPUT" <<EOF
[general]
servername=Asterisk
enabled=yes
bindaddr=0.0.0.0
bindport=${ASTERISK_WS_PORT}
tlsenable=yes
tlscertfile=${TLS_DIR}/asterisk.crt
tlsprivatekey=${TLS_DIR}/asterisk.key
enable_status=yes

[websocket]
enabled=yes
EOF
    echo "[asterisk] SIP WebSocket TLS on :${ASTERISK_WS_PORT} — use wss:// (ws:// auto-upgrades from HTTPS page)"
  else
    cat > "$HTTP_OUTPUT" <<EOF
[general]
servername=Asterisk
enabled=yes
bindaddr=0.0.0.0
bindport=${ASTERISK_WS_PORT}
tlsenable=no
enable_status=yes

[websocket]
enabled=yes
EOF
    echo "[asterisk] SIP WebSocket plain ws:// on :${ASTERISK_WS_PORT}"
  fi
  strip_crlf < "$HTTP_OUTPUT" > /tmp/http.conf
  mv /tmp/http.conf "$HTTP_OUTPUT"
}

validate_config_files() {
  ok=1
  if ! grep -q '^aor=config,pjsip.aor.conf' "${PJSIP_DIR}/sorcery.conf" 2>/dev/null; then
    echo "[asterisk] FATAL: sorcery.conf missing aor=config,pjsip.aor.conf"
    ok=0
  fi
  if ! grep -q '^contact=memory' "${PJSIP_DIR}/sorcery.conf" 2>/dev/null; then
    echo "[asterisk] FATAL: sorcery.conf must use contact=memory (not contact=config,pjsip.conf)"
    ok=0
  fi
  if ! grep -q '^\[1001\]' "${PJSIP_DIR}/pjsip.aor.conf" 2>/dev/null; then
    echo "[asterisk] FATAL: pjsip.aor.conf missing [1001]"
    ok=0
  fi
  if ! grep -q '^aors=1001$' "${PJSIP_DIR}/pjsip.endpoint.conf" 2>/dev/null; then
    echo "[asterisk] FATAL: pjsip.endpoint.conf must have aors=1001"
    ok=0
  fi
  if [ "$ok" -eq 0 ]; then
    echo "[asterisk] --- sorcery.conf ---"
    cat "${PJSIP_DIR}/sorcery.conf" 2>/dev/null || true
    exit 1
  fi
  echo "[asterisk] sorcery OK (split files + contact=memory)"
}

verify_pjsip_runtime() {
  AOR_OUT="$("$AST_BIN" -rx "pjsip show aor 1001" 2>&1)" || AOR_OUT=""
  EP_OUT="$("$AST_BIN" -rx "pjsip show endpoint 1001" 2>&1)" || EP_OUT=""
  TP_OUT="$("$AST_BIN" -rx "pjsip show transport transport-wss" 2>&1)" || TP_OUT=""
  MEM_OUT="$("$AST_BIN" -rx "module show like sorcery_memory" 2>&1)" || MEM_OUT=""
  WS_OUT="$("$AST_BIN" -rx "module show like websocket" 2>&1)" || WS_OUT=""
  CHAN_OUT="$("$AST_BIN" -rx "module show like chan_sip" 2>&1)" || CHAN_OUT=""

  echo "[asterisk] sorcery contact backend:"
  grep '^contact=' "${PJSIP_DIR}/sorcery.conf" 2>/dev/null || true
  echo "[asterisk] endpoint aors line:"
  grep '^aors=' "${PJSIP_DIR}/pjsip.endpoint.conf" 2>/dev/null | head -1 || true

  ok=1
  if printf '%s' "$AOR_OUT" | grep -qi 'Unable to find'; then
    echo "[asterisk] FATAL: AOR 1001 not loaded"
    ok=0
  fi
  if printf '%s' "$EP_OUT" | grep -qi 'Unable to find'; then
    echo "[asterisk] FATAL: endpoint 1001 not loaded"
    ok=0
  fi
  if printf '%s' "$EP_OUT" | grep -q 'aors: 1001-aor'; then
    echo "[asterisk] FATAL: stale endpoint still references aors=1001-aor"
    ok=0
  fi
  if printf '%s' "$TP_OUT" | grep -qi 'Unable to find'; then
    echo "[asterisk] FATAL: transport-wss not loaded"
    ok=0
  fi
  if ! printf '%s' "$MEM_OUT" | grep -q 'res_sorcery_memory.so'; then
    echo "[asterisk] FATAL: res_sorcery_memory not loaded (contacts cannot bind)"
    ok=0
  fi
  if ! printf '%s' "$WS_OUT" | grep -q 'res_pjsip_transport_websocket.so'; then
    echo "[asterisk] FATAL: res_pjsip_transport_websocket not loaded"
    ok=0
  fi
  if printf '%s' "$CHAN_OUT" | grep -q '1 modules loaded'; then
    echo "[asterisk] FATAL: chan_sip loaded"
    ok=0
  fi

  if [ "$ok" -eq 0 ]; then
    echo "[asterisk] --- sorcery.conf ---"
    cat "${PJSIP_DIR}/sorcery.conf" 2>/dev/null || true
    echo "[asterisk] --- pjsip.aor.conf ---"
    cat "${PJSIP_DIR}/pjsip.aor.conf" 2>/dev/null || true
    echo "[asterisk] --- pjsip.endpoint.conf ---"
    cat "${PJSIP_DIR}/pjsip.endpoint.conf" 2>/dev/null || true
    "$AST_BIN" -rx "pjsip show aors" 2>&1 || true
    "$AST_BIN" -rx "pjsip show endpoints" 2>&1 || true
    return 1
  fi

  DIAL_OUT="$("$AST_BIN" -rx "dialplan show internal" 2>&1)" || DIAL_OUT=""
  if ! printf '%s' "$DIAL_OUT" | grep -q '_10XX'; then
    echo "[asterisk] FATAL: dialplan must use _10XX pattern (got stale per-extension Dial?)"
    ok=0
  fi
  if ! printf '%s' "$DIAL_OUT" | grep -q 'Dial(PJSIP/\${EXTEN}@\${EXTEN}'; then
    echo "[asterisk] FATAL: dialplan must Dial(PJSIP/\${EXTEN}@\${EXTEN},30,r)"
    ok=0
  fi

  if [ "$ok" -eq 0 ]; then
    echo "[asterisk] --- extensions.conf ---"
    cat "${PJSIP_DIR}/extensions.conf" 2>/dev/null || true
    return 1
  fi

  echo "[asterisk] PJSIP ready — AOR 1001 + endpoint 1001 + transport-wss + contact=memory + dialplan _10XX"
  return 0
}

generate_sorcery_conf
generate_pjsip_configs
generate_extensions_conf
generate_tls_certs
generate_http_conf
validate_config_files

echo "[asterisk] starting Asterisk..."
"$AST_BIN" -f -vvvg -c &
ASTERISK_PID=$!

cli_ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if "$AST_BIN" -rx "core show uptime" 2>/dev/null | grep -qi uptime; then
    cli_ready=1
    break
  fi
  sleep 2
done

if [ "$cli_ready" -ne 1 ]; then
  echo "[asterisk] FATAL: Asterisk CLI not ready within 30s"
  kill "$ASTERISK_PID" 2>/dev/null || true
  exit 1
fi

sleep 2

if ! verify_pjsip_runtime; then
  echo "[asterisk] FATAL: PJSIP not ready"
  kill "$ASTERISK_PID" 2>/dev/null || true
  wait "$ASTERISK_PID" 2>/dev/null || true
  exit 1
fi

wait "$ASTERISK_PID"
exit $?
