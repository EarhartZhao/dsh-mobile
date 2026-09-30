#!/usr/bin/env bash
#
# Mint fresh Hub TLS material after the private CA key or the Hub server key has
# to be treated as compromised (see dsh-mobile-plugin/docs/02 §1.1).
#
#   scripts/rotate-hub-tls.sh                 # mint material, print the runbook
#   scripts/rotate-hub-tls.sh --apply         # also re-pin the public CA in this repo
#
# The pair this replaces is used by nats-server, not by the app:
#
#   ca.key      the trust root's private key — offline only, never on the Hub
#   ca.crt      the trust root (public) — bundled into the app on both platforms
#   server.key  the Hub's TLS identity (public half: server.crt) — /etc/nats/tls on the Hub
#
# Only the public halves ever enter this repository. The private keys are written
# outside the checkout (default `~/.dsh-mobile-hub-tls`) and the script refuses
# to target a path inside it.
#
# `--apply` changes the CA this repository ships as its fallback; run it after the
# Hub is already serving the new cert. Phones pick the new CA up by re-scanning a
# QR that carries it, so no rebuild is needed for them to reconnect.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HUB_IP="115.159.57.137"
CA_DAYS=3650
SERVER_DAYS=825
OUT_DIR="${HOME}/.dsh-mobile-hub-tls"
APPLY=0
FORCE=0
# Suffix appended to the SAN list, e.g. ",DNS:hub.example" — kept as a string
# because macOS ships bash 3.2, where `"${arr[@]}"` on an empty array trips
# `set -u`.
EXTRA_SANS=""

usage() {
  sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Options:
  --hub-ip <ip>        Hub address for the certificate SAN (default 115.159.57.137)
  --extra-san <name>   Extra SAN entry, repeatable. Prefix with DNS: or IP: yourself,
                       or give a bare value and it is treated as an IP
  --ca-days <n>        CA lifetime in days (default 3650)
  --server-days <n>    Server certificate lifetime in days (default 825)
  --out <dir>          Where the material is written (default ~/.dsh-mobile-hub-tls)
  --apply              Copy the public halves into this repository
  --force              Overwrite existing material in --out
  -h, --help           This text
EOF
}

die() { echo "error: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --hub-ip)      [ $# -ge 2 ] || die "--hub-ip needs a value"; HUB_IP="$2"; shift 2 ;;
    --extra-san)
      [ $# -ge 2 ] || die "--extra-san needs a value"
      case "$2" in
        DNS:*|IP:*) EXTRA_SANS="${EXTRA_SANS},$2" ;;
        *)          EXTRA_SANS="${EXTRA_SANS},IP:$2" ;;
      esac
      shift 2 ;;
    --ca-days)     [ $# -ge 2 ] || die "--ca-days needs a value"; CA_DAYS="$2"; shift 2 ;;
    --server-days) [ $# -ge 2 ] || die "--server-days needs a value"; SERVER_DAYS="$2"; shift 2 ;;
    --out)         [ $# -ge 2 ] || die "--out needs a value"; OUT_DIR="$2"; shift 2 ;;
    --apply)       APPLY=1; shift ;;
    --force)       FORCE=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             die "unknown option: $1 (try --help)" ;;
  esac
done

command -v openssl >/dev/null || die "openssl not found"

# Resolve to an absolute path before the containment check so a relative --out
# that climbs into the checkout is still caught.
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd -P)"
case "${OUT_DIR}/" in
  "${REPO_ROOT}/"*) die "--out must be outside the repository (got $OUT_DIR)" ;;
esac

CA_KEY="$OUT_DIR/ca.key"
CA_CRT="$OUT_DIR/ca.crt"
SERVER_KEY="$OUT_DIR/server.key"
SERVER_CSR="$OUT_DIR/server.csr"
SERVER_CRT="$OUT_DIR/server.crt"
CA_FP_FILE="$OUT_DIR/ca-fingerprint.txt"

if [ -e "$CA_KEY" ] && [ "$FORCE" -ne 1 ]; then
  echo "note: material already exists in $OUT_DIR (use --force to replace it)"
