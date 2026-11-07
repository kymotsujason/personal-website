# The 2D scene's capture tool

`capture.mjs` renders the 2D scene's frames out of the 3D scene: the hands and the phone with its three screens cut out, at each fold or moment a set needs. It also saves where the screens' and the halves' corners land in each frame, the drag's tables, `foldStartTime`, the volume buttons' hit areas, and the desk's cube faces.

## Running it

The tool drives the dev server on port 4321 in headless Chromium on the GPU, so start that first from `site/`:

```sh
pnpm --dir apps/web dev
```

Then capture a set at a lighting:

```sh
node tools/capture-flat/capture.mjs --set <SET> --lighting <day|dusk|night>
```

Replace `<SET>` with a set name from `SETS` in `capture.mjs`. Day is 13:00, dusk 19:00, and night 23:00, each with sunrise at 7 and sunset at 19.

The sets are these:

- `landscape`, `portrait-open`, and `portrait-close`, the folds on each path. `portrait-open` starts with the lead, 19 frames at fold 1 with the hands going from fold 1 to 0.99 over `LEAD.time` (as `leadTo` eases it), and leaves out the folds above 0.99, where the hands hold at the lead's end.
- `charger-landscape-open`, `charger-landscape-closed`, `charger-portrait-open`, and `charger-portrait-closed`, the charger's plug run with the phone at rest, stepped through the charger's own `step` at 1/60 s and frozen at each step with `debugAt`. The last frame is the run's end, with the plug in. The phone's own move during a run (`fitInView`, the tilt, the shake, the sag, and the bump in `loop.js`) is left out, since the capture sets the charger's `lift`, `bump`, and `handOff` to 0, so the 2D scene makes that move with CSS.
- `cable-landscape`, `cable-portrait-open`, and `cable-portrait-close`, the same folds as the sets without the cable, with the cable in.
- `volume-landscape` and `volume-portrait`, each button pressed all the way in with the phone at rest, open and then closed.
- `desk`, the desk's cube faces alone, which every set at that lighting shares.

Landscape is captured at a 1280 by 800 window and portrait at 600 by 800 (an iPad held upright). Both windows fit the open phone's height to the same 688 px, but that height is the phone's 16.46 cm side in portrait and its 11.78 cm side in landscape, so portrait draws the phone at about 0.72 of landscape's px per cm (the body's long edge is 492.4 px at fold 0, against 688 px). The charger's sets pin the battery just after it starts charging, which loads the charger with the cable in, and the others hold it full.

The raw output lands in `.media/flat/<SET>-<LIGHTING>/`, which git ignores, and a run starts by deleting that folder. A landscape set is 120 frames and took about a minute on the dev PC.

## What it writes

- `NN.png` frames in the order of `frames.json`, zero padded to at least two digits (three once a set has 100 frames or more), at the window's size plus the margins (320 px each side, 160 above, 200 below), straight alpha, with the screens cut out by the two key colors
- `frames.json` with each frame's `fold`, `lead`, `hand` (the hands' fold), `t` (the ms since a lead or a charger run started, null outside one), `press` for a volume frame (`near` or `far`), and its corners in the window's px (add the margin to place them on the frame): the screens as cover, flap, and body, their depths from the camera, and the body's and flap's outer corners, each in the order top left, top right, bottom right, bottom left of the part's own frame
- `meta.json` with the set, the lighting, the orientation, the window, the margin, the light, portrait's `path`, `foldStartTime`, `dragTable` for the fold sets (for `close` and `open`: the axis, the sign, the 481 samples as `[fold, x, y]` of the flap's outer edge, and the built table of progress through the fold for each px of pointer travel, as `fold.js` builds it, which `foldPoseAt` turns into the fold and the move), `charger` (a run's `total` and `step` in ms, or `{ in: true }` for a cable set), `volume`, and `inputsHash`
- `desk-<FACE>-<sharp|blur>.png` for each cube face the desk photo reaches, rendered through a 90 degree camera, in the `desk` set only

A volume set's `meta.json` has `volume.up` (the button that turns it up) and, under `volume.poses.open` and `volume.poses.closed`, each button's `frame`, `box`, `hit`, and `hull`. A press's frame holds the pressed picture inside `box` (`[x, y, w, h]` in the frame's px) and nothing outside it. It takes the place of that box over the rest frame instead of going over it, since the sunk button also uncovers what was behind its edge. `box` is null when the press changes no pixel, which is what the closed phone shows from the front. `hit` is the four corners of the hit box's face toward the camera and `hull` the outline of all eight of its corners, which is the whole area a press lands on (`volume.js` `REACH`), both in the window's px.

## Packing a set

`pack.mjs` turns a captured set into what the page loads, at full size and half size (the capture scaled to half in each direction before it's cut):

```sh
node tools/capture-flat/pack.mjs --set <SET> --lighting <day|dusk|night> [--size full|half]
```

It writes `apps/web/public/flat/<SET>-<LIGHTING>-<SIZE>/` with an `a###.webp` atlas for each frame that has new pieces and `manifest.json`. The manifest carries `meta.json`'s fields, with every px value (the window, the margin, the corners, the drag's samples, span, and table, and the volume buttons' boxes and hit areas) in the packed set's own px, and `scale` says how that relates to the capture. Its `desk` names the folder with that lighting's and size's desk faces.

The set `desk` packs the desk's faces into `apps/web/public/flat/desk-<LIGHTING>-<SIZE>/` as `desk-<FACE>-<sharp|blur>.webp`, with a manifest of the faces, their size, and the light.

At half size, a pixel is drawn only where the 2 by 2 full size pixels under it have any drawn pixel, so the resize's faint ring past the drawing doesn't make the pieces larger. Each pack also writes the folder's `decodedBytes` (every image at 4 bytes a px) and `downloadBytes` (every file, the manifest included) into `apps/web/public/flat/sizes.json`. Each frame lists its `pieces` as `[x, y, w, h, sx, sy]` (the piece's place in the frame and its top left in the frame's atlas) and its `shared` pieces as indexes into the top level `shared` list, each an atlas and a piece. Show each piece `overlap` px larger on every side. Every image goes on `privacy-allowlist.json` before it's written, and outputs left over from an earlier pack are taken off the list and deleted.

## Checks

The capture fails if the light isn't the pinned hour with the default sunrise and sunset, if the hands in the first pass aren't at the pose the scene reports for that step, or if a frame's screen corners, halves' corners, or hands land more than 2 px from where the first pass saw them. A charger step also fails if stepping the charger by 1/60 s from the frame before lands the hands more than 0.05 px from freezing it at that time. It also fails if the scene failed or the battery moved during the run.

`inputs.json` lists the files a capture depends on, and `inputsHash` is a sha256 over them, so a set can be checked for going out of date.

The pure parts have tests:

```sh
node --test tools/capture-flat/capture.test.mjs tools/capture-flat/pack.test.mjs
```
