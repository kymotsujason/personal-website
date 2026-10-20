#!/bin/bash
set -u
apiMode=0
if { [ "$#" != 2 ] && [ "$#" != 3 ]; } ||
    [ "${1:-}" != --stack ] || [[ "${2:-}" != app && "${2:-}" != site ]] ||
    { [ "$#" = 3 ] && [ "$3" != --api ]; }; then
    printf 'Usage: probes/run.sh --stack app|site [--api]\n' >&2
    exit 2
fi
stack=$2
[ "$#" != 3 ] || apiMode=1
cd "$(dirname "$0")/.." || exit 2
repoRoot=$(pwd)
[ -d apps/web/src ] || { printf 'Missing apps/web/src\n' >&2; exit 2; }
mkdir -p probes/out || exit 1
backupDir=$(mktemp -d) || exit 1
export SEMGREP_SETTINGS_FILE="${SEMGREP_SETTINGS_FILE:-$repoRoot/probes/out/semgrep-settings.yml}"
export SEMGREP_LOG_FILE="$repoRoot/probes/out/semgrep.log"
export SEMGREP_ENABLE_VERSION_CHECK=0
ok=0
mismatch=0
recorded=0
activeTarget=""
hadTarget=0
restoreTarget() {
    [ -n "$activeTarget" ] || return 0
    if [ "$hadTarget" = 1 ]; then
        cp -p "$backupDir/target" "$activeTarget" || exit 1
    else
        rm -f -- "$activeTarget" || exit 1
    fi
    activeTarget=""
}
apiArtifactsActive=0
restoreApiArtifacts() {
    [ "$apiArtifactsActive" = 1 ] || return 0
    cp -p "$backupDir/openapi.json" apps/api/openapi.json || exit 1
    cp -p "$backupDir/schema.d.ts" apps/web/src/api/schema.d.ts || exit 1
    apiArtifactsActive=0
}
cleanup() {
    restoreTarget
    restoreApiArtifacts
    rm -rf "$backupDir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
applyBroken() {
    restoreTarget
    [ ! -L "$2" ] || { printf 'Refusing symlink probe target %s\n' "$2" >&2; exit 1; }
    hadTarget=0
    if [ -e "$2" ]; then
        cp -p "$2" "$backupDir/target" || exit 1
        hadTarget=1
    fi
    activeTarget=$2
    cp -- "$1" "$activeTarget" || exit 1
}
recordResult() {
    local id=$1 name=$2 expected=$3 got=$4 valid=${5:-1} status
    if [ "$expected" = record ]; then
        status=RECORDED
        recorded=$((recorded + 1))
    elif [ "$valid" = 1 ] && { [[ "$expected" == fail && "$got" -ne 0 ]] || [[ "$expected" == pass && "$got" -eq 0 ]]; }; then
        status=OK
        ok=$((ok + 1))
    else
        status=MISMATCH
        mismatch=$((mismatch + 1))
    fi
    printf '%s %s expect=%s got=%s %s\n' "$id" "$name" "$expected" "$got" "$status"
}
runProbe() {
    local id=$1 name=$2 expected=$3
    shift 3
    export WEBDEV_PROBE_ID=$id
    "$@" >"probes/out/$id.log" 2>&1
    local got=$?
    recordResult "$id" "$name" "$expected" "$got"
    restoreTarget
}
baseChecks() {
    pnpm -C apps/web typecheck && pnpm -C apps/web lint && pnpm -C apps/web test
}
runProbe P0 baseline pass baseChecks
if [ "$mismatch" != 0 ]; then
    printf 'PROBES %s ok, %s mismatch, %s recorded\n' "$ok" "$mismatch" "$recorded"
    exit 1
fi
applyBroken probes/broken/type-error.ts apps/web/src/lib/tmp-type-probe.ts
runProbe P1 type-error fail pnpm -C apps/web typecheck
if [ "$stack" = site ]; then
    applyBroken probes/broken/index-error.astro apps/web/src/pages/index.astro
    runProbe P2 site-astro-error fail pnpm -C apps/web typecheck
    applyBroken probes/broken/index-error.astro apps/web/src/pages/index.astro
    runProbe P2b site-astro-error-tsc-only record pnpm -C apps/web exec tsc --noEmit
else
    printf 'P2 site-only SKIPPED\nP2b site-only SKIPPED\n'
fi
applyBroken probes/broken/failing.test.ts apps/web/src/lib/utils.test.ts
runProbe P4 failing-test fail pnpm -C apps/web test
for id in P5a P5b; do
    export WEBDEV_PROBE_ID=$id
    flags=()
    expected=pass
    wanted=0
    if [ "$id" = P5b ]; then
        flags=(--error)
        expected=fail
        wanted=1
    fi
    semgrep scan --metrics=off --config semgrep.yml "${flags[@]}" probes/broken/eval.js \
        >"probes/out/$id.log" 2>&1
    got=$?
    valid=0
    if [ "$got" = "$wanted" ] && grep -q no-eval "probes/out/$id.log"; then
        valid=1
    fi
    recordResult "$id" semgrep-exit-contract "$expected" "$got" "$valid"
done
runProbe P6a vitest-bare-no-tty record timeout 25 env -u CI pnpm -C apps/web exec vitest </dev/null
runProbe P6b vitest-bare-ci record timeout 25 env CI=1 pnpm -C apps/web exec vitest </dev/null
printf 'export const formatProbe={value:"hello"}\n' >"$backupDir/unformatted.ts"
applyBroken "$backupDir/unformatted.ts" apps/web/src/tmp-format-probe.ts
formatHook() {
    pnpm -C apps/web exec prettier --check src/tmp-format-probe.ts
    local before=$?
    printf '{"tool_input":{"file_path":"%s"}}' "$repoRoot/$activeTarget" | CLAUDE_PROJECT_DIR="$repoRoot" bash .claude/hooks/format.sh
    local hook=$?
    pnpm -C apps/web exec prettier --check src/tmp-format-probe.ts
    local after=$?
    [[ "$before" -ne 0 && "$hook" -eq 0 && "$after" -eq 0 ]]
}
runProbe P7 format-hook pass formatHook
emptyFormatHook() {
    printf '{}' | CLAUDE_PROJECT_DIR="$repoRoot" bash .claude/hooks/format.sh
}
runProbe P7b format-hook-empty pass emptyFormatHook
applyBroken probes/broken/type-error.ts apps/web/src/lib/tmp-type-probe.ts
export WEBDEV_PROBE_ID=P8a
printf '{"stop_hook_active":false}' | CLAUDE_PROJECT_DIR="$repoRoot" bash .claude/hooks/typecheck.sh \
    >probes/out/P8a.log 2>probes/out/P8a.stderr.log
got=$?
valid=0
[[ "$got" -eq 2 && -s probes/out/P8a.stderr.log ]] && valid=1
recordResult P8a typecheck-hook-red fail "$got" "$valid"
restoreTarget
greenStop() {
    printf '{}' | CLAUDE_PROJECT_DIR="$repoRoot" bash .claude/hooks/typecheck.sh
}
runProbe P8b typecheck-hook-green pass greenStop
applyBroken probes/broken/type-error.ts apps/web/src/lib/tmp-type-probe.ts
activeStop() {
    printf '{"stop_hook_active":true}' | CLAUDE_PROJECT_DIR="$repoRoot" bash .claude/hooks/typecheck.sh
}
runProbe P8c typecheck-hook-active pass activeStop
if [ "$stack" = site ]; then
    tsdk=$(jq -er '.astro.initializationOptions.typescript.tsdk' \
        "$HOME/.claude/skills/astro-lsp/.lsp.json") || exit 1
    runProbe L1 lsp-without-sdk fail node probes/lsp-init.mjs none
    runProbe L2 lsp-global-sdk pass node probes/lsp-init.mjs "$tsdk"
else
    printf 'L1 site-only SKIPPED\nL2 site-only SKIPPED\n'
fi
runApiProbe() {
    local id=$1 name=$2 source=$3 target=$4 diagnostic=$5
    local before=- got=1 valid=0 restored=- artifacts=1 file
    shift 5
    export WEBDEV_PROBE_ID=$id
    rm -f "probes/out/$id-before.log" "probes/out/$id.log" "probes/out/$id-restored.log" || exit 1
    for file in apps/api/openapi.json apps/web/src/api/schema.d.ts; do
        if [ ! -f "$file" ] || [ -L "$file" ]; then
            artifacts=0
            break
        fi
    done
    if [ "$artifacts" = 1 ]; then
        cp -p apps/api/openapi.json "$backupDir/openapi.json" || exit 1
        cp -p apps/web/src/api/schema.d.ts "$backupDir/schema.d.ts" || exit 1
        apiArtifactsActive=1
        "$@" >"probes/out/$id-before.log" 2>&1
        before=$?
        if ! cmp -s "$backupDir/openapi.json" apps/api/openapi.json ||
            ! cmp -s "$backupDir/schema.d.ts" apps/web/src/api/schema.d.ts; then
            artifacts=0
        fi
        if [ "$before" = 0 ]; then
            applyBroken "$source" "$target"
            "$@" >"probes/out/$id.log" 2>&1
            got=$?
            if ! cmp -s "$backupDir/openapi.json" apps/api/openapi.json ||
                ! cmp -s "$backupDir/schema.d.ts" apps/web/src/api/schema.d.ts; then
                artifacts=0
            fi
            restoreTarget
            restoreApiArtifacts
            apiArtifactsActive=1
            "$@" >"probes/out/$id-restored.log" 2>&1
            restored=$?
            if ! cmp -s "$backupDir/openapi.json" apps/api/openapi.json ||
                ! cmp -s "$backupDir/schema.d.ts" apps/web/src/api/schema.d.ts; then
                artifacts=0
            fi
            if [ "$got" != 0 ] && [ "$restored" = 0 ] && [ "$artifacts" = 1 ] &&
                grep -Fq "$diagnostic" "probes/out/$id.log"; then
                valid=1
            fi
        else
            got=$before
        fi
    fi
    restoreApiArtifacts
    recordResult "$id" "$name" fail "$got" "$valid"
    printf 'API control %s before=%s restored=%s artifacts=%s\n' "$id" "$before" "$restored" "$artifacts"
}
if [ "$apiMode" = 1 ]; then
    runApiProbe A1 ownership probes/broken/notes-no-owner.ts apps/api/src/routes/notes.ts \
        "API ownership: user B must receive 404 for user A's note" \
        pnpm -C apps/api test:integration
    runApiProbe A2 contract-freshness probes/broken/notes-extra-field.ts apps/api/src/contracts/notes.ts \
        'API contract artifacts are stale.' \
        pnpm -C apps/web typecheck
    runApiProbe A3 response-status probes/broken/notes-wrong-status.ts apps/api/src/routes/notes.ts \
        "API response status 200 isn't declared" \
        pnpm -C apps/api test:integration
fi
printf 'PROBES %s ok, %s mismatch, %s recorded\n' "$ok" "$mismatch" "$recorded"
[ "$mismatch" = 0 ]
