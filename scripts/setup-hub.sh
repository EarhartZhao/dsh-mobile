#!/usr/bin/env bash
# Phase 0 Hub-side setup for dsh-mobile (one-shot, idempotent).
#
# Runs ON the Hub (Ubuntu, nats-server via systemd). Expects the TLS material
# next to this script: server.crt + server.key (generated on an admin machine
# by certs generation, see docs; ca.key must NEVER touch the server).
#
#   scp server.crt server.key setup-hub.sh root@115.159.57.137:/root/dsh-mobile-setup/
#   ssh root@115.159.57.137 'bash /root/dsh-mobile-setup/setup-hub.sh'
#
# Afterwards, in Tencent Cloud console: open inbound TCP 8443. The script
# prints the c-end-dsh password once — store it in the dsh plugin's
# mobile-bridge settings card (it is handed to phones via the pairing QR).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONF=/etc/nats/hub.conf
TLSDIR=/etc/nats/tls

echo "==> 1/5 install TLS material"
install -d -m 700 "$TLSDIR"
install -m 600 "$HERE/server.crt" "$TLSDIR/server.crt"
install -m 600 "$HERE/server.key" "$TLSDIR/server.key"

echo "==> 2/5 websocket listener (wss :8443, native TLS)"
if grep -q '^websocket' "$CONF"; then
  echo "    already present, skipping"
else
  cp -a "$CONF" "$CONF.bak.$(date +%s)"
  cat >> "$CONF" <<'EOF'

websocket {
    listen: 0.0.0.0:8443
    tls {
        cert_file: "/etc/nats/tls/server.crt"
        key_file:  "/etc/nats/tls/server.key"
    }
}
EOF
fi

echo "==> 3/5 add c-end-dsh account"
if grep -q 'user: c-end-dsh' "$CONF"; then
  echo "    already present, skipping (password NOT re-printed; reset manually if lost)"
  CEND_PASS=""
else
  CEND_PASS="$(openssl rand -hex 16)"
  # Insert the new user just before the closing ']' of the TOP-LEVEL
  # authorization block (column 0) — the leafnodes block is indented and
  # therefore never matches these anchors.
  awk -v pass="$CEND_PASS" '
    /^authorization[ \t]*\{/ { inauth = 1 }
    inauth && /^  \][ \t]*$/ && !done {
      print "    {"
      print "      user: c-end-dsh, password: " pass
      print "      permissions = {"
      print "        publish = [\"svc.dsh.>\", \"_INBOX.>\"]"
      print "        subscribe = [\"evt.dsh.>\", \"_INBOX.>\"]"
      print "      }"
      print "    }"
      done = 1
    }
    /^}/ { inauth = 0 }
    { print }
  ' "$CONF" > "$CONF.new"
  grep -q 'user: c-end-dsh' "$CONF.new" || { echo "    ERROR: insert anchor not found; aborting (conf untouched)"; rm -f "$CONF.new"; exit 1; }
  # Validate the edited config before it goes live.
  nats-server -t -c "$CONF.new"
  mv "$CONF.new" "$CONF"
fi

echo "==> 4/5 validate + restart"
systemctl restart nats
sleep 1
systemctl is-active --quiet nats && echo "    nats active"

echo "==> 5/5 verify wss handshake"
echo | openssl s_client -connect 127.0.0.1:8443 -verify_return_error 2>/dev/null | grep -q 'Verify return code: 0' \
  && echo "    TLS OK (self-signed chain: expected 18/19 without CAfile on other hosts)" \
  || echo "    note: run 'openssl s_client -connect 127.0.0.1:8443 -CAfile <ca.crt>' for full-chain verification"

if [ -n "${CEND_PASS:-}" ]; then
  echo ""
  echo "=================================================="
  echo " c-end-dsh password (shown once): $CEND_PASS"
  echo "=================================================="
fi
echo "Done. Remaining manual step: open inbound TCP 8443 in the Tencent Cloud security group."
