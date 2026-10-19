#!/bin/bash
if ! command -v jq >/dev/null 2>&1; then
    printf "webdevsetup hook: jq isn't installed, hook skipped\n" >&2
    exit 0
fi
root=${CLAUDE_PROJECT_DIR:-$PWD}
hookInput=$(cat)
if ! stopActive=$(printf '%s' "$hookInput" | jq -r '.stop_hook_active // false' 2>/dev/null); then
    exit 0
fi
[ "$stopActive" = true ] && exit 0
if ! output=$(pnpm -C "$root" typecheck 2>&1); then
    printf '%s\n' "$output" | tail -40 >&2
    exit 2
fi
exit 0
