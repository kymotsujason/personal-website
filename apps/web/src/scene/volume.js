import * as THREE from "three";

// the phone's volume buttons (art/phone/buildPhone.py puts them on the bottom half's top edge, x 0.93 to 1.93 and 2.23
// to 3.23 from the hinge). a press steps the music's level and shows an ios style volume bar on the screen. like
// ipados, which button turns it up follows how the phone is held: the right one in landscape, and in portrait, where
// the halves turn so that edge is the phone's right side, the upper one, nearer the hinge

// how far a pressed button sinks into the frame, cm, and how long the press and the bar take, ms
const PRESS_DEPTH = 0.035;
const PRESS_IN = 60;
const PRESS_OUT = 140;
const SHOW_FOR = 1400;
const FADE_OUT = 260;
const LEVEL_EASE = 120;
// the bar on the screen, cm: along the edge, across it, and in from the edge
const BAR = { long: 2.6, short: 0.46, inset: 0.55 };
// the invisible area round each button that takes a press, cm. seen from the front the top edge is nearly edge on, so
// the buttons alone would be a few pixels tall
const REACH = { along: 0.2, out: 0.7, inward: 0.15, depth: 0.45 };

// the buttons' triangles split out of the joined buttons mesh by where they sit: the two on the top edge, nearer and
// farther from the hinge. the rest (the side button and camera control) stay in the original mesh
export const splitVolume = (geometry, topY) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = flat.getAttribute("position");
    const normal = flat.getAttribute("normal");
    const groups = { rest: [], near: [], far: [] };
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let nearMax = -Infinity;
    let farMin = Infinity;
    const onTop = [];
    for (let t = 0; t < position.count; t += 3) {
        a.fromBufferAttribute(position, t);
        b.fromBufferAttribute(position, t + 1);
        c.fromBufferAttribute(position, t + 2);
        const y = (a.y + b.y + c.y) / 3;
        const x = (a.x + b.x + c.x) / 3;
        if (y > topY - 0.05) {
            onTop.push([t, x, Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x)]);
        } else {
            groups.rest.push(t);
        }
    }
    // the two buttons are split at the widest gap along the edge that no triangle crosses. the triangles' centers
    // won't do, since a button's long faces run its whole length and their centers sit further apart than the buttons
    const spans = onTop.map(([, , lo, hi]) => [lo, hi]).sort((p, q) => p[0] - q[0]);
    let split = spans.length ? spans[0][0] : 0;
    let widest = -1;
    let reach = spans.length ? spans[0][1] : 0;
    for (let i = 1; i < spans.length; i++) {
        if (spans[i][0] - reach > widest) {
            widest = spans[i][0] - reach;
            split = (spans[i][0] + reach) / 2;
        }
        reach = Math.max(reach, spans[i][1]);
    }
    onTop.forEach(([t, x]) => {
        if (x < split) {
            groups.near.push(t);
            nearMax = Math.max(nearMax, x);
        } else {
            groups.far.push(t);
            farMin = Math.min(farMin, x);
        }
    });
    const build = (starts) => {
        const g = new THREE.BufferGeometry();
        const p = new Float32Array(starts.length * 9);
        const n = new Float32Array(starts.length * 9);
        starts.forEach((t, i) => {
            for (let k = 0; k < 3; k++) {
                p.set([position.getX(t + k), position.getY(t + k), position.getZ(t + k)], (i * 3 + k) * 3);
                n.set([normal.getX(t + k), normal.getY(t + k), normal.getZ(t + k)], (i * 3 + k) * 3);
            }
        });
        g.setAttribute("position", new THREE.BufferAttribute(p, 3));
        g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
        g.computeBoundingBox();
        return g;
    };
    return { rest: build(groups.rest), near: build(groups.near), far: build(groups.far) };
};

// which button turns the volume up, by how the phone is held (see the top of the file)
export const upButton = (portrait) => (portrait ? "near" : "far");

const easeOut = (t) => 1 - (1 - t) * (1 - t);

// the bar: a dark glass pill with the level filled in white and a speaker at its low end. drawn lying along the canvas,
// left to right, or standing, bottom to top
const drawBar = (canvas, level, standing) => {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    if (standing) {
        // drawn lying down, then turned a quarter so it reads bottom to top
        ctx.translate(0, height);
        ctx.rotate(-Math.PI / 2);
    }
    const w = standing ? height : width;
    const h = standing ? width : height;
    const r = h / 2;
    ctx.fillStyle = "rgba(40, 40, 46, 0.72)";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
    ctx.fill();
    // the fill runs from just after the speaker to the far end
    const start = h * 1.05;
    const inset = h * 0.22;
    const track = w - start - inset;
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.beginPath();
    ctx.roundRect(start, inset, track, h - inset * 2, (h - inset * 2) / 2);
    ctx.fill();
    if (level > 0) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.roundRect(start, inset, Math.max(track * level, h - inset * 2), h - inset * 2, (h - inset * 2) / 2);
        ctx.fill();
    }
    ctx.restore();
    // the speaker, upright either way, with waves for how loud or a cross when silent. its spot at the low end, lying,
    // is turned the same quarter as the pill when standing
    const s = h * 0.17;
    const cx = standing ? h / 2 : h * 0.52;
    const cy = standing ? height - h * 0.52 : h / 2;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(cx - s * 1.2, cy - s * 0.55);
    ctx.lineTo(cx - s * 0.4, cy - s * 0.55);
    ctx.lineTo(cx + s * 0.5, cy - s * 1.3);
    ctx.lineTo(cx + s * 0.5, cy + s * 1.3);
    ctx.lineTo(cx - s * 0.4, cy + s * 0.55);
    ctx.lineTo(cx - s * 1.2, cy + s * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = h * 0.06;
    ctx.lineCap = "round";
    if (level <= 0) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.9, cy - s * 0.7);
        ctx.lineTo(cx + s * 2.1, cy + s * 0.7);
        ctx.moveTo(cx + s * 2.1, cy - s * 0.7);
        ctx.lineTo(cx + s * 0.9, cy + s * 0.7);
        ctx.stroke();
    } else {
        const waves = level > 0.66 ? 2 : 1;
        for (let i = 1; i <= waves; i++) {
            ctx.beginPath();
            ctx.arc(cx + s * 0.5, cy, s * (0.7 + i * 0.6), -Math.PI / 4, Math.PI / 4);
            ctx.stroke();
        }
    }
};

