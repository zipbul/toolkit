#!/usr/bin/env bash
# Test policy gate for @zipbul/router refactor.
# Enforces REFACTOR.md § 1.1: no skipped/todo specs, no @ts-ignore.
# `as any` / `as unknown as` are permitted (legit negative-case usage).

set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

# 1) skip/todo/xit — strict 0
matches=$(grep -rEn '\.skip\(|\.todo\(|\bxit\(' test/ 2>/dev/null || true)
if [ -n "$matches" ]; then
  echo "FAIL: skip/todo/xit detected:"
  echo "$matches"
  fail=1
fi

# 2) @ts-ignore / @ts-expect-error — strict 0 outside contract tests
matches=$(grep -rEn '@ts-ignore|@ts-expect-error' test/ 2>/dev/null \
  | grep -v 'public-api.contract.ts' || true)
if [ -n "$matches" ]; then
  echo "FAIL: @ts-ignore / @ts-expect-error outside contract tests:"
  echo "$matches"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: test policy clean (skip/todo/xit=0, ts-ignore=0)"
fi

exit $fail