else
  # The Hub is reached by IP, so an IP SAN is the load-bearing entry; a DNS
  # entry is only added when the caller asks for one.
  SAN_ENTRIES="IP:${HUB_IP}${EXTRA_SANS}"

  echo "==> minting a new CA (${CA_DAYS}d) and server certificate (${SERVER_DAYS}d) for ${HUB_IP}"
  mkdir -p "$OUT_DIR"
  chmod 700 "$OUT_DIR"
  umask 077

  # macOS ships LibreSSL, whose `req` has no usable -addext, so extensions come
  # from config files. `critical` on the CA's basicConstraints is what stops the
  # leaf from being usable as an intermediate.
  cat > "$OUT_DIR/ca.cnf" <<'EOF'
[req]
prompt = no
distinguished_name = dn
x509_extensions = ca_ext
[dn]
CN = dsh-mobile-root-ca
[ca_ext]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF

  # `ec_param_enc:named_curve` is load-bearing on macOS. LibreSSL's default is
  # to encode the curve parameters explicitly, and Go — which is what
  # nats-server is written in — refuses to read such a key at all
  # ("invalid ECDSA parameters"), so the Hub would fail to start on restart.
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -pkeyopt ec_param_enc:named_curve -nodes -sha256 \
    -days "$CA_DAYS" -config "$OUT_DIR/ca.cnf" \
    -keyout "$CA_KEY" -out "$CA_CRT" >/dev/null 2>&1

  # extendedKeyUsage=serverAuth is the piece the old certificate was missing —
  # without it Apple's SSL policy rejects the chain with -67609 and iOS had to
  # fall back to a hand-rolled check.
  cat > "$OUT_DIR/leaf.ext" <<EOF
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = ${SAN_ENTRIES}
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EOF

  # Keep a bare SAN file too: it is what dsh-mobile-plugin/docs/02 tells a
  # human to edit when they re-sign by hand.
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$SAN_ENTRIES" > "$OUT_DIR/san.ext"

  openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
    -pkeyopt ec_param_enc:named_curve -nodes \
    -subj "/CN=${HUB_IP}" -keyout "$SERVER_KEY" -out "$SERVER_CSR" >/dev/null 2>&1

  openssl x509 -req -in "$SERVER_CSR" -CA "$CA_CRT" -CAkey "$CA_KEY" \
    -CAcreateserial -days "$SERVER_DAYS" -extfile "$OUT_DIR/leaf.ext" -sha256 \
    -out "$SERVER_CRT" >/dev/null 2>&1

  chmod 600 "$CA_KEY" "$SERVER_KEY"
  chmod 644 "$CA_CRT" "$SERVER_CRT" "$SERVER_CSR" "$OUT_DIR/leaf.ext" "$OUT_DIR/san.ext"
fi

# --- self-check: the material has to be usable before it goes anywhere --------
openssl verify -CAfile "$CA_CRT" "$SERVER_CRT" >/dev/null \
  || die "new server certificate does not verify against the new CA"
openssl x509 -in "$SERVER_CRT" -noout -text | grep -q "IP Address:${HUB_IP}" \
  || die "new server certificate does not cover ${HUB_IP}"
openssl x509 -in "$SERVER_CRT" -noout -text | grep -q "TLS Web Server Authentication" \
  || die "new server certificate is missing extendedKeyUsage=serverAuth"

# LibreSSL's `openssl x509 -req` still signs with SHA-1 unless told otherwise,
# and iOS refuses a SHA-1 chain outright ("Signature hash algorithm is not
# permitted for this use"). `-sha256` above is the fix; this is the check that
# it took effect.
for crt in "$CA_CRT" "$SERVER_CRT"; do
  openssl x509 -in "$crt" -noout -text | grep -m1 "Signature Algorithm" | grep -q "SHA256" \
    || die "$crt is not signed with SHA-256; iOS will refuse it"
done

