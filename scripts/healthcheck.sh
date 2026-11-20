#!/usr/bin/env bash
# Post-deployment checks.  bash scripts/healthcheck.sh https://app.example.com
set -uo pipefail
BASE="${1:-http://192.168.100.198:3000}"
fail=0
check() { local name="$1" url="$2" expect="$3"; code=$(curl -s -o /dev/null -w '%{http_code}' "$url"); if [ "$code" = "$expect" ]; then echo "OK   $name ($code)"; else echo "FAIL $name (got $code, want $expect) $url"; fail=1; fi; }
check "API health"           "$BASE/api/health" 200
check "Branding endpoint"    "$BASE/api/v1/public/branding" 200
check "Landing page"         "$BASE/" 200
check "Sitemap"              "$BASE/sitemap.xml" 200
check "Robots"               "$BASE/robots.txt" 200
check "Realtime (polling)"   "$BASE/realtime?EIO=4&transport=polling" 200
check "Auth required"        "$BASE/api/v1/r/dashboard" 401
curl -s "$BASE/api/health" | grep -q '"db":"ok"' && echo "OK   Database reachable" || { echo "FAIL Database"; fail=1; }
exit $fail
