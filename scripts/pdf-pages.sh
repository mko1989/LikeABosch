#!/bin/sh
# Print pages FROM..TO (inclusive) of the extracted Conference Protocol PDF text.
# Usage: scripts/pdf-pages.sh 78 79
# Source text: docs/source/conference-protocol.txt (pypdf extraction, "=== PAGE n ===" markers).
DIR="$(cd "$(dirname "$0")/.." && pwd)"
FROM="$1"; TO="${2:-$1}"
awk -v from="$FROM" -v to="$TO" '
  /^=== PAGE [0-9]+ ===$/ { n = $3 + 0 }
  n >= from && n <= to && $0 !~ /^[[:space:]]*$/ && $0 !~ /^Bosch Security Systems$/ && $0 !~ /^\(c\) Bosch Security/ { print }
' "$DIR/docs/source/conference-protocol.txt"
