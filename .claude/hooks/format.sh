#!/bin/bash
if ! command -v jq >/dev/null 2>&1; then
    printf "webdevsetup hook: jq isn't installed, hook skipped\n" >&2
    exit 0
fi
root=${CLAUDE_PROJECT_DIR:-$PWD}
file=$(jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0
case "$file" in
    *.ts|*.tsx|*.js|*.mjs|*.astro|*.css|*.json|*.jsonc|*.md) ;;
    *) exit 0 ;;
esac
[[ "$file" == "$root/"* ]] || exit 0
if ! output=$(pnpm -C "$root/apps/web" exec prettier --write "$file" 2>&1); then
    printf '%s\n' "$output" >&2
    exit 2
fi
printf '%s\n' "$output"
pnpm -C "$root/apps/web" exec eslint --fix "$file" >/dev/null 2>&1
exit 0
