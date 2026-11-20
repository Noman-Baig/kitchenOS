#!/usr/bin/env bash
# Optional: create an Ed25519 key pair for signing agreement acceptance records (PEM).
#   bash scripts/generate-signing-key.sh /etc/umemaai/keys platform-key-2026-01
# Then set in backend/.env:
#   PLATFORM_SIGNING_KEY_PATH=/etc/umemaai/keys/platform-key-2026-01.pem
#   PLATFORM_SIGNING_KEY_ID=platform-key-2026-01
#   PLATFORM_PUBLIC_KEYS_DIR=/etc/umemaai/keys/public
# Rotation: generate a new key id, switch the two variables, keep old public keys in the public dir.
# Revocation: create an empty file  <public dir>/<key-id>.revoked  — signatures by that key then fail verification.
set -euo pipefail
DIR="${1:?key directory}"; ID="${2:?key id, e.g. platform-key-2026-01}"
mkdir -p "$DIR/public"; chmod 700 "$DIR"
openssl genpkey -algorithm ed25519 -out "$DIR/$ID.pem"
chmod 600 "$DIR/$ID.pem"
openssl pkey -in "$DIR/$ID.pem" -pubout -out "$DIR/public/$ID.pem"
echo "Private key: $DIR/$ID.pem (keep secret, never commit, back up offline)"
echo "Public key : $DIR/public/$ID.pem"
