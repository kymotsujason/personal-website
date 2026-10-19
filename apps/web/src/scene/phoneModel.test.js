import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { PARTS, SLOTS, slotOf, applyFinish, bakePart, cameraSolid, checkSlots } from "./phoneModel.js";

const named = (name) => new THREE.MeshBasicMaterial({ name });

test("the phone has four parts and ten material slots", () => {
    assert.deepEqual(PARTS, ["Flap", "Body", "HingeCover", "CameraBlock"]);
    assert.equal(SLOTS.length, 10);
    assert.ok(SLOTS.includes("glass"));
});

test("a material's slot is its name without blender's number suffix", () => {
    assert.equal(slotOf("frame"), "frame");
    assert.equal(slotOf("frame.001"), "frame");
    assert.equal(slotOf("lensGlass.12"), "lensGlass");
});

test("a finish fills each mesh's slot, including a mesh nested under the part", () => {
    const part = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.BoxGeometry(), named("frame.001"));
    const button = new THREE.Mesh(new THREE.BoxGeometry(), named("frame"));
    shell.add(button);
    part.add(shell);
    const frame = new THREE.MeshStandardMaterial();
    applyFinish(part, { frame });
    assert.equal(shell.material, frame);
    assert.equal(button.material, frame);
});

test("a slot the finish doesn't have is an error, not a mesh left with the default", () => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(), named("chrome"));
    assert.throws(() => applyFinish(part, { frame: new THREE.MeshStandardMaterial() }), /chrome/);
});

test("baking moves the part's world placement into its geometry and scales it, in a fresh group", () => {
    const parent = new THREE.Group();
    parent.position.set(0.01, 0, 0);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0.02, 0, 0], 3)), named("back"));
    parent.add(mesh);
    parent.updateMatrixWorld(true);
    const baked = bakePart(parent, 100);
    const copy = baked.children[0];
    assert.notEqual(copy, mesh);
    assert.notEqual(copy.geometry, mesh.geometry);
    assert.ok(Math.abs(copy.geometry.getAttribute("position").getX(0) - 3) < 1e-6);
    assert.equal(copy.material.name, "back");
    assert.ok(copy.matrix.equals(new THREE.Matrix4()));
    // the original is untouched, so a second build bakes the same numbers
    assert.ok(Math.abs(mesh.geometry.getAttribute("position").getX(0) - 0.02) < 1e-6);
});

test("the camera block's bounds become a collision box", () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.5).translate(5, 4, -0.4), named("opening")));
    const { min, max } = cameraSolid(group);
    assert.deepEqual(min.map((v) => +v.toFixed(3)), [4, 3.5, -0.65]);
    assert.deepEqual(max.map((v) => +v.toFixed(3)), [6, 4.5, -0.15]);
});

// a bad file has to fail while loading, where the spike falls back to the code phone, not later inside a build
test("a glb slot the code doesn't know, or a finish missing a slot, fails the load", () => {
    const full = Object.fromEntries(SLOTS.map((slot) => [slot, new THREE.MeshStandardMaterial()]));
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), named("frame.001")));
    checkSlots(scene, { "star-white": full });
    assert.throws(() => checkSlots(scene, { "star-white": full, clay: { ...full, frame: undefined } }), /clay has no frame/);
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), named("speaker")));
    assert.throws(() => checkSlots(scene, { "star-white": full }), /speaker/);
});