// body and flap are the phone's halves, buttons the joined buttons mesh in the body, depth the phone's thickness, top
// the y of the body's top edge, portrait how the phone is held, and level/steps the music's current level and range.
// step(direction) changes the level and gives back the new one
export const createVolumeButtons = ({ body, flap, buttons, depth, top, portrait, level, steps, step }) => {
    const parts = splitVolume(buttons.geometry, top);
    buttons.geometry = parts.rest;
    const pressable = {};
    // the buttons sit closer together than two reaches, so on the side facing each other the hit areas stop halfway
    // across the gap, and a press there goes to the nearer button
    const between = THREE.MathUtils.clamp((parts.far.boundingBox.min.x - parts.near.boundingBox.max.x) / 2, 0, REACH.along);
    ["near", "far"].forEach((which) => {
        const mesh = new THREE.Mesh(parts[which], buttons.material);
        mesh.name = `Volume ${which}`;
        body.add(mesh);
        const box = parts[which].boundingBox;
        const left = box.min.x - (which === "near" ? REACH.along : between);
        const right = box.max.x + (which === "near" ? between : REACH.along);
        const size = new THREE.Vector3(right - left, box.max.y - box.min.y + REACH.out + REACH.inward, REACH.depth * 2);
        const hit = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial());
        hit.visible = false;
        hit.position.set((left + right) / 2, box.min.y - REACH.inward + size.y / 2, 0);
        hit.userData.volume = which;
        body.add(hit);
        pressable[which] = { mesh, hit, pressedAt: -Infinity };
    });

    // one bar on the inner screen next to the buttons and one on the cover screen when closed, each a canvas texture
    const standing = portrait;
    const canvas = document.createElement("canvas");
    canvas.width = standing ? 96 : 544;
    canvas.height = standing ? 544 : 96;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
    const plane = standing ? new THREE.PlaneGeometry(BAR.short, BAR.long) : new THREE.PlaneGeometry(BAR.long, BAR.short);
    const centerX = (pressable.near.mesh.geometry.boundingBox.min.x + pressable.far.mesh.geometry.boundingBox.max.x) / 2;
    const bars = [];
    // the bar runs along the edge, the body's x. standing, its up turns a quarter to point toward the hinge, which is up
    // on the screen in portrait
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), standing ? Math.PI / 2 : 0);
    const inner = new THREE.Mesh(plane, material);
    inner.position.set(centerX, top - BAR.inset, depth / 2 + 0.02);
    inner.quaternion.copy(turn);
    inner.renderOrder = 20;
    body.add(inner);
    bars.push(inner);
    // the cover screen faces the other way on the flap, which lies mirrored over the body when closed
    const cover = new THREE.Mesh(plane, material);
    cover.position.set(-centerX, top - BAR.inset, -(depth / 2 + 0.02));
    cover.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI).multiply(turn);
    cover.renderOrder = 20;
    flap.add(cover);
    bars.push(cover);

    let shownLevel = level / steps;
    let fromLevel = shownLevel;
    let toLevel = shownLevel;
    let levelAt = -Infinity;
    let shownAt = -Infinity;
    let drawn = null;

    const press = (which, now) => {
        const p = pressable[which];
        p.pressedAt = now;
        const next = step(which === upButton(portrait) ? 1 : -1);
        fromLevel = shownLevel;
        toLevel = next / steps;
        levelAt = now;
        shownAt = now;
    };

    return {
        hits: [pressable.near.hit, pressable.far.hit],
        // a press on one of the hit areas, from a raycaster set up for the pointer. gives back whether it was one
        tryPress: (raycaster, now) => {
            const found = raycaster.intersectObjects([pressable.near.hit, pressable.far.hit], false)[0];
            if (!found) {
                return false;
            }
            press(found.object.userData.volume, now);
            return true;
        },
        isOver: (raycaster) => raycaster.intersectObjects([pressable.near.hit, pressable.far.hit], false).length > 0,
        // now in ms. moves the pressed button in and out, eases the bar to its level, and fades the bar
        update: (now) => {
            Object.values(pressable).forEach((p) => {
                const t = now - p.pressedAt;
                const sink = t < PRESS_IN ? easeOut(t / PRESS_IN) : t < PRESS_IN + PRESS_OUT ? 1 - easeOut((t - PRESS_IN) / PRESS_OUT) : 0;
                p.mesh.position.y = -PRESS_DEPTH * sink;
            });
            const k = Math.min((now - levelAt) / LEVEL_EASE, 1);
            shownLevel = fromLevel + (toLevel - fromLevel) * easeOut(k);
            const since = now - shownAt;
            const opacity = since < SHOW_FOR ? 1 : Math.max(0, 1 - (since - SHOW_FOR) / FADE_OUT);
            material.opacity = opacity;
            bars.forEach((bar) => {
                bar.visible = opacity > 0;
            });
            const key = opacity > 0 ? Math.round(shownLevel * 400) : drawn;
            if (opacity > 0 && key !== drawn) {
                drawBar(canvas, shownLevel, standing);
                texture.needsUpdate = true;
                drawn = key;
            }
        }
    };
};
