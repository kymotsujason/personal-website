import * as THREE from "three";
import { fitTurn, LIMITS } from "../scene/hands.js";

// a panel section for posing the portrait grips by eye: sliders for the right hand at each key, the left hand fitted
// as its mirror on every change, and readouts of how deep each hand sits in the phone and in the other hand. opening
// and closing take their own paths (the thumbs lift the top half open, the index fingers push it shut), sharing the
// closed and open grips at the two ends. edits are kept in localStorage, and Save writes keys/portrait-grips.json
// through the dev server

const FILE = "portrait-grips";
const STORE = "poseEditor.portrait";
const ENDS = ["1", "0"];
const PATHS = { open: "Opening, thumbs", close: "Closing, index fingers" };
const JOINTS = ["c1", "c2", "c3", "dI", "dM", "dR", "dP", "sI", "sM", "sR", "sP", "t1x", "t1z", "t2", "t3"];
const SLIDERS = [
    { title: "Position, cm", params: [["px", "across", -16, 16, 0.05], ["py", "up", -26, 14, 0.05], ["pz", "out", -10, 10, 0.05]] },
    { title: "Turn, degrees", params: [["yaw", "yaw", -90, 90, 0.5], ["pitch", "pitch", -90, 90, 0.5], ["roll", "roll", -90, 90, 0.5]] },
    { title: "Curl, every finger", params: [["c1", "base", ...LIMITS.c1, 0.5], ["c2", "middle", ...LIMITS.c2, 0.5], ["c3", "tip", ...LIMITS.c3, 0.5]] },
    { title: "Curl, each finger", params: [["dI", "index", -60, 60, 0.5], ["dM", "middle", -60, 60, 0.5], ["dR", "ring", -60, 60, 0.5], ["dP", "pinky", -60, 60, 0.5]] },
    { title: "Spread toward the thumb", params: [["sI", "index", ...LIMITS.sI, 0.5], ["sM", "middle", ...LIMITS.sM, 0.5], ["sR", "ring", ...LIMITS.sR, 0.5], ["sP", "pinky", ...LIMITS.sP, 0.5]] },
    { title: "Thumb", params: [["t1x", "base up", ...LIMITS.t1x, 0.5], ["t1z", "base in", ...LIMITS.t1z, 0.5], ["t2", "middle", ...LIMITS.t2, 0.5], ["t3", "tip", ...LIMITS.t3, 0.5]] }
];
// a played open or close, eased like the real fold, and the pause at each end
const PLAY = { move: 1200, rest: 500 };

// the bones the mirror lines up, the thumb counted most so the two thumbs match from the front
const BONES = ["Hand", "Thumb2", "Thumb3", "Thumb4"];
["Index", "Middle", "Ring", "Pinky"].forEach((f) => [1, 2, 3, 4].forEach((i) => BONES.push(`${f}${i}`)));
const WEIGHTS = BONES.map((n) => (n.startsWith("Thumb") ? 10 : n === "Hand" ? 5 : 1));

// a short fingerprint of the file's text, so edits kept in the browser know which saved file they started from
const stamp = (text) => {
    let h = 5381;
    for (let i = 0; i < text.length; i++) {
        h = (h * 33 + text.charCodeAt(i)) >>> 0;
    }
    return h.toString(36);
};

const tidy = (pose) => Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, k === "q" ? v : Math.round(v * 1000) / 1000]));
const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

// the grips as the editor keeps them: the right hand's pose at each end, and each path's keys in between, by fold
const fromSaved = (saved) => {
    // the first editor kept one path, with an optional half way key ({ half, Right: { "1", "0.5", "0" } })
    if (saved.Right && !Array.isArray(saved.Right)) {
        const mid = saved.half && saved.Right["0.5"] ? { "0.5": saved.Right["0.5"] } : {};
        return { ends: { 1: saved.Right["1"], 0: saved.Right["0"] }, open: { ...mid }, close: { ...mid } };
    }
    if (saved.ends) {
        return saved;
    }
    // a saved file: { open: { Right, Left }, close: { Right, Left } }, or the first one's { half, Right: [...] }
    const pathOf = (list) => Object.fromEntries(list.filter((k) => k.fold > 0 && k.fold < 1).map((k) => [String(k.fold), k.pose]));
    const open = saved.open ? saved.open.Right : saved.Right;
    const close = saved.close ? saved.close.Right : saved.Right;
    return {
        ends: { 1: open.find((k) => k.fold === 1).pose, 0: open.find((k) => k.fold === 0).pose },
        open: pathOf(open),
        close: pathOf(close)
    };
};

