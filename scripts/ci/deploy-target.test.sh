#!/usr/bin/env bash
set -euo pipefail
d="$(dirname "$0")"
[ "$("$d/deploy-target.sh" staging)" = "tenants/renown-staging/powerhouse-values.yaml" ]
[ "$("$d/deploy-target.sh" latest)" = "tenants/renown/powerhouse-values.yaml" ]
[ -z "$("$d/deploy-target.sh" dev)" ]
if "$d/deploy-target.sh" bogus 2>/dev/null; then echo "bogus must fail"; exit 1; fi
echo ok
