#!/usr/bin/env bash
# set-revolut-vercel-env.sh — zet de Revolut-variabelen in Vercel zonder ze ooit
# op het scherm te tonen. Dunne validerende wrapper om set-revolut-vercel-env.py,
# dat de daadwerkelijke Vercel REST API-calls doet.
#
# Gebruik:
#   scripts/finance/set-revolut-vercel-env.sh <preview|production> <redirect-uri> [client-id] [sleutelpaar]
#
# Voorbeeld preview:
#   scripts/finance/set-revolut-vercel-env.sh preview \
#     https://offcourse-ai-ops-sync.vercel.app/api/admin/finance/cockpit/revolut/callback \
#     <client-id-uit-revolut>
#
# Voorbeeld productie:
#   scripts/finance/set-revolut-vercel-env.sh production \
#     https://offcourseamsterdam.com/api/admin/finance/cockpit/revolut/callback \
#     <client-id-uit-revolut>
#
# Laat je de client id weg, dan wordt alleen de rest gezet en kun je het script
# later nog eens draaien met de id erbij. Het sleutelpaar (map onder
# ~/.offcourse-secrets/revolut/) is standaard gelijk aan de environment-naam;
# override met een vierde argument als je bewust een ander paar wilt gebruiken.
#
# Na afloop: één nieuwe deploy, want Vercel pakt gewijzigde variabelen pas op bij
# een volgende deployment. Bij een preview-deployment via 'vercel --yes' (los van
# een git push) moet je daarna ook de alias opnieuw zetten:
#   npx vercel alias set <nieuwe-deployment-url> offcourse-ai-ops-sync.vercel.app

set -euo pipefail

ENVIRONMENT="${1:-}"
REDIRECT_URI="${2:-}"
CLIENT_ID="${3:-}"
KEY_SET_OVERRIDE="${4:-}"

if [[ -z "$ENVIRONMENT" || -z "$REDIRECT_URI" ]]; then
  echo "Gebruik: $0 <preview|production> <redirect-uri> [client-id] [sleutelpaar]" >&2
  exit 1
fi

case "$ENVIRONMENT" in
  preview|production) ;;
  *) echo "Onbekende environment: $ENVIRONMENT (alleen preview of production)" >&2; exit 1 ;;
esac

KEY_SET="${KEY_SET_OVERRIDE:-$ENVIRONMENT}"
SECRETS_DIR="$HOME/.offcourse-secrets/revolut"
KEY_FILE="$SECRETS_DIR/$KEY_SET/privatecert.pem"
TOKEN_KEY_FILE="$SECRETS_DIR/token-key.txt"

[[ -f "$KEY_FILE" ]] || { echo "Private key niet gevonden: $KEY_FILE" >&2; exit 1; }
[[ -f "$TOKEN_KEY_FILE" ]] || { echo "Token key niet gevonden: $TOKEN_KEY_FILE" >&2; exit 1; }

# De redirect URI moet exact overeenkomen met wat je in Revolut hebt ingevuld,
# want het iss-veld in de JWT wordt uit het domein hiervan afgeleid.
if [[ "$REDIRECT_URI" != https://*/api/admin/finance/cockpit/revolut/callback ]]; then
  echo "Let op: de redirect URI hoort te eindigen op /api/admin/finance/cockpit/revolut/callback" >&2
  echo "Gekregen: $REDIRECT_URI" >&2
  exit 1
fi

python3 "$(dirname "$0")/set-revolut-vercel-env.py" "$ENVIRONMENT" "$REDIRECT_URI" "$CLIENT_ID" "$KEY_SET"
