# Rebaking the grips

How `keys/*-authored.json`, `keys/*-baked.json`, and `keys/support.json` were made in the grip contact work of
2026-10-15 (`docs/superpowers/plans/2026-10-15-grip-contact.md`), with the left hand redone the same day to stop it
shaking and passing through the right hand. Every search is random, so the same steps give a different bake each run,
and the recipe keeps the best of a few runs at each stage. Portrait was redone on 2026-10-16 with grips posed by eye in
the spike's pose editor (see Portrait below), so the bake sections are landscape's.

Since 2026-10-17 the page is the site's dev page, and the paths here are from `site/apps/web`, where the keys live in
`public/keys/` and the dev server's `/__save` writes them. The authored keys, `smoothKeys.py`, and the `tools/*.js`
scripts named below stay in the workshop's `spikes/device-3d/`, so copy an authored file into `public/keys/` before a
stage that fetches it, and take it out again before a commit.

The scripts run in the dev server's page (`pnpm -C site/apps/web dev`, then `http://localhost:4321/?dev&noweather`)
through the Playwright MCP. Set `#device-select` to the orientation and wait about 8 seconds before each stage, and
reload after a key file is saved so the page imports it. `browser_run_code_unsafe` has no `require`, so it can't write
files. Results are saved with `browser_evaluate`'s `filename` and written out by `saveKeys.py`.

Two things in the page can spoil a measurement or a bake without any error:

- `spike.show(keys, fold)` only sets the fold the render loop applies on its next frame. Anything measured in the
  same call sees the phone at its old fold, so wait two animation frames after `show` before measuring.
- The battery drains to 1% about 8 minutes after it's pinned, and the charger then takes the left hand away and moves
  the right into its one handed grip. Pin `#battery-time` to 120 (then `input`) before every chunk of a bake, and
  stop if `spike.charger().busy()` or `plugged()` is true.

## Authored keys

