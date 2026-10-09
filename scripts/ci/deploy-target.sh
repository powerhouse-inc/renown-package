#!/usr/bin/env bash
# Values file a release channel deploys to. dev deploys nowhere.
set -euo pipefail
case "${1:-}" in
  staging) echo "tenants/renown-staging/powerhouse-values.yaml" ;;
  latest)  echo "tenants/renown/powerhouse-values.yaml" ;;
  dev)     ;;
  *) echo "unknown channel: ${1:-}" >&2; exit 1 ;;
esac
