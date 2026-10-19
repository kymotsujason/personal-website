import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { splitVolume, upButton } from "./volume.js";

// a triangle centered at (x, y), small enough to stay on its own side of any split
const triangle = (x, y) => [x - 0.05, y, 0, x + 0.05, y, 0, x, y + 0.03, 0];

test("the volume buttons split from the rest by the edge they're on, and from each other at the widest gap", () => {
    const top = 5.89;
    const geometry = new THREE.BufferGeometry();
    const positions = [
        // the near button, two triangles, then the far one, then a side button on the outer edge
        ...triangle(1.2, top), ...triangle(1.6, top),
        ...triangle(2.5, top), ...triangle(2.9, top), ...triangle(3.1, top),
        ...triangle(8.25, 2.0)
    ];
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const parts = splitVolume(geometry, top);
    assert.equal(parts.near.getAttribute("position").count, 6);
    assert.equal(parts.far.getAttribute("position").count, 9);
    assert.equal(parts.rest.getAttribute("position").count, 3);
    assert.ok(parts.near.boundingBox.max.x < parts.far.boundingBox.min.x);
});

test("a button whose long faces spread their centers wider than the gap between the buttons still splits at that gap", () => {
    const top = 5.89;
    // like the phone's buttons: each a pair of long triangles running its whole length, plus small caps at its ends.
    // the long triangles' centers sit a third of the way in from each end, 0.33 apart, wider than the 0.3 gap
    const button = (x0, x1) => [
        x0, top, 0, x1, top, 0, x1, top + 0.03, 0,
        x0, top, 0, x0, top + 0.03, 0, x1, top + 0.03, 0,
        x0, top, 0, x0 + 0.02, top, 0, x0, top + 0.03, 0,
        x1, top, 0, x1 - 0.02, top, 0, x1, top + 0.03, 0
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([...button(0.93, 1.93), ...button(2.23, 3.23)], 3));
    geometry.computeVertexNormals();
    const parts = splitVolume(geometry, top);
    assert.equal(parts.near.getAttribute("position").count, 12);
    assert.equal(parts.far.getAttribute("position").count, 12);
    assert.ok(Math.abs(parts.near.boundingBox.min.x - 0.93) < 1e-6);
    assert.ok(Math.abs(parts.near.boundingBox.max.x - 1.93) < 1e-6);
    assert.ok(Math.abs(parts.far.boundingBox.min.x - 2.23) < 1e-6);
});

test("up is the far button in landscape and the near one in portrait, as ipados turns them", () => {
    assert.equal(upButton(false), "far");
    assert.equal(upButton(true), "near");
});
