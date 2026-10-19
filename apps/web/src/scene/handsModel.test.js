import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildRig, remapSkin, bindHands, plainGeometry, timeLimit, UNITS } from "./handsModel.js";

const IDENTITY = new THREE.Matrix4().toArray();
const RIG = {
    bones: [
        { name: "Root", parent: null, position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], order: "XYZ", inverse: IDENTITY },
        { name: "J_Left", parent: "Root", position: [1, 2, 3], quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2], scale: [1, 1, 1], order: "ZYX", inverse: new THREE.Matrix4().makeTranslation(-1, -2, -3).toArray() }
    ]
};

test("the rig's bones keep their parents, their starting transforms, and their euler order", () => {
    const { root, bones, bind, list } = buildRig(RIG);
    assert.equal(root.children[0], bones.Root);
    assert.equal(bones.J_Left.parent, bones.Root);
    assert.deepEqual(bones.J_Left.position.toArray(), [1, 2, 3]);
    assert.equal(bones.J_Left.rotation.order, "ZYX");
    assert.equal(bind.J_Left.order, "ZYX");
    assert.ok(Math.abs(bind.J_Left.y - Math.PI / 2) < 1e-9, `the starting turn was ${bind.J_Left.y}`);
    assert.deepEqual(list.map((b) => b.name), ["Root", "J_Left"]);
});

test("the starting rotations are copies, so curling a bone leaves its start alone", () => {
    const { bones, bind } = buildRig(RIG);
    bones.J_Left.rotation.x += 1;
    assert.equal(bind.J_Left.x, 0);
});

test("the bone inverses are the rig's own, not worked out from the starting pose", () => {
    const { boneInverses } = buildRig(RIG);
    assert.deepEqual(boneInverses[1].toArray(), RIG.bones[1].inverse);
});

test("skin indices move to the rig's bone of the same name", () => {
    assert.deepEqual(remapSkin([0, 1, 1, 0], ["B", "A"], ["A", "B", "C"]), [1, 0, 0, 1]);
});

test("a skin bone the rig doesn't have is an error, not a silent wrong bone", () => {
    assert.throws(() => remapSkin([0], ["X"], ["A"]), /X/);
});

// a stand in for the glb's skinned mesh: two vertices, its own joint list in the other order from the rig, and a
// placement in the file, so the bind has to move, scale, and remap it
const sourceMesh = () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0.01, 0, 0, 0, 0.02, 0], 3));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0], 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0], 4));
    const ownBones = ["J_Left", "Root"].map((name) => {
        const bone = new THREE.Bone();
        bone.name = name;
        return bone;
    });
    const source = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    source.add(ownBones[0], ownBones[1]);
    source.bind(new THREE.Skeleton(ownBones));
    source.position.set(0.5, 0, 0);
    source.updateMatrixWorld(true);
    return source;
};

test("the hands bind with the rig's own bone inverses and no bind offset", () => {
    const { mesh } = bindHands(sourceMesh(), RIG);
    assert.deepEqual(mesh.skeleton.boneInverses.map((m) => m.toArray()), RIG.bones.map((b) => b.inverse));
    assert.ok(mesh.bindMatrix.equals(new THREE.Matrix4()), "the bind matrix should be identity");
    assert.deepEqual(mesh.skeleton.bones.map((b) => b.name), ["Root", "J_Left"]);
});

test("the mesh comes into the rig's space: placed as in the file, in centimeters, skinned to the rig's bones", () => {
    const { mesh } = bindHands(sourceMesh(), RIG);
    const position = mesh.geometry.getAttribute("position");
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    assert.ok(near(position.getX(0), (0.01 + 0.5) * UNITS), `x was ${position.getX(0)}`);
    assert.ok(near(position.getY(1), 0.02 * UNITS), `y was ${position.getY(1)}`);
    // the file's joint 0 is J_Left, which is the rig's bone 1, and its joint 1 is Root, the rig's bone 0
    assert.deepEqual([mesh.geometry.getAttribute("skinIndex").getX(0), mesh.geometry.getAttribute("skinIndex").getX(1)], [1, 0]);
});

test("packed attributes come out as plain floats, and skin indices as plain integers", () => {
    const geometry = new THREE.BufferGeometry();
    // a normal stored as a normalized byte, a uv in an interleaved buffer, and indices as bytes, as meshopt packs them
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Int8Array([127, 0, -127, 0, 127, 0]), 3, true));
    const interleaved = new THREE.InterleavedBuffer(new Float32Array([0.25, 0.5, 9, 0.75, 1, 9]), 3);
    geometry.setAttribute("uv", new THREE.InterleavedBufferAttribute(interleaved, 2, 0));
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint8Array([1, 2, 0, 0, 3, 0, 0, 0]), 4));
    plainGeometry(geometry);
    assert.ok(geometry.getAttribute("normal").array instanceof Float32Array);
    assert.equal(geometry.getAttribute("normal").normalized, false);
    assert.deepEqual(Array.from(geometry.getAttribute("normal").array), [1, 0, -1, 0, 1, 0]);
    assert.deepEqual(Array.from(geometry.getAttribute("uv").array), [0.25, 0.5, 0.75, 1]);
    assert.ok(geometry.getAttribute("skinIndex").array instanceof Uint16Array);
    assert.deepEqual(Array.from(geometry.getAttribute("skinIndex").array), [1, 2, 0, 0, 3, 0, 0, 0]);
});

test("a model load that never answers is given up on, and its fetch aborted", async () => {
    let fetchSignal = null;
    const started = Date.now();
    await assert.rejects(
        timeLimit((manager) => {
            fetchSignal = manager.abortController.signal;
            return new Promise(() => {});
        }, { label: "phone.glb", timeoutMs: 50 }),
        /phone\.glb timed out after 50 ms/
    );
    assert.ok(Date.now() - started >= 45);
    assert.equal(fetchSignal.aborted, true);
});

test("a model load ends when the scene's signal does", async () => {
    const controller = new AbortController();
    let fetchSignal = null;
    const loading = timeLimit((manager) => {
        fetchSignal = manager.abortController.signal;
        return new Promise(() => {});
    }, { label: "hands.glb", signal: controller.signal, timeoutMs: 60000 });
    controller.abort();
    await assert.rejects(loading, /hands\.glb was stopped/);
    assert.equal(fetchSignal.aborted, true);
});

test("a model that loads in time comes back as it is", async () => {
    const value = { scene: "glb" };
    assert.equal(await timeLimit(() => Promise.resolve(value), { label: "x", timeoutMs: 1000 }), value);
});