export const createPoseEditor = ({ panel, getHands, getBones, getRoot, isPortrait, hold, release, leadTime }) => {
    const details = document.createElement("details");
    details.id = "pose-editor";
    details.innerHTML = `
        <summary>Pose editor, portrait</summary>
        <div class="row"><label>Path</label><select class="pose-path"></select></div>
        <div class="row"><label>Key</label><select class="pose-key"></select></div>
        <div class="row"><label>Fold</label><input type="range" class="pose-fold" min="0" max="1" step="0.01" />
            <span class="pose-fold-read"></span></div>
        <div class="row"><button class="pose-add">Add key here</button><button class="pose-remove">Remove key</button>
            <button class="pose-play">Play</button></div>
        <div class="pose-read">--</div>
        <div class="pose-sliders"></div>
        <div class="row"><button class="pose-save">Save</button><button class="pose-revert">Revert to file</button></div>
        <div class="pose-status"></div>`;
    panel.appendChild(details);
    const $ = (sel) => details.querySelector(sel);
    const pathSelect = $(".pose-path");
    const keySelect = $(".pose-key");
    const foldInput = $(".pose-fold");
    const foldRead = $(".pose-fold-read");
    const read = $(".pose-read");
    const status = $(".pose-status");
    Object.entries(PATHS).forEach(([value, name]) => pathSelect.add(new Option(name, value)));

    let grips = null;
    // the stamp of the file the current grips came from
    let base = null;
    // the left hand's mirrored pose for each key, the ends shared by both paths
    let left = { ends: {}, open: {}, close: {} };
    let path = "open";
    let current = "1";
    let fold = 1;
    let playing = 0;
    let readPending = false;

    const isEnd = (k) => ENDS.includes(k);
    const poseOf = (p, k) => (isEnd(k) ? grips.ends[k] : grips[p][k]);
    const leftOf = (p, k) => (isEnd(k) ? left.ends[k] : left[p][k]);
    const foldsOf = (p) => ["1", ...Object.keys(grips[p]).sort((a, b) => Number(b) - Number(a)), "0"];
    const keysFor = (p) => ({
        Right: foldsOf(p).map((k) => ({ fold: Number(k), frame: "body", pose: poseOf(p, k) })),
        Left: foldsOf(p).map((k) => ({ fold: Number(k), frame: "body", pose: leftOf(p, k) }))
    });

    // the right hand's bones at key `k` mirrored across the phone's middle, and the left hand turned and moved to fit
    // them, with the same joints, since the rig's two hands aren't exact mirrors
    const mirror = (p, k) => {
        const hands = getHands();
        const bones = getBones();
        const root = getRoot();
        const at = (side) => {
            root.updateMatrixWorld(true);
            const inverse = root.matrixWorld.clone().invert();
            return BONES.map((n) => bones[`J_${side}_${n === "Hand" ? "Hand" : `Hand${n}`}`].getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse));
        };
        const right = poseOf(p, k);
        hands.measure("Right", right, Number(k));
        const target = at("Right").map((v) => v.setX(-v.x));
        const joints = Object.fromEntries(JOINTS.map((n) => [n, right[n] ?? 0]));
        hands.measure("Left", { ...joints, q: [0, 0, 0, 1], px: 0, py: 0, pz: 0, yaw: 0, pitch: 0, roll: 0 }, Number(k));
        const { q, t } = fitTurn(at("Left"), target, WEIGHTS);
        const pose = { ...joints, q: q.toArray(), px: t.x, py: t.y, pz: t.z, yaw: 0, pitch: 0, roll: 0 };
        if (isEnd(k)) {
            left.ends[k] = pose;
        } else {
            left[p][k] = pose;
        }
    };
    const mirrorAll = () => {
        left = { ends: {}, open: {}, close: {} };
        ENDS.forEach((k) => mirror("open", k));
        ["open", "close"].forEach((p) => Object.keys(grips[p]).forEach((k) => mirror(p, k)));
    };

    const readouts = () => {
        readPending = false;
        if (!details.open || playing) {
            return;
        }
        const hands = getHands();
        const deep = (side) => Math.max(0, ...Object.values(hands.detail(side, fold)));
        const right = deep("Right");
        const leftDeep = deep("Left");
        const between = hands.betweenNow(1).deepest;
        const self = Math.max(hands.overlapNow("Right").selfMax, hands.overlapNow("Left").selfMax);
        const gaps = Object.entries(hands.contactGaps("Right")).map(([g, v]) => `${g} ${v.toFixed(2)}`).join(", ");
        read.textContent = `in phone R ${right.toFixed(2)} L ${leftDeep.toFixed(2)}, hands ${between.toFixed(2)}, self ${self.toFixed(2)} cm\nright gaps ${gaps}`;
    };

    const show = (reset = false) => {
        hold(keysFor(path), fold, reset);
        foldInput.value = fold;
        foldRead.textContent = fold.toFixed(2);
        if (!readPending) {
            readPending = true;
            requestAnimationFrame(readouts);
        }
    };

    const keep = () => localStorage.setItem(STORE, JSON.stringify({ base, grips }));

    const fillKeys = () => {
        keySelect.innerHTML = "";
        foldsOf(path).forEach((k) => keySelect.add(new Option(k === "1" ? "Closed, 1" : k === "0" ? "Open, 0" : `Between, ${k}`, k)));
        keySelect.value = current;
        $(".pose-remove").disabled = isEnd(current);
    };

    const sliders = {};
    SLIDERS.forEach(({ title, params }) => {
        const head = document.createElement("div");
        head.className = "pose-group";
        head.textContent = title;
        $(".pose-sliders").appendChild(head);
        params.forEach(([param, name, min, max, step]) => {
            const row = document.createElement("div");
            row.className = "row";
            row.innerHTML = `<label>${name}</label><input type="range" min="${min}" max="${max}" step="${step}" /><span class="pose-value"></span>`;
            const input = row.querySelector("input");
            const value = row.querySelector(".pose-value");
            input.addEventListener("input", () => {
                poseOf(path, current)[param] = Number(input.value);
                value.textContent = Number(input.value).toFixed(step < 0.1 ? 2 : 1);
                mirror(path, current);
                keep();
                show();
            });
            sliders[param] = { input, value, step };
            $(".pose-sliders").appendChild(row);
        });
    });

    const fillSliders = () => {
        const pose = poseOf(path, current);
        Object.entries(sliders).forEach(([param, { input, value, step }]) => {
            input.value = pose[param] ?? 0;
            value.textContent = Number(pose[param] ?? 0).toFixed(step < 0.1 ? 2 : 1);
        });
    };

    const pick = (k) => {
        current = k;
        fold = Number(k);
        fillKeys();
        fillSliders();
        show();
    };

    const fromFile = async () => {
        const res = await fetch(`/keys/${FILE}.json`, { cache: "no-store" });
        if (!res.ok) {
            throw new Error(`keys/${FILE}.json didn't load (${res.status})`);
        }
        const text = await res.text();
        return { grips: fromSaved(JSON.parse(text)), base: stamp(text) };
    };

    const start = async () => {
        if (!isPortrait()) {
            status.textContent = "Set Device to portrait, then open this again.";
            return;
        }
        let note = "Edits are kept in this browser until you save.";
        if (!grips) {
            try {
                const file = await fromFile();
                const stored = JSON.parse(localStorage.getItem(STORE) || "null");
                // edits kept in the browser only count while the file is still the one they started from
                if (stored && stored.base === file.base) {
                    grips = fromSaved(stored.grips);
                    note = "Picked up your unsaved edits.";
                } else {
                    grips = file.grips;
                    if (stored) {
                        localStorage.removeItem(STORE);
                        note = `keys/${FILE}.json changed since your unsaved edits, so this is the file.`;
                    }
                }
                base = file.base;
            } catch (err) {
                status.textContent = String(err.message || err);
                return;
            }
        }
        mirrorAll();
        pathSelect.value = path;
        fillKeys();
        fillSliders();
        show(true);
        status.textContent = note;
    };

    details.addEventListener("toggle", () => {
        if (details.open) {
            start();
            return;
        }
        playing = 0;
        release();
    });

    pathSelect.addEventListener("change", () => {
        path = pathSelect.value;
        pick(isEnd(current) ? current : "1");
    });

    keySelect.addEventListener("change", () => pick(keySelect.value));

    foldInput.addEventListener("input", () => {
        playing = 0;
        fold = Number(foldInput.value);
        show();
    });

    $(".pose-add").addEventListener("click", () => {
        const k = String(Math.round(fold * 100) / 100);
        if (fold <= 0.02 || fold >= 0.98 || foldsOf(path).some((f) => Math.abs(Number(f) - fold) < 0.02)) {
            status.textContent = "Move Fold away from the other keys first.";
            return;
        }
        // starts where this path already has the hand at this fold, so adding it changes nothing until it's moved
        const hands = getHands();
        hands.setKeys({ Left: [], Right: keysFor(path).Right }, { smooth: true });
        grips[path][k] = tidy(hands.sample("Right", Number(k)));
        mirror(path, k);
        keep();
        pick(k);
        status.textContent = `Added a key at ${k} to ${PATHS[path].toLowerCase()}.`;
    });

    $(".pose-remove").addEventListener("click", () => {
        if (isEnd(current)) {
            return;
        }
        delete grips[path][current];
        delete left[path][current];
        keep();
        pick("1");
    });

    $(".pose-play").addEventListener("click", () => {
        if (playing) {
            playing = 0;
            show();
            return;
        }
        const begin = performance.now();
        playing = begin;
        const cycle = leadTime + 2 * (PLAY.move + PLAY.rest);
        const frame = (now) => {
            if (playing !== begin || !details.open) {
                return;
            }
            // the hands go ahead along the opening path with the phone still closed, like the real opening, then it
            // opens on the opening path, rests, closes on the closing path, rests, and again
            const t = (now - begin) % cycle;
            const opening = t < leadTime + PLAY.move + PLAY.rest;
            const lead = opening ? easeInOut(Math.min(t / leadTime, 1)) : 0;
            const u = Math.max(0, Math.min((opening ? t - leadTime : t - leadTime - PLAY.move - PLAY.rest) / PLAY.move, 1));
            fold = opening ? 1 - easeInOut(u) : easeInOut(u);
            hold(keysFor(opening ? "open" : "close"), fold, false, lead);
            foldInput.value = fold;
            foldRead.textContent = fold.toFixed(2);
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    });

    $(".pose-save").addEventListener("click", async () => {
        const out = {};
        ["open", "close"].forEach((p) => {
            const set = keysFor(p);
            out[p] = {
                Right: set.Right.map((k) => ({ ...k, pose: tidy(k.pose) })),
                Left: set.Left.map((k) => ({ ...k, pose: tidy(k.pose) }))
            };
        });
        const text = JSON.stringify(out);
        const res = await fetch(`/__save?name=${FILE}`, { method: "POST", body: text });
        if (!res.ok) {
            status.textContent = `Save failed (${res.status}).`;
            return;
        }
        base = stamp(text);
        localStorage.removeItem(STORE);
        status.textContent = `Saved keys/${FILE}.json at ${new Date().toLocaleTimeString()}.`;
    });

    $(".pose-revert").addEventListener("click", async () => {
        localStorage.removeItem(STORE);
        grips = null;
        current = "1";
        fold = 1;
        await start();
        status.textContent = `Back to keys/${FILE}.json.`;
    });
};
