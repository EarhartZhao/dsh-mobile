#!/usr/bin/env bash
# Read or rotate the Hub's C-end NATS credential. Runs ON the Hub.
#
# The password exists in exactly one place: the `c-end-dsh` line in
# /etc/nats/hub.conf. setup-hub.sh prints it once at creation and never again
# ("password NOT re-printed"), so a lost copy can only be read back here or
# replaced. Rotation is safe at any time: nothing embeds this credential — the
# App receives it through the pairing QR, and the Leaf account is separate.
#
#   ssh root@115.159.57.137 'bash -s show'   < scripts/hub-credential.sh
#   ssh root@115.159.57.137 'bash -s rotate' < scripts/hub-credential.sh
#   ssh root@115.159.57.137 'bash -s rotate <your-own-password>' < scripts/hub-credential.sh
#
# Afterwards put the value into the plugin's 「移动端」 settings card: it is
# handed to phones via the QR, so a stale copy there means the phone cannot
# reach the Hub at all.
set -euo pipefail

CONF="${HUB_CONF:-/etc/nats/hub.conf}"
ACCOUNT="${HUB_ACCOUNT:-c-end-dsh}"
MODE="${1:-show}"
NEW_PASS="${2:-}"

[ -r "$CONF" ] || { echo "ERROR: cannot read $CONF (run on the Hub, as root)" >&2; exit 1; }

current_line() {
  grep -n "^[[:space:]]*user:[[:space:]]*${ACCOUNT},[[:space:]]*password:" "$CONF" || true
}

line="$(current_line)"
if [ -z "$line" ]; then
  echo "ERROR: no 'user: ${ACCOUNT}, password: …' line in $CONF." >&2
  echo "The account may be named differently. Accounts present:" >&2
  grep -nE "^[[:space:]]*user:" "$CONF" | sed 's/password:.*/password: <redacted>/' >&2
  exit 1
fi

extract_pass() {
  # Everything after the first "password:" on the account line, unquoted.
  sed -n "s/^[[:space:]]*user:[[:space:]]*${ACCOUNT},[[:space:]]*password:[[:space:]]*//p" "$CONF" \
    | head -1 | sed -E 's/^"(.*)"$/\1/' | tr -d '\r'
}

case "$MODE" in
  show)
    echo "account:  ${ACCOUNT}"
    echo "password: $(extract_pass)"
    echo
    echo "Paste the password into the plugin's 「移动端」 card, then generate a QR."
    ;;
  rotate)
    if [ -z "$NEW_PASS" ]; then
      NEW_PASS="$(openssl rand -hex 16)"
      echo "generated a new password"
    fi
    # hub.conf is the whole Hub's routing table: back it up, edit one line,
    # validate before restarting, and restore on any failure.
    backup="${CONF}.bak.$(date +%s)"
    cp -a "$CONF" "$backup"
    awk -v account="$ACCOUNT" -v pass="$NEW_PASS" '
      BEGIN { done = 0 }
      !done && $0 ~ "^[[:space:]]*user:[[:space:]]*" account ",[[:space:]]*password:" {
        sub(/password:.*/, "password: " pass)
        done = 1
      }
      { print }
    ' "$backup" > "$CONF"
    if ! nats-server -t -c "$CONF" >/dev/null 2>&1; then
      cp -a "$backup" "$CONF"
      echo "ERROR: nats-server rejected the edited config; restored $backup" >&2
      exit 1
    fi
    systemctl restart nats
    echo "account:  ${ACCOUNT}"
    echo "password: ${NEW_PASS}"
    echo "previous: ${backup} (contains the old value; delete when done)"
    echo
    echo "Update the plugin's 「移动端」 card to match. Paired devices keep their tokens"
    echo "(device auth is a separate layer), so no re-pairing is needed."
    ;;
  *)
    echo "usage: $0 [show|rotate [password]]" >&2
    exit 2
    ;;
esac
