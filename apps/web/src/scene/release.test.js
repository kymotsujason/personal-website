import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { releaseImages, freeTexture } from "./release.js";

const bitmap = () => {
    const image = { width: 4, height: 4, closed: false };
    image.close = () => {
        image.closed = true;
    };
    return image;
};

test("a model's images are closed and let go, each once, the shader's uniforms' too", () => {
    const shared = bitmap();
    const map = new THREE.Texture(shared);
    const normal = new THREE.Texture(bitmap());
    const glow = new THREE.Texture(bitmap());
    let disposed = 0;
    [map, normal, glow].forEach((texture) => texture.addEventListener("dispose", () => disposed++));
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map, normalMap: normal })));
    const child = new THREE.Group();
    child.add(new THREE.Mesh(new THREE.BufferGeometry(), [new THREE.MeshBasicMaterial({ map }), new THREE.ShaderMaterial({ uniforms: { glow: { value: glow } } })]));
    root.add(child);
    // a model's own record (not an object3d) is passed over, and the roots after it are still freed
    releaseImages(null, { parts: {} }, root);
    assert.equal(shared.closed, true);
    assert.equal(map.image, null);
    assert.equal(normal.image, null);
    assert.equal(glow.image, null);
    assert.equal(disposed, 3);
});

test("a texture whose image can't be closed is still let go", () => {
    const texture = new THREE.Texture({ width: 2, height: 2 });
    freeTexture(texture);
    assert.equal(texture.image, null);
    freeTexture(null);
});
