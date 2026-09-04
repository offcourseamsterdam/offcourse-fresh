#!/usr/bin/env python3
"""
set-revolut-vercel-env.py — zet de Revolut-omgevingsvariabelen in Vercel, geldig
voor alle deployments van de gekozen environment (geen git-branch-scoping).

Gebruik meestal via scripts/finance/set-revolut-vercel-env.sh (die valideert de
redirect URI en zoekt het juiste sleutelpaar op); dit bestand kan ook los draaien.

Waarom de REST API en niet `vercel env add`: die CLI-opdracht (versie 50.44.0)
faalt bij het zetten van een Preview-variabele voor alle branches — het commando
dat de CLI zelf als oplossing voorstelt geeft dezelfde foutmelding terug
('git_branch_required'). Rechtstreeks dezelfde aanvraag aan de Vercel REST API
werkt wel. Bovendien dragen deploys vanuit deze git-worktree ('.git' is hier een
bestand, geen map) toch geen commit/branch-metadata mee, dus een branch-gescopeerde
variabele zou ook bij een werkende CLI nooit toegepast worden op deze deployments.

Privacy: de private key en de token key komen uit ~/.offcourse-secrets en gaan
alleen versleuteld over HTTPS naar Vercel. Dit script print nooit een waarde,
alleen variabelenamen en of het gelukt is.
"""
import base64
import json
import sys
import urllib.request
from typing import Optional

PROJECT_ID = "prj_BHxYGZTO02Ez5o7XqtWjvcnLTT0k"
AUTH_FILE = "/Users/beer/Library/Application Support/com.vercel.cli/auth.json"
SECRETS_DIR = "/Users/beer/.offcourse-secrets/revolut"


def cli_token() -> str:
    with open(AUTH_FILE) as f:
        return json.load(f)["token"]


def api(method: str, path: str, body: Optional[dict], token: str) -> dict:
    req = urllib.request.Request(
        f"https://api.vercel.com{path}",
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None,
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def existing_env_id(token: str, key: str, target: str) -> Optional[str]:
    data = api("GET", f"/v9/projects/{PROJECT_ID}/env", None, token)
    for e in data.get("envs", []):
        if e["key"] == key and target in (e.get("target") or []) and not e.get("gitBranch"):
            return e["id"]
    return None


def put(token: str, key: str, value: str, target: str) -> None:
    existing = existing_env_id(token, key, target)
    body = {"key": key, "value": value, "type": "encrypted", "target": [target]}
    if existing:
        api("PATCH", f"/v9/projects/{PROJECT_ID}/env/{existing}", body, token)
        print(f"  bijgewerkt: {key}")
    else:
        api("POST", f"/v9/projects/{PROJECT_ID}/env", body, token)
        print(f"  toegevoegd: {key}")


def main() -> None:
    if len(sys.argv) < 3:
        print("gebruik: set-revolut-vercel-env.py <preview|production> <redirect-uri> [client-id] [sleutelpaar]", file=sys.stderr)
        sys.exit(1)
    target = sys.argv[1]
    redirect_uri = sys.argv[2]
    client_id = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
    key_set = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else target

    key_file = f"{SECRETS_DIR}/{key_set}/privatecert.pem"
    token_key_file = f"{SECRETS_DIR}/token-key.txt"

    with open(key_file, "rb") as kf:
        private_key_b64 = base64.b64encode(kf.read()).decode()
    with open(token_key_file) as tf:
        token_key = tf.read().strip()

    t = cli_token()
    print(f"Revolut-variabelen zetten op '{target}' (alle deployments; sleutelpaar: {key_set})")
    put(t, "REVOLUT_ENV", "production", target)
    put(t, "REVOLUT_REDIRECT_URI", redirect_uri, target)
    put(t, "REVOLUT_PRIVATE_KEY", private_key_b64, target)
    put(t, "REVOLUT_TOKEN_KEY", token_key, target)
    if client_id:
        put(t, "REVOLUT_CLIENT_ID", client_id, target)
    else:
        print("  overgeslagen: REVOLUT_CLIENT_ID (niet meegegeven)")
    print("\nKlaar. Deploy opnieuw, anders blijven de oude waarden actief.")


if __name__ == "__main__":
    main()
