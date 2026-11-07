#!/usr/bin/env bash
# Fill a local test server with one key of every type, plus a few prefixes and
# TTLs, so the UI has something to browse.
#
# Usage: scripts/seed.sh [redis|valkey|dragonfly]   (default: redis)
#
# Commands run through the redis container's redis-cli, which reaches the other
# services by name on the compose network. Safe to run more than once.
set -euo pipefail

service="${1:-redis}"
cd "$(dirname "$0")/.."

docker compose exec -T redis redis-cli -h "$service" <<'EOF'
SET greeting "hello fogtrail"
SET counter:visits 42
SET unicode:sample "héllo wörld — 日本語"
SET config:app '{"theme":"dark","beta":true,"features":["tree","viewers"]}'
SET very:long:key:name:with:many:segments:to:test:the:tree:and:breadcrumbs 1

HSET user:1 name Ada email ada@example.com plan pro
HSET user:2 name Grace email grace@example.com plan free
HSET user:3 name Linus email linus@example.com plan pro

SET session:abc123 '{"user":1}' EX 3600
SET session:def456 '{"user":2}' EX 120
SET cache:product:1 '{"name":"Lamp","price":25}' EX 600
SET cache:product:2 '{"name":"Desk","price":180}' EX 600

DEL queue:emails
RPUSH queue:emails welcome-1 welcome-2 reset-3

SADD tags:redis cache queue stream
ZADD leaderboard 1200 ada 980 grace 1500 linus

DEL events
XADD events * type signup user 1
XADD events * type login user 1
XADD events * type signup user 2
EOF

# A longer stream, so paging and consumer groups have something to show.
{
  for i in $(seq 1 120); do echo "XADD events * type tick n $i"; done
  echo "XGROUP CREATE events workers 0"
  echo "XREADGROUP GROUP workers worker-1 COUNT 3 STREAMS events >"
} | docker compose exec -T redis redis-cli -h "$service" >/dev/null

echo "Seeded $service."
