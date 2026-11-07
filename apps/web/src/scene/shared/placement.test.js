import { test } from "node:test";
import assert from "node:assert/strict";
import { place } from "./placement.js";

test("a 1280 by 800 window places the phone where the spike measured it", () => {
    const placed = place({ width: 1280, height: 800, portrait: false });
    assert.ok(Math.abs(placed.rest.z - -23.8847) < 1e-3, `rest.z ${placed.rest.z}`);
    assert.ok(Math.abs(placed.stage.z - -26.2732) < 1e-3, `stage.z ${placed.stage.z}`);
    assert.equal(placed.homeDist, -placed.rest.z);
});

test("a narrow portrait window is width limited, so the phone sits farther back", () => {
    const phone = place({ width: 390, height: 844, portrait: true });
    const tablet = place({ width: 768, height: 1024, portrait: true });
    assert.ok(phone.homeDist > tablet.homeDist, `${phone.homeDist} against ${tablet.homeDist}`);
});

// device.js's own math for the open screen and the cover, built the same way from three's groups, so the shared layout
// the 2d screens use can't drift from what the 3d screens are laid out at
const threeLayout = async (portrait) => {
    const THREE = await import("three");
    const { DUO } = await import("../state.js");
    const { PX_PER_CM } = await import("./placement.js");
    const root = new THREE.Group();
    const roll = new THREE.Group();
    roll.rotation.z = portrait ? -Math.PI / 2 : 0;
    const hinged = new THREE.Group();
    const body = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.z = DUO.depth / 2 + DUO.gap / 2;
    const flap = new THREE.Group();
    flap.position.z = -pivot.position.z;
    root.add(roll);
    roll.add(hinged);
    hinged.add(body, pivot);
    pivot.add(flap);
    const setFold = (fold) => {
        pivot.rotation.y = Math.PI * fold;
        hinged.position.x = -(DUO.halfW / 2) * fold;
        hinged.position.z = -(DUO.depth / 2 + DUO.gap / 2) * fold;
        root.updateMatrixWorld(true);
    };
    const corners = (owner, xmin, xmax, ymin, ymax) => {
        const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
        const local = [[xmin, ymin], [xmax, ymin], [xmin, ymax], [xmax, ymax]].map(([x, y]) => {
            const d = new THREE.Vector3(x, y, 0).applyMatrix4(owner.matrixWorld).applyMatrix4(rootInverse);
            return { local: new THREE.Vector3(x, y, 0), dx: d.x, dy: d.y };
        });
        const byTop = [...local].sort((a, b) => b.dy - a.dy);
        const top = byTop.slice(0, 2).sort((a, b) => a.dx - b.dx);
        const bottom = byTop.slice(2).sort((a, b) => a.dx - b.dx);
        return {
            corners: [top[0].local, top[1].local, bottom[0].local, bottom[1].local],
            width: Math.hypot(top[1].dx - top[0].dx, top[1].dy - top[0].dy),
            height: Math.hypot(bottom[0].dx - top[0].dx, bottom[0].dy - top[0].dy)
        };
    };
    const sy = DUO.screenH / 2;
    setFold(0);
    const full = corners(body, -DUO.halfScreenW, DUO.halfScreenW, -sy, sy);
    setFold(1);
    const coverX = -DUO.halfW / 2;
    const cover = corners(flap, coverX - DUO.coverW / 2, coverX + DUO.coverW / 2, -DUO.coverH / 2, DUO.coverH / 2);
    const bodyInverse = new THREE.Matrix4().copy(body.matrixWorld).invert();
    const coverPlane = cover.corners.map((c) => c.clone().applyMatrix4(flap.matrixWorld).applyMatrix4(bodyInverse));
    const fullW = full.width * PX_PER_CM;
    const fullH = full.height * PX_PER_CM;
    const [tl, tr, bl] = full.corners;
    const u = tr.clone().sub(tl);
    const v = bl.clone().sub(tl);
    const toPx = (p) => {
        const rel = p.clone().sub(tl);
        return [(rel.dot(u) / u.lengthSq()) * fullW, (rel.dot(v) / v.lengthSq()) * fullH];
    };
    const bounds = (points) => {
        const px = points.map(toPx);
        const xs = px.map((q) => q[0]);
        const ys = px.map((q) => q[1]);
        return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    return {
        fullW,
        fullH,
        side: bounds([new THREE.Vector3(-DUO.halfScreenW, -sy, 0), new THREE.Vector3(0, sy, 0)]),
        main: { ...bounds(coverPlane), w: cover.width * PX_PER_CM, h: cover.height * PX_PER_CM }
    };
};

test("the shared screen layout matches device.js's in both orientations", async () => {
    const { screenLayout } = await import("./placement.js");
    for (const portrait of [false, true]) {
        const want = await threeLayout(portrait);
        const got = screenLayout(portrait);
        const close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${portrait ? "portrait" : "landscape"} ${what}: ${a} against ${b}`);
        close(got.fullW, want.fullW, "fullW");
        close(got.fullH, want.fullH, "fullH");
        ["x", "y", "w", "h"].forEach((k) => {
            close(got.side[k], want.side[k], `side.${k}`);
            close(got.main[k], want.main[k], `main.${k}`);
        });
        close(got.cover.w, want.main.w, "cover.w");
        close(got.cover.h, want.main.h, "cover.h");
    }
});