# nats-server is Go, and Go cannot read an EC key whose curve is written out as
# explicit parameters instead of the named-curve OID — which is exactly what
# LibreSSL produces by default. Catching it here costs one parse; catching it at
# the Hub costs a server that will not restart.
for key in "$CA_KEY" "$SERVER_KEY"; do
  openssl pkey -in "$key" -outform DER -out "$OUT_DIR/key-check.der" 2>/dev/null \
    || die "$key is not a readable private key"
  openssl asn1parse -inform DER -in "$OUT_DIR/key-check.der" | grep -q "prime256v1" \
    || die "$key encodes its curve as explicit parameters; nats-server will refuse it"
done
rm -f "$OUT_DIR/key-check.der"

CA_FP="$(openssl x509 -in "$CA_CRT" -noout -fingerprint -sha256 \
  | sed 's/^.*=//' | tr '[:lower:]' '[:upper:]')"
printf '%s\n' "$CA_FP" > "$CA_FP_FILE"

if [ "$APPLY" -eq 1 ]; then
  echo "==> re-pinning the public CA in ${REPO_ROOT}"
  cp "$CA_CRT" "$REPO_ROOT/certs/ca.crt"
  cp "$CA_CRT" "$REPO_ROOT/apps/mobile/android/app/src/main/res/raw/dsh_root_ca.crt"
  cp "$CA_CRT" "$REPO_ROOT/apps/mobile/ios/DshMobile/dsh_root_ca.crt"
  # Public record of what was deployed; also refresh the signing request so the
  # tracked copy cannot be mistaken for the live one later.
  cp "$SERVER_CRT" "$REPO_ROOT/certs/server.crt"
  cp "$SERVER_CSR" "$REPO_ROOT/certs/server.csr"
  cp "$OUT_DIR/san.ext" "$REPO_ROOT/certs/san.ext"
  # The serial counter is signing state, not material to publish.
  rm -f "$REPO_ROOT/certs/ca.srl"
  echo "    updated certs/ca.crt, both dsh_root_ca.crt copies, certs/server.{crt,csr}, certs/san.ext"
  echo "    removed certs/ca.srl (signing state; git rm it if it is tracked)"
fi

cat <<EOF

==> material written to ${OUT_DIR}
    ca.key       $( [ -f "$CA_KEY" ] && echo present )   <- keep offline, never commit, never copy to the Hub
    server.key   $( [ -f "$SERVER_KEY" ] && echo present )   <- goes to the Hub only

==> new CA fingerprint (compare it against the hint under the card's CA field)
    ${CA_FP}

Next:

  1. Install the new identity on the Hub (paired apps keep working only until
     this swap; they re-anchor at step 3):

       scp ${SERVER_CRT} ${SERVER_KEY} ubuntu@${HUB_IP}:/tmp/
       ssh ubuntu@${HUB_IP} 'sudo install -m 600 /tmp/server.crt /etc/nats/tls/server.crt \\
         && sudo install -m 600 /tmp/server.key /etc/nats/tls/server.key \\
         && rm -f /tmp/server.key \\
         && sudo systemctl restart nats && systemctl is-active --quiet nats && echo "nats restarted"'

  2. Verify the Hub now presents the new chain:

       openssl s_client -connect ${HUB_IP}:8443 -CAfile ${CA_CRT} \\
         -verify_return_error </dev/null 2>/dev/null | grep -E '^(subject|Verify return code)'

  3. Re-pin the repository's public copy of the CA, then re-anchor every phone:

       scripts/rotate-hub-tls.sh --apply --out ${OUT_DIR}
       - paste the new ca.crt into each host's plugin settings card (CA field),
         then re-scan the QR on every phone. Re-scanning is the revocation.
       - rebuild + reinstall the App when convenient: the bundled CA is only the
         fallback for a QR without a certificate, and an old bundle keeps
         trusting the retired root on devices that never scanned.

  4. Rotate the Hub account password and revoke every device token — a client
     that talked to an impostor may have handed over its token:

       scripts/hub-credential.sh  (on the Hub: 'show' to read, 'rotate' to replace)
       the plugin's 移动端 card -> 已配对设备 -> 吊销

  5. Delete the old private keys from git history and re-run the audit:
     see dsh-mobile-plugin/docs/02 §1.1.
EOF
