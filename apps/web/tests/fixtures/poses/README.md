# Pose fixtures

These files are the reference spike's poses, recorded frame by frame, so the site's scene can be compared against the spike it was ported from. `tests/compare/compare.spec.ts` replays each sequence on the site's dev page (`/?dev&noweather`) and checks it against the matching file here. It lives in its own Playwright project, so it only runs with `playwright test --project compare` (about a minute on the GPU), not with plain `playwright test` or `pnpm verify`.

## What was recorded

The spike was at commit `b4769a4`, except the two fast intro files and their six screenshots, which were taken again on 2026-10-19 from the workshop's `master` at `83541ed`, after `abb08c1` (the phone opens as the page fades in) was merged into the spike and ported. The other eight files came out the same at `83541ed`, with a largest difference of 0, so they weren't replaced. The spike was served by its own Vite dev server and driven by `tools/compare/record.mjs` in Playwright's Chromium on the GPU, through ANGLE on the desktop OpenGL driver (an RTX 3080 on driver 615.78 when they were taken on 2026-10-18). The matrices don't depend on the renderer, but the screenshots do, so the compare project and the recorder launch Chromium the same way, and `PW_GPU=0` puts both back on SwiftShader. Screenshots taken on one renderer won't match the other, and a driver update could move a few pixels, in which case they're taken again. The browser context is 1400 by 850 at device scale 1, with the time zone `America/Vancouver`, the locale `en-US`, a fixed user agent, no mouse movement, `?noweather`, and `page.clock.install({ time: "2026-10-17T12:00:00Z" })` before the page loads. `localStorage["duo-battery-start"]` is set to two minutes before that time, except in the charger sequences, where it is set so the drain reaches 1% two seconds after the sequence starts.

Each file is named `<ORIENTATION>-<SEQUENCE>.json.gz` (gzipped JSON, read with Node's `zlib`). The orientations are `landscape` and `portrait` (set through `#device-select`). The sequences are listed below.

- `full-intro` is the full intro, started with `#replay-full`.
- `fast-intro` is the fast intro, started with `#replay-fast`.
- `about` opens the About app (a pushed `#about` address and a `popstate` event) and closes it again with the escape key 50 frames later.
- `phone` calls `window.spike.closePhone()`, then `window.spike.openPhone()` 75 frames later.
- `charger` records the cable plugging in, with no action.

Every file has the shape `{ step_ms: 16, frames: [{ t, root, parts, bones, screenshot? }] }`. The clock is paused, and each step is `page.clock.runFor(16)`, one animation frame. A frame holds `root` (the `state.root` matrix), `parts` (the `state.flap`, `state.body`, `state.hinged`, `state.pivot`, and `state.hingeTurn` matrices that exist, which carry the fold, the hinge, and the portrait roll) and `bones` (every matrix in `state.handModel.bones`, 45 of them), each as 16 numbers in camera space. A matrix entry that isn't finite fails the recording and the spec. `frames[0]` is the frame in which the sequence's first action ran, and `t` is the step number times 16.

The fixtures are rounded to 6 significant digits and gzipped to keep them small, and values under 1e-7 are written as 0. The largest entry is about 47, so rounding moves an entry by at most 5e-5.

At the frames that have a `screenshot`, every screen material's `map` is swapped for a 64 by 64 checkerboard for that one frame, with every element except the canvas hidden (the app's page is html behind the canvas), and the page is saved next to the fixture as `<ORIENTATION>-<SEQUENCE>-<FRAME>.png`. The checkerboard is a `Texture` made from a canvas (taken from the existing map's constructor), since the page has no `THREE` global to build a `DataTexture` with.

## Tolerance

The spec allows 1e-4 per matrix entry and 0.5% of pixels differing (any channel more than 16 levels off) in each screenshot.

The spike was recorded twice more on the GPU on 2026-10-18 (the same RTX 3080 and driver 615.78), with the same script, and the two runs were compared entry by entry with `node tools/compare/record.mjs --diff <DIR_A> <DIR_B>`. The largest difference over all 10 files was 0 (a missing file, a frame count mismatch, or a non finite entry counts as a failure), and each run's matrices also matched the committed fixtures with a largest difference of 0. Ten times the largest difference is 0, so the floor of 1e-4 applies. That floor is also above the 5e-5 rounding error described above. The screenshots don't repeat exactly on the GPU. Of the 32, 31 had the same bytes in both runs, and `portrait-about-60.png` had 13 of its 1,190,000 pixels off by at most 10 levels in one channel, which is below the 16 level step, so no pixel counted as different. The first run's screenshots all had the same bytes as the committed ones, and the second run's differed only in that file. The 0.5% allowance leaves room for that sort of noise and for a small driver change.

The runs only matched once every action started on an animation frame, since a tween started between frames took its start time from a clock that was a millisecond off from run to run. The clock is paused at a multiple of 16 ms after install, and every sequence starts at the same fake time.

## Recording again

Serve the spike at `83541ed` or later, as long as `--diff` against these files shows only the change being recorded (its `spikes/device-3d` folder, with `pnpm exec vite --port 5173 --strictPort`), then run `node tools/compare/record.mjs --out <DIR>` from `site/`. Use `--base`, `--only`, and `--orientation` to change the address or record a single file. A full run takes about a minute on the GPU, against about 25 minutes on SwiftShader.
