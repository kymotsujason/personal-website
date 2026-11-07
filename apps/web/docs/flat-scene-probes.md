# 2D scene speed probes

These are the measured answers Task 10 set out to find, taken on 2026-11-07 with `tests/prod/flat-probes.spec.ts` (run with `pnpm exec playwright test --project=prod tests/prod/flat-probes.spec.ts --workers=1`). The probes log numbers and assert only that they ran. The machine has an RTX 3080, and Playwright's Chromium renders on it through `--use-angle=gl` unless a probe says SwiftShader.

## How frames were timed

Each loop updates the scene once per animation frame and records the gap between frames, the time the update itself took, and the page's long animation frames. Headless animation frames lock to 16.7 ms here, so a gap of 16.7 ms means the frame was ready and anything above it is a missed frame. The numbers compare variants on one machine and aren't a phone's frame rate. The CPU probes use CDP `Emulation.setCPUThrottlingRate` at 4x, which slows the main thread only, so GPU raster work isn't slowed by it. That is why the SwiftShader runs below are the harder test.

## Live HTML against the canvas picture while moving

The loop sways the pose (`ry` and `rx`) and steps through the unfold's frames, so every frame has new screen corners and a new `matrix3d` chain under the screens. It ran 180 frames per variant.

| Variant                     | Median ms | p95 ms | Frames over 33 ms | Update ms (p95) |
| --------------------------- | --------- | ------ | ----------------- | --------------- |
| Live HTML, GPU, 1x CPU      | 16.7      | 16.7   | 0                 | 0.3             |
| Canvas picture, GPU, 1x CPU | 16.7      | 16.7   | 0                 | 0.2             |
| Live HTML, GPU, 4x CPU      | 16.7      | 16.8   | 0                 | 1.0             |
| Canvas picture, GPU, 4x CPU | 16.7      | 16.8   | 0                 | 0.9             |

Under SwiftShader (the stand-in for an old phone, 120 frames each) the live HTML had 38 frames over 33 ms with a p95 of 133 ms and 38 long animation frames, while the picture had 9 frames over 33 ms with a p95 of 67 ms and 8 long animation frames. The picture's worst frame was longer (1383 ms against 150 ms), so both janked, but live HTML had about four times as many slow frames. The first run agreed on the direction (31 against 12 slow frames), though its 1x CPU picture row measured faces with no canvas drawn, so these figures are from the rerun that draws the pictures first.

Drawing the pictures of the three faces once took 1 to 6 ms at 1x CPU and 6 to 24 ms at 4x, so a draw just before each motion is cheap.

### Crop check for missing text strips

At four folds (0.15, 0.35, 0.55, 0.75) with the phone tilted (`ry` 0.3, `rx` 0.1), the probe screenshots the live HTML and the picture of the same state, then compares each pixel row's horizontal edge energy. A row counts as a missing strip when the picture has detail there and the live HTML has under a fifth of it. No rows were flagged at any fold (0 of 720 each), and the live layer's total edge energy was 1.09 to 1.28 times the picture's. The check only sees a strip that is blank across the whole row, so a partial strip would pass. It found none on the GPU, and it wasn't repeated on SwiftShader.

## Clip path on `#page` during an app open, under SwiftShader

The probe grows `#page` from a small box to the whole screen over 20 frames through `placePage("pinned")`, with and without a `clip-path: inset(...)` that changes every frame, on Chromium with `--use-angle=swiftshader` at 1280 by 800.

| Variant        | Median ms | p95 ms | Worst ms | Frames over 33 ms | Wall ms for 24 frames |
| -------------- | --------- | ------ | -------- | ----------------- | --------------------- |
| No clip path   | 16.7      | 16.8   | 100      | 1                 | 520                   |
| With clip path | 16.7      | 433    | 517      | 7                 | 1896                  |

The clip path is not the 25 second first frame the 3D scene hit. It still makes a quarter or more of the frames take 400 to 520 ms on a software renderer, against one slow frame without it. The spec says the plan comes back to Jason with options if this is slow, so it goes into the final report as a concern. The options are to clip with a mask made ahead of time, to drop the clip on a device that gets half size frames, or to accept it.

## Visibility against opacity frame flips

