#!/bin/bash
# Publishes one release: backend on EC2 (through SSM) first, then the SPA on S3 + CloudFront.
# Runs in GitHub Actions (OIDC role) or locally with AWS credentials.
# Needs: SITE_URL SITE_BUCKET ARTIFACT_BUCKET DISTRIBUTION_ID INSTANCE_ID; ANON_KEY for the frontend.
# Usage: release.sh [backend|frontend|all]   (default: all)
set -euo pipefail
cd "$(dirname "$0")/../.."
STEP=${1:-all}
: "${SITE_URL:?}" "${SITE_BUCKET:?}" "${ARTIFACT_BUCKET:?}" "${DISTRIBUTION_ID:?}" "${INSTANCE_ID:?}"
export AWS_REGION=${AWS_REGION:-us-east-2}
SHA=$(git rev-parse --short HEAD)

if [ "$STEP" != frontend ]; then
  tar -czf /tmp/release.tgz deploy supabase/migrations supabase/seed.sql scripts src package.json package-lock.json
  aws s3 cp --only-show-errors /tmp/release.tgz "s3://$ARTIFACT_BUCKET/releases/$SHA.tgz"
  cmd=$(cat <<EOF
set -euo pipefail
for i in \$(seq 60); do [ -f /var/lib/gratifiki-bootstrap-done ] && break; sleep 5; done
d=\$(mktemp -d) && aws s3 cp --only-show-errors s3://$ARTIFACT_BUCKET/releases/$SHA.tgz \$d/r.tgz && tar -xzf \$d/r.tgz -C \$d
DEMO_CREDENTIALS_PARAM=/gratifiki/demo-credentials AWS_REGION=$AWS_REGION bash \$d/deploy/aws/server/deploy.sh \$d $SITE_URL 2>&1 | grep -vE 'Container|Pulling|Pulled|Waiting|Healthy|Started|Created|Running'
rm -rf \$d
EOF
)
  params=$(jq -n --arg c "$cmd" '{commands: [$c], executionTimeout: ["1800"]}')
  id=$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
        --comment "gratifiki release $SHA" --timeout-seconds 600 --parameters "$params" \
        --query Command.CommandId --output text)
  echo "SSM command $id (release $SHA)"
  status=Pending
  for _ in $(seq 180); do
    status=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
    case $status in Pending|InProgress|Delayed) sleep 10 ;; *) break ;; esac
  done
  aws ssm get-command-invocation --command-id "$id" --instance-id "$INSTANCE_ID" \
    --query '[StandardOutputContent,StandardErrorContent]' --output text
  [ "$status" = Success ] || { echo "backend deploy: $status"; exit 1; }
fi

if [ "$STEP" != backend ]; then
  : "${ANON_KEY:?}"
  host=${SITE_URL#https://}
  VITE_RUNTIME_MODE=demo_remote VITE_SUPABASE_URL="$SITE_URL/" VITE_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" \
    VITE_ALLOWED_DEMO_HOSTS="$host" npm run build
  aws s3 sync --only-show-errors --delete --exclude index.html --cache-control 'public,max-age=31536000,immutable' dist "s3://$SITE_BUCKET"
  aws s3 cp --only-show-errors --cache-control 'no-cache' dist/index.html "s3://$SITE_BUCKET/index.html"
  aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths '/index.html' --query Invalidation.Id --output text
  code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/")
  echo "site $SITE_URL returned $code"
  [ "$code" = 200 ]
fi
echo "release $SHA ok"
