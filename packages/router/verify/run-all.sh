#!/usr/bin/env bash
# Run all 72-item verifiers and capture output to verify/RESULTS.txt.
# User can invoke this independently to validate every claim.

set -u
cd "$(dirname "$0")/.."

OUT="verify/RESULTS.txt"
: > "$OUT"

first=1
for f in $(ls verify/*.ts | sort); do
  if [ "$first" -eq 0 ]; then
    echo >> "$OUT"
  fi
  first=0
  echo "=========================================" >> "$OUT"
  echo "RUN: $f" >> "$OUT"
  echo "=========================================" >> "$OUT"
  bun run "$f" >> "$OUT" 2>&1
done

echo "Done. Results in $OUT."
echo "Summary of REPRODUCED / REFUTED:"
grep -E '^VERDICT:' "$OUT" | sort | uniq -c | sort -rn