The probe flipped between frames 240 times at 4x CPU. The default `.flat-frame.on { visibility: visible }` and an override of `opacity: 0` with `.on { opacity: 1 }` (all frames kept visible) both held 16.7 ms with no frames over 33 ms and no long animation frames. Both had the same layer tree of 14 layers and 37.9 MB (the layers' width times height times 4, from CDP `LayerTree`), so opacity gave the frames no layers of their own here. Keep `visibility`, since it also skips painting the hidden frames.

## Set sizes against the budgets

Per set sizes come from `public/flat/sizes.json` (day lighting only, and dusk and night are a little smaller). A visit adds the sets the orientation needs. The probe's own decode of the 120 landscape full atlases gave 300.2 MB, matching the file.

| Visit                        | Full decoded MB | Full download MB | Half decoded MB | Half download MB |
| ---------------------------- | --------------- | ---------------- | --------------- | ---------------- |
| Landscape (cable, desk)      | 343.8           | 2.91             | 97.4            | 1.95             |
| Landscape and charger sets   | 695.1           | 5.42             | 197.2           | 3.81             |
| Portrait (open, close, desk) | 482.3           | 5.48             | 144.3           | 3.86             |
| Portrait and charger sets    | 880.8           | 8.82             | 257.5           | 6.27             |
| Budget                       | 160             | 1.2              | 60              | 0.6              |

Every row misses both budgets. The landscape cable set and desk alone are about 2.1 times the full decoded budget and 1.6 times the half one. Jason's answer is to build on and report, so nothing changed. The download budget is for what loads before the first frame, which these visit totals overstate. The landscape cable set alone is 2.61 MB at full and 1.82 MB at half, which is still over.

## Half against full frames, and PHONE_PX_FULL

The phone's height on screen is `phoneHeightPx` in `src/flat/frames.js`, worked out from the same `place()` that puts the phone and multiplied by the device pixel ratio. It gives 688 px for an 800 px tall window at a ratio of 1, as the capture assumes. The probe showed only the frames (screens and `#page` hidden) with the half and the full set at the same phone height, and compared the pixels where a frame drew something. Sharpness is the half set's edge energy over the full set's, and RMSE is in luma levels out of 255.

| Phone px        | Pixels drawn | RMSE | Sharpness |
| --------------- | ------------ | ---- | --------- |
| 344             | 187541       | 1.22 | 1.018     |
| 450             | 322562       | 1.90 | 0.977     |
| 550             | 481496       | 2.38 | 0.974     |
| 650             | 672820       | 2.16 | 0.976     |
| 750             | 894906       | 1.89 | 0.978     |
| 900             | 1291218      | 2.08 | 0.976     |
| 800 at 2x ratio | 1016891      | 2.60 | 0.967     |

The half frames lose about 2 to 3 percent of their edge energy once they're scaled up, and the loss doesn't grow from 450 px to 900 px. So the numbers can't pick a threshold alone, and they don't show how it looks to a person, which Jason hasn't judged at these sizes. The rule chosen is that the full set is used once the phone is at least 600 device px tall (`PHONE_PX_FULL = 600`). At that height the full frames are shown at most 13 percent below their native 688, and the half frames would be enlarged 1.74 times. The 2560 by 1440 screens Jason judged clean were full frames enlarged 1.8 times, so half frames enlarged by less than that are inside what he accepted. A 1280 by 800 window at a ratio of 1 measures 688 and gets full frames, which puts a typical desktop on the full budget. If that proves too heavy, raising the constant to 700 moves those windows to half frames at a measured 2 to 3 percent edge loss.

## The choices

While the phone moves, the 2D scene uses live HTML, and this choice is provisional until it runs on a real old phone, since the one test that told the two apart (SwiftShader) favored the picture. On a GPU the live layer matched the picture with no missed frames at 4x CPU and showed no missing strips. On software rendering the picture janked less, so the canvas picture stays as the fallback for a device the scene already counts as slow (the half size path and `2dAuto`). The code for it (`screens.picture()` and `showPicture(on)`) is already in `src/flat/screens.js`. `PHONE_PX_FULL` is 600.

## The test hook and the shipped build

`window.__flat` comes from `src/flat/probeHook.js`, and `src/flat/index.js` imports it only under `if (__CAPTURE__)`, the same flag that gates `window.__capture`. It has `stage`, `frames`, `screens`, `manifest`, `ready`, `setPose(pose)`, `setFold(fold, lead)` (which also places the screens on that frame), `mount({ set, lighting, size })`, and `unmount()`. It mounts a stage and the screens on its own (landscape or portrait by the window, lighting by the hour, size by `sizeFor`) and shows the rest pose at fold 0, the open phone. The ruling said fold 1, but fold 1 is the closed first frame, and the probes need the open home screen.

To check the shipped build, I built with `CAPTURE=0 pnpm exec astro build --outDir dist-ship-check` and searched every file for `__flat`, `installFlatHook`, and `probeHook`. The only match was `__flatShown`, the layout's own flag, and `_astro` had no probe chunk. The same search on a `CAPTURE=1` build found `installFlatHook` 4 times, `probeHook` twice, and one `window.__flat`. Both folders were deleted afterwards.

## Limits

Headless frame gaps lock to vsync and the CPU throttle doesn't slow the GPU, so only the SwiftShader runs stress the paint path. No probe ran on a real phone. The crop check is a row based heuristic. The half against full test used one scene (landscape, day, fold 0), and a person hasn't looked at its screenshots.

## Final measurements

These were taken on 2026-11-07, at the end of the build.

The 2D module (`flat.*.js`) is 91.6 kB minified and 35.0 kB gzip, over the 30 kB gzip target by 5 kB. The charger, volume, and music chunks it loads later are 5.2, 1.7, and 1.5 kB gzip. The scripts before the first frame total 250.3 kB gzip.

The charger now decodes only the set for the phone's current half, and only near a plug, during a run, or from 90% while charging. So a visit's peak at full size, day lighting, is about 563 MB in landscape and 719 MB in portrait (the larger fold version, one charger set, and 44 MB of desk), down from the 695.1 and 880.8 MB in the table above. Every visit still misses the 160 MB and 60 MB decoded budgets and the 1.2 MB and 0.6 MB download budgets, as Jason chose to build on and report.

A fresh capture of the landscape set at day matched the committed one. Its corners and drag tables were identical (34,703 numbers, largest difference 0), and 119 of its 120 atlases were identical. The other differed in 137 pixels by more than 8 levels (largest 27), which is GPU render noise. So the sets weren't captured again, and each manifest's `inputsHash` was brought up to date, with every shared scene module now listed in `tools/capture-flat/inputs.json`.

The Playwright prod, ship, and firefox projects passed 259 of 259 in one run with one worker. The compare project passed 23 of 23 in Task 19's last run, and its outline check measured at most 1.00 px between the 3D and 2D silhouettes. WebKit couldn't run on this machine, since it's missing system libraries (`libicu74`, `libxml2`, and `libflite1`), so the Safari checks are left for Jason's iPhone.