Each held key (every key whose frame isn't `device`) is searched again with `spike.touch`, which scores like a holding
bake step and keeps the best of 5 runs. Call it twice per key and keep the result with the lower cost plus screen
points, since a finger on the open screen scores no worse than one on the frame. Save the result with
`filename: site/apps/web/.bake-authored.json`.

The right hand's keys are touched alone. The left hand's are touched with the right hand where its baked keys put it
(`{ wOther: 4000 }`), since left grips touched without it sat 0.2 to 0.6 cm inside the right hand, and a left bake
that has to stay out of the right hand then drifted 1.5 to 3.6 cm off them. In landscape the left hand's three grips on
the flap come from `tools/mirrorGrip.js` instead, as the mirror of the right hand's open grip. The script below is the
right hand's form, and for the left pass `{ Left: authored.Left, Right: <BAKED_RIGHT> }` as the keys and
`3, { wOther: 4000 }` after the default arguments, where `<BAKED_RIGHT>` is the right hand's keys from
`spike.handKeys()`.

```js
async () => {
    const s = window.spike;
    const which = s.state.portrait ? "portrait" : "landscape";
    const authored = await (await fetch(`/keys/${which}-authored.json`, { cache: "no-store" })).json();
    const out = { Left: [], Right: [] };
    ["Right", "Left"].forEach((side) => {
        authored[side].forEach((key) => {
            if (key.frame === "device") {
                out[side].push(key);
                return;
            }
            let best = null;
            for (let i = 0; i < 2; i++) {
                const t = s.touch(side, key.fold, key.frame, authored);
                const score = t.cost + s.state.hands.fingersOnScreen(side, key.fold);
                if (!best || score < best.score) {
                    best = { score, key: t.key };
                }
            }
            out[side].push(best.key);
        });
    });
    s.rekey();
    return out;
}
```

Then `cd site/apps/web && python3 tools/saveKeys.py .bake-authored.json public/keys/<ORIENTATION>-authored.json && rm .bake-authored.json`, where `<ORIENTATION>` is `landscape` or `portrait`.

A touch takes about 37 s, so this stage is several minutes per orientation.

## Right hand

The right hand bakes alone, holding throughout, 160 steps, riding `body`. The code below also handles portrait, which
was baked this way until 2026-10-16. Load the authored keys first. Every run stays in the page, so don't reload until the bake is saved.

```js
async () => {
    const which = window.spike.state.portrait ? "portrait" : "landscape";
    const authored = await (await fetch(`/keys/${which}-authored.json`, { cache: "no-store" })).json();
    window.bakeRun = { authored, done: [], steps: which === "portrait" ? 200 : 160, runs: { Right: [], Left: [] } };
    return authored.Right.length;
}
```

Then run this chunk call until it returns `steps + 1` (161 or 201). Each call bakes 40 steps.

```js
() => {
    const r = window.bakeRun;
    window.spike.bake("Right", r.authored, r.steps, () => "body", r.done.length, r.done.length + 39, r.done, 0, () => 1);
    return r.done.length;
}
```

Once it does, score the run and put it aside with this call, then run the chunk call again from an empty run. Each
baked step carries the `deviceMax` its search ended on, which is what to count, since a sweep straight after a bake
plays the authored keys (`spike.bake` sets them at every step) and gives every run the same count.

```js
() => {
    const r = window.bakeRun;
    const steps = r.done;
    let largest = 0;
    for (let i = 1; i < steps.length; i++) {
        const a = steps[i - 1].pose;
        const b = steps[i].pose;
        largest = Math.max(largest, Math.hypot(b.px - a.px, b.py - a.py, b.pz - a.pz));
    }
    const side = r.right ? "Left" : "Right";
    r.runs[side].push({ steps, over: steps.filter((st) => st.deviceMax > 0.16).length, worst: Math.max(...steps.map((st) => st.deviceMax)), largest });
    r.done = [];
    return r.runs[side].map((run, i) => ({ run: i, over: run.over, worst: +run.worst.toFixed(2), largest: +run.largest.toFixed(3) }));
}
```

Bake it 2 or 3 times. Keep the run with the fewest steps over 0.16 whose `largest` stays under the limit, which is the
old bake's largest step for that side (from `saveKeys.py` on the old file) or 0.5 cm, whichever is larger. Three
runs of the same code gave 123, 42, and 11 steps over.

## Left hand

The left hand bakes around the kept right hand. Set `KEPT` to the kept run's number from the list above.

```js
() => {
    const KEPT = 0;
    const r = window.bakeRun;
    r.right = r.runs.Right[KEPT].steps;
    r.withRight = { Left: r.authored.Left, Right: r.right.map((s) => ({ fold: s.fold, frame: s.frame, pose: s.pose })) };
    r.done = [];
    return r.withRight.Right.length;
}
```

In landscape the left hand reaches in on `device` above fold 0.3, takes the flap below it, and its contact pull ramps
in over 0.06 of fold. In portrait it holds `body` throughout. Both use `wOther` 4000, since at 400 the left hand
pressed 0.40 to 0.44 cm into the right in portrait and up to 0.28 cm in landscape.

```js
() => {
    const battery = document.getElementById("battery-time");
    battery.value = "120";
    battery.dispatchEvent(new Event("input"));
    if (window.spike.charger().busy() || window.spike.charger().plugged()) {
        throw new Error("the charger is busy, so the right hand isn't at its keys");
    }
    const r = window.bakeRun;
    const portrait = window.spike.state.portrait;
    const frameFor = portrait ? () => "body" : (fold) => (fold >= 0.3 ? "device" : "flap");
    const holdFor = portrait ? () => 1 : (fold) => Math.min(Math.max((0.3 - fold) / 0.06, 0), 1);
    window.spike.bake("Left", r.withRight, r.steps, frameFor, r.done.length, r.done.length + 39, r.done, 4000, holdFor);
    return r.done.length;
}
```

Run it until it returns `steps + 1`, then score it with the same scoring call, which files it under `Left` once a
right hand is kept. Bake it twice, and keep the run with fewer steps over 0.16. Save it with
`filename: site/apps/web/.bake.json`, with `KEPT` set to that run's number.

```js
() => {
    const KEPT = 0;
    const r = window.bakeRun;
    return { Left: r.runs.Left[KEPT].steps, Right: r.right };
}
```

## Saving and smoothing

```bash
cd site/apps/web
python3 tools/saveKeys.py .bake.json public/keys/<ORIENTATION>-baked.json bake
python3 ../../../spikes/device-3d/tools/smoothKeys.py public/keys/<ORIENTATION>-baked.json public/keys/<ORIENTATION>-baked.json Right <SIGMA> keepEnds
python3 ../../../spikes/device-3d/tools/smoothKeys.py public/keys/<ORIENTATION>-baked.json public/keys/<ORIENTATION>-baked.json Left <SIGMA> keepEnds
python3 tools/saveKeys.py public/keys/<ORIENTATION>-baked.json public/keys/<ORIENTATION>-baked.json bake
rm .bake.json
```

`<ORIENTATION>` is `landscape` or `portrait`, and `<SIGMA>` is 3 in landscape and 4 in portrait. The last `saveKeys.py`
puts the file back in its compact form, since `smoothKeys.py` writes with spaces, and it reports the shake. Expect 0
turns back and 0 joint swings on both sides.

The smoothing is wide on purpose. Each baked step is its own random search, so a raw bake carries step to step noise
(the portrait left hand's joints about 1 to 2 degrees, its wrist about 0.1 to 0.2 cm), and the phone opens in about a
second, so every frame skips 3 or 4 keys and shows that noise as shaking. Sigma 1 left it visible. Sigma 4 in portrait
brought the left hand's back and forth over 0.05 of fold from 1.69 to 0.47 cm (master's was 0.22 to 0.56) with the hands
at most 0.05 cm into each other. In landscape the hands sit interleaved behind the phone, and sigma 4 or more pushed
them up to 0.44 to 0.47 cm into each other, so landscape stays at 3.

Then run `tools/backBake.js` with `ORIENT` set to `landscape`. A bake lands exactly on the key it starts from and
drifts toward the one it ends on, so a forward bake ends its hold wherever its steps took it, which lost the mirrored
open grip. The script bakes the left hand over the whole fold backwards, from its open grip at fold 0 up to fold 1,
since baking only the hold backwards and crossfading it into the forward bake put the thumb through the flap halfway
between the two. Save `window.backLeft` with `filename: site/apps/web/.bake.json`, then smooth its left hand at
sigma 3 and write it the same way as above.

Landscape's closed grip was redone on 2026-10-16 after Apple's product photo of the closed phone in one hand: the palm
on the back at the bottom right, the thumb up the right side, and all four fingertips curled round the hinge edge,
spaced down it. The old grip had the thumb on one side and only the little finger at the hinge. The top half sweeps
the space in front of and beside the hinge as it closes, so the fingers can only curl round it at the very end. Run
`tools/closedGripSearch.js` (the grip), `tools/closedGripHeld.js` (the same grip with the fingers held back behind
the phone, clear of the top half from fold 0.6 to 1), `tools/closedGripReach.js` (the fingers reaching out past the
hinge cover from behind, at 0.965), `tools/closedGripBlend.js` (the right hand's keys from 0.6 to 0.93 eased into the
held grip, then out past the hinge by 0.965 and round it to closed), and `tools/closedGripFix.js` until it stops
finding much. Curling straight from held back to wrapped took the fingertips through the hinge cover, which is why
the reach comes between. Then save `window.newLandscape` to `public/keys/landscape-baked.json` through the dev server's
`/__save` and run `tools/saveKeys.py` on it to write it compact and check the shake.

The hinge cover is a collision solid of its own since the same day (`state.hingeSolid` in `src/scene/device.js`, in the frame that
turns it), and a hard one: the halves' boxes stop at the hinge line, so fingers went through the cover unseen, and it's
only 0.13 cm thick, thinner than the 0.15 cm a holding hand's margin lets it sit inside, so `overlap` in `hands.js`
always keeps skin 0.05 cm off a hard solid. A depth in it can't read past half its thickness, so count any point in it
as a finger through it. On 2026-10-16, sampled every 0.005 of fold, the left hand never entered the cover in landscape,
the right only grazed it (0.01 cm at most) at 0.415 to 0.485, where the keys are the old bake's, and neither hand
entered it on either portrait path. From 0.5 to 0.97 the right hand went no deeper than 0.18 cm into the halves. The
charger slides this hand up along the hinge to make room for the plug (`clearRight` in `charger.js`), since a slide
across the phone dragged the hooked fingers into the hinge, and it checks the slide against the left hand opened to
let go as well as gripping, since the opened fingers reached the right hand by up to 0.48 cm.

After any landscape rebake, move the left hand's rest out of view again. From fold 0.6 to closed it rests at one pose
in the device frame, and at closed its fingertips showed in the bottom left corner of the window. On 2026-10-16 its
`px` and `py` were moved by -2 and -4 cm from fold 0.6 up, eased in from 0.45, which keeps its skin out of the window
by 0.47 of the half screen at 1400 by 850 and 1920 by 1080, and 0.21 at 1100 by 950, measured over a real close with
`spike.camera()`.

## Portrait

Portrait's grips are posed by eye in the spike's panel, under "Pose editor, portrait" (`poseEditor.js`), against photos
of people holding a foldable in portrait with a hand on each side. Its sliders move the right hand at each key, and
the left hand is fitted as the right's mirror on every change (`fitTurn` in `hands.js`, the thumb counted most). The
readouts show how deep each hand sits in the phone, how far the two hands pass into each other, and self contact.

Opening and closing take their own paths, since the thumbs lift the top half open and the index fingers push it shut.
The two paths share the closed grip at fold 1 and the open grip at fold 0, and each has its own keys in between, added
at the Fold slider with "Add key here". Play opens on the opening path, with the same 300 ms lead as the page (below),
and closes on the closing one, on a loop. In
the page, the hands take a path as the fold leaves either end (`state.foldPath` in `src/scene/loop.js`), so a fold turned back
half way keeps its path instead of jumping to the other.

The keys between the ends were first made by `tools/transitionKeys.js` on 2026-10-16 from the closed and open grips
Jason posed: on the opening path the right thumb rides the top half's free edge at fold 0.82 and 0.72, and on the
closing path the right index pushes on the top half's back 3.6 cm from the hinge at fold 0.1 to 0.3. Follow up runs of
the same search, not kept as tools, added the rest. Opening, at 0.995 and 0.9925 the thumb lifts off the closed
phone's front, at 0.99 it goes over the free edge, and from 0.97 to 0.87 it hooks under the edge from below. Those
keys sit in the first 0.01 of the fold, which the eased fold gets through in a few frames, so the page plays them
ahead of the fold: `leadOpen` in `src/scene/device.js` moves the hands along that stretch over 300 ms with the phone still closed
(before `openPhone`, before the intro's unfold, and on the press of a swipe that opens), and `handFold` holds them
there until the fold catches up. Closing, the index keeps pushing to 0.58, since the hinge only closes the rest of the
way past half. One hold, searched once at 0.84 with the little finger under the bottom edge, is the hand at 0.66,
0.78, and 0.84 with only the thumb searched, so the rest of the hand doesn't move there. The thumb rests low on the
front and then steps 1.4 cm across, just past the side edge, while the top half comes down past it. From 0.9 the hand
eases from the hold into the closed grip in even steps (15, 40, 65, and 88 percent at 0.9, 0.93, 0.955, and 0.98),
with the thumb back on the top half's outer face from 0.93, riding it shut.

On the way the little finger comes back round the bottom back corner to where the closed grip curls it. The corner
lies on the circle its tip sweeps round its knuckle, so any change of curl took it through the corner. At each key from
0.9 a scan sets its own curl and spread with no cap (the search keeps them within 25 degrees) to keep it 0.2 cm off
the phone while changing it as little as it can, which tucks it in tight as it passes. A check every 0.0025 of fold
then puts a key wherever a little finger still touches, sampled from the path with only the little finger tucked,
which added keys at 0.9125 and 0.9175 on 2026-10-16. Keeping the little finger under the edge in the closed grip
instead would have moved the whole closed grip 2 to 4 cm and the same corner trip into opening.

Portrait's keys are joined by `foldHermite` in `hands.js` (`setKeys(keys, { smooth: true })`), a curve through each
key with its slope taken from its neighbors over the fold between them. Easing in and out of each key, as few keys
otherwise are, stopped the hands at every one, which read as jerky with a dozen keys on a path. Move them in the editor from here.

On 2026-10-16 Jason lowered the hands along the phone ("up" in the editor) so the closed grip starts nearer the
opening keys, which had the wrist moving 2.6 cm in the lead and now 1.7. The right hand's "up" went to -14.5 closed,
-16.5 open, and -13.55 at 0.58 closing, and every key between moved by an amount interpolated by fold between those
(on the opening path, only from 0.72 to open, so 0.995 to 0.72 stay where they were). Lower, the index went through
the top half for the whole push, since the top half leans over the hand there, so the same kind of scan as the little
finger's sets the index's curl and spread at each push key to sit it 0.08 cm off the top half's back (6 degrees of
curl at most). Further scans of the same kind cleared the left ring finger in the open grip (2 degrees), the thumbs'
middle joint near 0.91 closing and near 0.76 opening, and added keys at 0.595, 0.91, 0.915, and 0.76 where a finger
still went in. The left hand's scan changes are lost when the editor saves, since it fits the left hand to the right
again, so run the scans again after a save.

Check a path for any skin point inside either half (`detail` hits), not for depth. Each half is 0.52 cm thick, so a
finger all the way through one still reads no deeper than 0.26 cm. Sampled every 0.0025 of fold on 2026-10-16, no
finger enters the phone on either path below fold 0.96. Above it is the closed grip itself, whose index sits up to
0.26 cm into the bottom half's back from 0.9625 closing and 0.9975 opening, as it did before the hands were lowered.

Save writes `public/keys/portrait-grips.json` as `{ open: { Right, Left }, close: { Right, Left } }`, and the page takes it
on the next reload. Edits are kept in the browser's localStorage until saved, and "Revert to file" drops them.

Searched two handed grips were tried on 2026-10-15 and 2026-10-16 and dropped. Bakes of both hands shook and crossed
fingers behind the phone, and grips searched to keep each hand's fingers on its own half curled them under the phone,
so it looked perched on the hands. The rig also had no way to spread a finger until the editor added one (`sI` to
`sP`, toward the thumb, at the base joint).

## Support grips

The charger's one handed grips (`keys/support.json`) are searched again in each orientation with `wOther` 0, since
the left hand is away for the cable while they hold. Keep the better of 2 calls the same way as the authored keys.

```js
async () => {
    const s = window.spike;
    const support = await (await fetch("/keys/support.json", { cache: "no-store" })).json();
    const which = s.state.portrait ? "portrait" : "landscape";
    const out = {};
    Object.entries(support[which]).forEach(([state, grip]) => {
        let best = null;
        for (let i = 0; i < 2; i++) {
            const t = s.touch("Right", grip.fold, "body", { Left: [], Right: [{ fold: grip.fold, frame: "body", pose: grip.pose }] });
            const score = t.cost + s.state.hands.fingersOnScreen("Right", grip.fold);
            if (!best || score < best.score) {
                best = { score, grip: { fold: grip.fold, pose: t.key.pose }, gaps: t.gaps, deviceMax: t.deviceMax };
            }
        }
        out[state] = best;
    });
    s.rekey();
    return out;
}
```

Join the two orientations' results and write them compact, with only `fold` and `pose` per grip:
`json.dump({"landscape": {...}, "portrait": {...}}, open("public/keys/support.json", "w"), separators=(",", ":"))`.

### Portrait charger pinch

In portrait the port is on the phone's left side, and the key grip in `charger.js` (the plug pointing out of the top
of the fist) turned the left hand about 107 degrees to line up with it, so the forearm came in from the side. Since
2026-10-16 portrait uses a pinch instead (`keys/pinch.json`, passed to the charger as `getPinch` in `src/scene/device.js`): the
thumb's last segment on the plug's front face, the index's last segment on its back face, and the wrist below the plug
and left of the phone, the way people hold a cable they're about to plug in. `tools/pinchSearch.js` searched it, open
and closed, and `tools/pinchRelease.js` searched how each lets go (only the thumb and index move, to 0.3 and 0.2 cm off
the plug) and saved the file. Each pinch is posed with the plug in the port, so the hand keeps that pose relative to
the plug on the way in. The hand now turns at most 48 degrees from its hold open and 44 closed. Through a plug in, it
doesn't enter the phone or itself, and touches the plug once, 0.07 cm as it lets go. The right hand's 0.15 to 0.26 cm in the
phone while it holds alone open, and the hands' 0.12 cm into each other, read the same before the pinch.

