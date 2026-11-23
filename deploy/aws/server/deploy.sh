#!/bin/bash
# Runs on the EC2 instance (as root, through SSM Run Command) for every release.
# Usage: deploy.sh <release-dir> <site-url>
# The release dir holds the repo files the server needs (deploy/, supabase/, scripts/, package files).
set -euo pipefail
REL=$(cd "$1" && pwd)
SITE_URL=$2
APP=${APP_DIR:-/opt/gratifiki}
SRV="$REL/deploy/aws/server"
mkdir -p "$APP" && chmod 700 "$APP"
cd "$APP"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # jwt <role> <secret>: HS256 key valid for 10 years, same shape as Supabase keys
  local now h p s
  now=$(date +%s)
  h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  p=$(printf '{"role":"%s","iss":"supabase","iat":%d,"exp":%d}' "$1" "$now" $((now + 315360000)) | b64url)
  s=$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$2" -binary | b64url)
  printf '%s.%s.%s' "$h" "$p" "$s"
}

# 1. Secrets: generated once on this machine, never leave it (except the public anon key).
if [ ! -f secrets.env ]; then
  umask 077
  js=$(openssl rand -hex 32)
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "JWT_SECRET=$js"
    echo "ANON_KEY=$(jwt anon "$js")"
    echo "SERVICE_ROLE_KEY=$(jwt service_role "$js")"
  } > secrets.env
fi
set -a; . ./secrets.env; set +a
export SITE_URL AWS_REGION=${AWS_REGION:-us-east-2} KONG_CONFIG="$APP/kong.yml"

( umask 077; sed -e "s|__ANON_KEY__|$ANON_KEY|" -e "s|__SERVICE_KEY__|$SERVICE_ROLE_KEY|" "$SRV/kong.yml.tpl" > kong.yml )
chmod 644 kong.yml  # readable by the Kong container user; $APP itself stays 700

dc() { docker compose -f "$SRV/compose.yml" ${COMPOSE_OVERRIDE:+-f "$COMPOSE_OVERRIDE"} "$@"; }
psql_db() { dc exec -T db psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres "$@"; }

# 2. Database and Auth first: GoTrue creates its own tables before our migrations use auth.*
dc pull -q
dc up -d --wait db auth

# 3. Migrations, each in one transaction together with its bookkeeping row.
psql_db -c "create schema if not exists deploy; create table if not exists deploy.applied (name text primary key, applied_at timestamptz not null default now()); revoke all on schema deploy from public;"
for f in "$REL"/supabase/migrations/*.sql; do
  n=$(basename "$f")
  [ -n "$(psql_db -tAc "select 1 from deploy.applied where name = '$n'")" ] && continue
  echo "applying $n"
  { cat "$f"; printf "\ninsert into deploy.applied (name) values ('%s');\n" "$n"; } | psql_db -1 -f -
done
if [ -z "$(psql_db -tAc "select 1 from deploy.applied where name = 'seed.sql'")" ]; then
  echo "applying seed.sql"
  { cat "$REL/supabase/seed.sql"; printf "\ninsert into deploy.applied (name) values ('seed.sql');\n"; } | psql_db -1 -f -
fi

# 4. API and gateway; PostgREST reloads its schema cache after new migrations.
dc up -d --wait rest kong
psql_db -c "notify pgrst, 'reload schema';"

# 5. Fictional demo accounts, created once. Passwords are random and stay on the server
#    (and, on AWS, in an encrypted SSM parameter for the team).
if [ ! -f demo-credentials.env ]; then
  ( umask 077
    for r in AREA_TECNICA REVISOR_TECNICO CAM GESTOR_UNIDADE GESTOR_DISTRITAL ADMINISTRADOR LIDERANCA; do
      l=$(echo "$r" | tr 'A-Z_' 'a-z-')
      echo "ACADEMIC_${r}_EMAIL=${l}@gratifiki-demo.invalid"
      echo "ACADEMIC_${r}_PASSWORD=$(openssl rand -hex 12)"
    done > demo-credentials.env.tmp )
  docker run --rm --network host -v "$REL":/app:ro -v "$APP/demo-credentials.env.tmp":/run/demo.env:ro \
    -e SUPABASE_URL=http://127.0.0.1:8000/ -e SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
    node:22.20.0-alpine sh -c 'mkdir /tmp/app && cp -r /app/package.json /app/package-lock.json /app/scripts /app/src /tmp/app/ && cd /tmp/app && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null && set -a && . /run/demo.env && set +a && npm run -s demo:academic'
  mv demo-credentials.env.tmp demo-credentials.env
  if [ -n "${DEMO_CREDENTIALS_PARAM:-}" ]; then
    aws ssm put-parameter --region "$AWS_REGION" --name "$DEMO_CREDENTIALS_PARAM" --type SecureString --overwrite --value "file://$APP/demo-credentials.env" >/dev/null
  fi
fi

# 6. Smoke check through the gateway with the public key only.
code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON_KEY" http://127.0.0.1:8000/auth/v1/health)
[ "$code" = 200 ] || { echo "auth health returned $code"; exit 1; }
echo "deploy ok"
