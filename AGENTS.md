# Project instructions

Don't make verification pass by weakening tests, disabling checks, or suppressing failures. Raise any needed change to an acceptance criterion separately.

Prefer LSP over Grep for symbols and references. Use Grep for literal strings, configuration, and assets.

`pnpm typecheck` checks `apps/web`. `pnpm check` runs formatting, lint, typecheck, and unit tests. `pnpm verify` also runs the production build, Playwright browser tests, and Semgrep with findings treated as errors. Use `vitest run` for unit tests.

`probes/run.sh --stack <app|site>` breaks each guard on purpose to prove it fails, overwriting a few source files while it runs and restoring them afterwards, and its logs land in `probes/out/`.

## Project

This is Jason Yue's personal website, an interactive three.js desk scene with a blog and project pages. The stack is `site` (Astro). There is no API, a Cloudflare Worker serves `/api/home`.

Marker: webdevsetup-8b835a39696491ee187e7079

Hydrate only components that need browser behavior and record the intended hydration budget before adding a client directive.