## Checks

THE CHECK, run after a reload with the keys under test. `fails` counts held rows where the thumb or palm is more than
0.05 cm off, or fewer than 3 fingers are within 0.05.

```js
() => {
    const s = window.spike;
    const landscape = !s.state.portrait;
    s.rekey();
    const rows = s.state.hands.sweep(80).rows;
    // landscape's left hand only holds once it rides the flap, fully from fold 0.24
    const held = rows.filter((r) => r.side !== "both" && !(landscape && r.side === "Left" && r.fold > 0.24));
    const fails = held.filter((r) => {
        const c = r.contact;
        const fingers = ["index", "middle", "ring", "pinky"].filter((g) => c[g] <= 0.05).length;
        return c.thumb > 0.05 || c.palm > 0.05 || fingers < 3;
    });
    const worst = (field) => Math.max(...rows.filter((r) => field in r).map((r) => r[field]));
    // the reaching left hand at fold 1, which has to stay off the phone
    const reaching = landscape ? rows.find((r) => r.side === "Left" && r.fold === 1).contact : null;
    return { held: held.length, fails: fails.length, firstFails: fails.slice(0, 6).map((r) => ({ fold: r.fold, side: r.side, contact: r.contact })), deviceMax: worst("deviceMax"), selfMax: worst("selfMax"), betweenMax: worst("betweenMax"), reaching };
}
```

What the 2026-10-15 bakes measured, as a floor to compare a new bake against:

| Orientation | Fails | `deviceMax` | `betweenMax` | `selfMax` |
|---|---|---|---|---|
| Landscape | 65 of 101 | 0.26 | 0.38 | 0 |
| Portrait | 118 of 162 | 0.25 | 0.05 | 0 |

Portrait's posed grips haven't been measured here yet.

THE CHECK doesn't see shaking, so also step the fold from 1 to 0 in 0.002 steps (waiting two frames after each
`show`) and measure each fingertip's path length less its displacement over every 0.05 of fold. The 2026-10-15 keys
measured at most 0.35 cm on the landscape left hand, 0.47 on the landscape right, 0.47 on the portrait left, and 0.10
on the portrait right.

Then run `tools/checkCharger.js` (the hold through a plug and unplug), and retake the review sheet with
`tools/captureGrips.js` and `python3 tools/gripSheet.py art/grips`.
