#!/usr/bin/env bash
# set-revolut-vercel-env.sh — zet de Revolut-variabelen in Vercel zonder ze ooit
# op het scherm te tonen. De private key en de token key worden rechtstreeks uit
# ~/.offcourse-secrets/revolut/ gelezen en naar de Vercel CLI gepiped.
#
# Gebruik (vanuit de map die aan het juiste Vercel-project gekoppeld is):
#   scripts/finance/set-revolut-vercel-env.sh <environment> <redirect-uri> [client-id]
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
# later nog eens draaien met de id erbij.
#
# Na afloop: één nieuwe deploy, want Vercel pakt gewijzigde variabelen pas op bij
# een volgende deployment.

set -euo pipefail

ENVIRONMENT="${1:-}"
REDIRECT_URI="${2:-}"
CLIENT_ID="${3:-}"
GIT_BRANCH="${4:-}"

if [[ -z "$ENVIRONMENT" || -z "$REDIRECT_URI" ]]; then
  echo "Gebruik: $0 <preview|production|development> <redirect-uri> [client-id] [git-branch]" >&2
  exit 1
fi

case "$ENVIRONMENT" in
  preview|production|development) ;;
  *) echo "Onbekende environment: $ENVIRONMENT" >&2; exit 1 ;;
esac

# Sandbox of productie bij Revolut zelf. Een preview-deployment die aan je echte
# Revolut-certificaat hangt is dus gewoon 'production'.
REVOLUT_ENV="${REVOLUT_ENV:-production}"

SECRETS_DIR="$HOME/.offcourse-secrets/revolut"
KEY_FILE="$SECRETS_DIR/$REVOLUT_ENV/privatecert.pem"
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

put() {
  local name="$1" value="$2" out
  # --force overschrijft een bestaande waarde in dezelfde environment.
  #
  # De waarde gaat via --value in plaats van stdin: de Vercel CLI weigert stdin
  # zodra hij geen echte terminal ziet en eist dan deze vorm. De waarde komt uit
  # een shell-variabele die hier uit ~/.offcourse-secrets is gelezen, dus hij
  # staat niet in dit script, niet in je shell-historie en niet in een chat. Hij
  # is wel heel even zichtbaar in de procestabel van je eigen Mac.
  if out=$(npx vercel env add "$name" "$ENVIRONMENT" ${GIT_BRANCH:+"$GIT_BRANCH"} --value "$value" --yes --force 2>&1); then
    echo "  gezet: $name"
  else
    echo "  MISLUKT: $name" >&2
    # Alleen de foutregels tonen, nooit de waarde zelf.
    echo "$out" | grep -iE "error|invalid|denied" | head -3 >&2 || true
    return 1
  fi
}

echo "Revolut-variabelen zetten in environment '$ENVIRONMENT'${GIT_BRANCH:+ (branch: $GIT_BRANCH)} (Revolut-omgeving: $REVOLUT_ENV)"
put REVOLUT_ENV "$REVOLUT_ENV"
put REVOLUT_REDIRECT_URI "$REDIRECT_URI"
put REVOLUT_PRIVATE_KEY "$(base64 < "$KEY_FILE" | tr -d '\n')"
put REVOLUT_TOKEN_KEY "$(tr -d '\n' < "$TOKEN_KEY_FILE")"

if [[ -n "$CLIENT_ID" ]]; then
  put REVOLUT_CLIENT_ID "$CLIENT_ID"
else
  echo "  overgeslagen: REVOLUT_CLIENT_ID (nog niet meegegeven)"
fi

echo
echo "Klaar. Deploy nu opnieuw, anders blijven de oude waarden actief."
