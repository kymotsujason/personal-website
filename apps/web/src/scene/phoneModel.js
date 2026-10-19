import * as THREE from "three";
import { UNITS, plainGeometry, meshoptLoader, timeLimit } from "./handsModel.js";

// the phone: an iPhone Duo built in blender (art/phone/), in the spike's open pose. each part is baked into the spike's
// centimeters as a fresh group, so every build of the device gets its own copy, and its material slots are filled by
// name from the chosen finish
export const PARTS = ["Flap", "Body", "HingeCover", "CameraBlock"];
export const SLOTS = ["frame", "back", "glass", "hingeCover", "plateau", "lensGlass", "lensRing", "flash", "logo", "opening"];

// blender numbers a material it has seen before ("frame.001"), so the slot is the name before that
export const slotOf = (name) => name.replace(/\.\d+$/, "");

export const applyFinish = (object, materials) => {
    object.traverse((o) => {
        if (!o.isMesh) {
            return;
        }
        const slot = slotOf(o.material.name || "");
        if (!materials[slot]) {
            throw new Error(`the phone has a ${slot} slot the finish doesn't fill`);
        }
        o.material = materials[slot];
    });
};

export const bakePart = (object, scale) => {
    const group = new THREE.Group();
    group.name = object.name;
    const scaling = new THREE.Matrix4().makeScale(scale, scale, scale);
    object.traverse((o) => {
        if (!o.isMesh) {
            return;
        }
        const geometry = plainGeometry(o.geometry.clone());
        geometry.applyMatrix4(scaling.clone().multiply(o.matrixWorld));
        const copy = new THREE.Mesh(geometry, o.material.clone());
        copy.name = o.name;
        group.add(copy);
    });
    return group;
};

export const cameraSolid = (group) => {
    const box = new THREE.Box3().setFromObject(group);
    return { min: box.min.toArray(), max: box.max.toArray() };
};

// every slot in the file is one the code knows, and every finish fills every slot
export const checkSlots = (scene, finishes) => {
    scene.traverse((o) => {
        if (o.isMesh && !SLOTS.includes(slotOf(o.material.name || ""))) {
            throw new Error(`the phone glb has a ${slotOf(o.material.name || "")} slot the code doesn't know`);
        }
    });
    Object.entries(finishes).forEach(([finish, materials]) => {
        SLOTS.forEach((slot) => {
            if (!materials[slot]) {
                throw new Error(`the phone finish ${finish} has no ${slot} material`);
            }
        });
    });
};

// checked here, so a bad file fails the load (and the scene falls back to the flat page) instead of failing mid build
export const loadPhone = async (url, finishes, { signal = null } = {}) => {
    const gltf = await timeLimit((manager) => meshoptLoader(manager).loadAsync(url), { label: url, signal });
    gltf.scene.updateMatrixWorld(true);
    const parts = {};
    PARTS.forEach((name) => {
        const found = gltf.scene.getObjectByName(name);
        if (!found) {
            throw new Error(`the phone glb has no ${name}`);
        }
        parts[name] = found;
    });
    checkSlots(gltf.scene, finishes);
    return { parts };
};
