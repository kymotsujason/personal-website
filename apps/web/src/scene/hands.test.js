import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { signedBoxDistance, CONTACT_GROUPS, contactGroup, contactCost, fingerAngles, fitTurn, foldHermite } from "./hands.js";

const MIN = [0, 0, 0];
const MAX = [2, 4, 1];
const at = (x, y, z) => new THREE.Vector3(x, y, z);
const near = (a, b) => Math.abs(a - b) < 1e-9;

test("a point outside a box is as far as the nearest point on the box", () => {
    assert.ok(near(signedBoxDistance(at(3, 2, 0.5), MIN, MAX), 1));
    assert.ok(near(signedBoxDistance(at(3, 5, 0.5), MIN, MAX), Math.SQRT2));
    assert.ok(near(signedBoxDistance(at(1, 2, -0.25), MIN, MAX), 0.25));
});

test("a point inside a box is negative, as deep as its nearest face, and a point on a face is 0", () => {
    assert.ok(near(signedBoxDistance(at(1, 2, 0.75), MIN, MAX), -0.25));
    assert.ok(near(signedBoxDistance(at(1.5, 2, 0.5), MIN, MAX), -0.5));
    assert.ok(near(signedBoxDistance(at(2, 2, 0.5), MIN, MAX), 0));
});

test("each skin point's dominant bone puts it in one contact group, and the forearm in none", () => {
    assert.deepEqual(CONTACT_GROUPS, ["thumb", "index", "middle", "ring", "pinky", "palm"]);
    assert.equal(contactGroup("J_Left_Hand"), "palm");
    assert.equal(contactGroup("J_Right_HandThumb1"), "palm");
    assert.equal(contactGroup("J_Left_HandThumb3"), "thumb");
    assert.equal(contactGroup("J_Left_HandIndex1"), "index");
    assert.equal(contactGroup("J_Right_HandMiddle2"), "middle");
    assert.equal(contactGroup("J_Left_HandRing3"), "ring");
    assert.equal(contactGroup("J_Right_HandPinky2"), "pinky");
    assert.equal(contactGroup("J_Left"), null);
});

test("contact costs nothing within the band either side of the surface, and the square of the gap past it", () => {
    const touching = { thumb: 0.05, index: 0, middle: -0.04, ring: 0.02, pinky: 0.05, palm: -0.05 };
    assert.equal(contactCost(touching, 0.05, 100), 0);
    assert.ok(near(contactCost({ ...touching, palm: 0.25 }, 0.05, 100), 4));
    assert.ok(near(contactCost({ ...touching, palm: 0.25, thumb: 1.05 }, 0.05, 100), 104));
});

// a part's gap is its deepest point, so sinking past the band costs the same as floating past it
test("a part deeper inside than the band costs the square of how far past it", () => {
    const touching = { thumb: 0.05, index: 0, middle: -0.04, ring: 0.02, pinky: 0.05, palm: -0.05 };
    assert.ok(near(contactCost({ ...touching, ring: -0.25 }, 0.05, 100), 4));
});

// jason, 2026-10-15: a part may float up to 0.5 mm and sink up to 1.5 mm, since skin squashes against the phone
test("a separate inside allowance lets a part sink further than it may float", () => {
    const touching = { thumb: 0.05, index: 0, middle: -0.04, ring: 0.02, pinky: 0.05, palm: -0.05 };
    assert.equal(contactCost({ ...touching, ring: -0.15 }, 0.05, 100, 0.15), 0);
    assert.ok(near(contactCost({ ...touching, ring: -0.25 }, 0.05, 100, 0.15), 1));
    assert.ok(near(contactCost({ ...touching, ring: 0.15 }, 0.05, 100, 0.15), 1));
});

// a stride can skip every point of a small group, and an infinite cost would make every pose tie
test("a group with no skin points this pass adds nothing", () => {
    const gaps = { thumb: Infinity, index: 0.15, middle: 0, ring: 0, pinky: 0, palm: 0 };
    assert.ok(near(contactCost(gaps, 0.05, 100), 1));
});

test("a finger's spread turns only its base joint, and a pose without one has none", () => {
    const pose = { c1: 10, c2: 20, c3: 30, dI: 0, sI: 12 };
    assert.deepEqual(fingerAngles(pose, "Index").map((a) => a.z), [12, 0, 0]);
    assert.deepEqual(fingerAngles(pose, "Middle").map((a) => a.z), [0, 0, 0]);
    assert.deepEqual(fingerAngles(pose, "Index").map((a) => a.x), [10, 20, 30]);
});

test("a finger's curl offset adds to every joint, the tip joint by 0.7, within the joint's range", () => {
    assert.deepEqual(fingerAngles({ c1: 10, c2: 20, c3: 30, dR: 10 }, "Ring").map((a) => a.x), [20, 30, 37]);
    assert.deepEqual(fingerAngles({ c1: 100, c2: -20, c3: 0, dP: 10 }, "Pinky").map((a) => a.x), [105, -10, 7]);
});

test("the fitted turn and shift carry the points back onto a turned and shifted copy of them", () => {
    const from = [at(0, 0, 0), at(3, 0, 0), at(0, 2, 0), at(0, 0, 1), at(1, 1, 1)];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -0.9, 1.3));
    const t = at(5, -2, 0.5);
    const to = from.map((p) => p.clone().applyQuaternion(q).add(t));
    const fit = fitTurn(from, to, [1, 1, 1, 1, 5]);
    from.forEach((p, i) => {
        assert.ok(p.clone().applyQuaternion(fit.q).add(fit.t).distanceTo(to[i]) < 1e-6);
    });
});

test("the fold curve passes through both keys of its stretch, and follows a straight line exactly", () => {
    assert.ok(near(foldHermite(0, 2, 5, 9, 1, 0.9, 0.5, 0.2, 0.9), 2));
    assert.ok(near(foldHermite(0, 2, 5, 9, 1, 0.9, 0.5, 0.2, 0.5), 5));
    // values that go up 3 for every 0.1 of fold, at uneven spacing
    const line = (f) => 30 * (1 - f);
    assert.ok(near(foldHermite(line(1), line(0.9), line(0.5), line(0.2), 1, 0.9, 0.5, 0.2, 0.7), line(0.7)));
});

// eased in and out of every key, the hand stopped at each one, and the closing path has a dozen of them
test("the fold curve keeps its slope through a key instead of stopping at it", () => {
    const folds = [1, 0.9, 0.6, 0.5, 0];
    const values = [0, 4, 5, 9, 10];
    const at = (fold) => {
        const i = folds.findIndex((f) => f <= fold);
        const pick = (k) => Math.min(Math.max(k, 0), folds.length - 1);
        const [a, b, c, d] = [i - 2, i - 1, i, i + 1].map(pick);
        return foldHermite(values[a], values[b], values[c], values[d], folds[a], folds[b], folds[c], folds[d], fold);
    };
    const e = 1e-6;
    const before = (at(0.6) - at(0.6 + e)) / e;
    const after = (at(0.6 - e) - at(0.6)) / e;
    assert.ok(Math.abs(before - after) < 1e-3);
    assert.ok(Math.abs(before) > 1);
});

test("a key with no neighbor on one side takes its slope from the stretch it ends", () => {
    assert.ok(near(foldHermite(2, 2, 5, 5, 1, 1, 0.5, 0.5, 0.75), 3.5));
});
