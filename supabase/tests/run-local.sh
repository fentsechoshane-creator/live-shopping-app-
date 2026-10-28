#!/usr/bin/env bash
# Runs the migrations and the policy tests on a throwaway local Postgres. Needs Postgres 15+ binaries.
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
DIR=$(mktemp -d)
# Postgres refuses to run as root. In containers, run it as the postgres user.
RUN=""
if [ "$(id -u)" = "0" ]; then RUN="runuser -u postgres --"; chown postgres "$DIR"; chmod 755 "$DIR"; fi
PORT=${PGPORT_TEST:-54329}
$RUN "$PGBIN/initdb" -D "$DIR" -U postgres -A trust >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR" -l "$DIR/log" start >/dev/null
trap '$RUN "$PGBIN/pg_ctl" -D "$DIR" stop -m fast >/dev/null; rm -rf "$DIR"' EXIT
PSQL="psql -h $DIR -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f tests/local/stub.sql
for f in migrations/*.sql; do $PSQL -f "$f"; done
$PSQL -f seed.sql
$PSQL -f tests/policies.test.sql
echo "Database tests passed"
