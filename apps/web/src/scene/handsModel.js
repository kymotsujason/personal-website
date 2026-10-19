import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// the hands: a cc0 makehuman hand (art/hands/) on the old rig's skeleton. the finger keys add their curls to each
// bone's starting rotation (hands.js applyJoints), so the skeleton is the old rig's own numbers (models/hands-rig.json),
// and the mesh is bound with the old bone inverses. the glb only brings the mesh and its weights
export const UNITS = 100;

export const buildRig = (rig) => {
    const root = new THREE.Group();
    const bones = {};
    const list = rig.bones.map((b) => {
        const bone = new THREE.Bone();
        bone.name = b.name;
        bone.position.fromArray(b.position);
        // the order goes first, so the euler the quaternion sets is in the order the keys add their curls in
        bone.rotation.order = b.order;
        bone.quaternion.fromArray(b.quaternion);
        bone.scale.fromArray(b.scale);
        bones[b.name] = bone;
        return bone;
    });
    rig.bones.forEach((b, i) => {
        (b.parent ? bones[b.parent] : root).add(list[i]);
    });
    const bind = {};
    list.forEach((bone) => {
        bind[bone.name] = bone.rotation.clone();
    });
    const boneInverses = rig.bones.map((b) => new THREE.Matrix4().fromArray(b.inverse));
    return { root, bones, bind, list, boneInverses };
};

// the glb's skin indexes its own joint list, so each index is moved to the rig's bone of the same name
export const remapSkin = (skinIndex, fromNames, toNames) => {
    const at = new Map(toNames.map((n, i) => [n, i]));
    const map = fromNames.map((n) => {
        if (!at.has(n)) {
            throw new Error(`the hands' skin uses ${n}, which the rig doesn't have`);
        }
        return at.get(n);
    });
    return Array.from(skinIndex, (i) => map[i]);
};

// the glbs are packed with meshopt (tools/packModels.sh), which keeps normals, uvs, and skin weights as scaled
// integers. three reads those fine, but moving or scaling a geometry in place would clamp them, so every attribute
// comes out as plain floats first, and the skin's bone indices as plain integers
export const plainGeometry = (geometry) => {
    const getters = ["getX", "getY", "getZ", "getW"];
    Object.entries(geometry.attributes).forEach(([name, attribute]) => {
        const { itemSize, count } = attribute;
        const indices = name === "skinIndex";
        const array = indices ? new Uint16Array(count * itemSize) : new Float32Array(count * itemSize);
        for (let i = 0; i < count; i++) {
            for (let k = 0; k < itemSize; k++) {
                array[i * itemSize + k] = attribute[getters[k]](i);
            }
        }
        geometry.setAttribute(name, indices ? new THREE.Uint16BufferAttribute(array, itemSize) : new THREE.Float32BufferAttribute(array, itemSize));
    });
    return geometry;
};

export const meshoptLoader = (manager) => new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);

// a model's load gives up 8 s after it starts, or as soon as the signal ends, and either way its fetch is aborted
// through the load's own manager. load is given that manager
export const MODEL_TIMEOUT_MS = 8000;
export const timeLimit = (load, { label, signal = null, timeoutMs = MODEL_TIMEOUT_MS } = {}) => {
    const manager = new THREE.LoadingManager();
    return new Promise((resolve, reject) => {
        let timer = null;
        const onAbort = () => end(new Error(`${label} was stopped`));
        const end = (error) => {
            clearTimeout(timer);
            if (signal) {
                signal.removeEventListener("abort", onAbort);
            }
            if (error) {
                manager.abort();
                reject(error);
            }
        };
        if (signal && signal.aborted) {
            onAbort();
            return;
        }
        if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
        }
        timer = setTimeout(() => end(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
        load(manager).then((value) => {
            end(null);
            resolve(value);
        }, (error) => {
            end(error);
        });
    });
};

// the glb's mesh in the space the old skin was bound in: its own placement in the file, then blender's meters to the
// spike's centimeters, with its skin pointing at the rig's bones
export const prepareGeometry = (source, rigNames) => {
    const geometry = plainGeometry(source.geometry.clone());
    geometry.applyMatrix4(new THREE.Matrix4().makeScale(UNITS, UNITS, UNITS).multiply(source.matrixWorld));
    const skinIndex = geometry.getAttribute("skinIndex");
    const remapped = remapSkin(skinIndex.array, source.skeleton.bones.map((b) => b.name), rigNames);
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(remapped, 4));
    if (!geometry.getAttribute("normal")) {
        geometry.computeVertexNormals();
    }
    return geometry;
};

// a skinned mesh (the glb's, with its world matrix current) on the rebuilt rig. the bind matrix is given, so three
// keeps the rig's own bone inverses: left to work them out, it would bind in the bones' starting pose, which is up to
// about 40 units from the pose the skin was made in
export const bindHands = (source, rig) => {
    const { root, bones, bind, list, boneInverses } = buildRig(rig);
    const mesh = new THREE.SkinnedMesh(prepareGeometry(source, list.map((b) => b.name)), new THREE.MeshStandardMaterial());
    mesh.bind(new THREE.Skeleton(list, boneInverses), new THREE.Matrix4());
    root.add(mesh);
    return { root, mesh, bind, bones };
};

export const loadHands = async (url, rig, { signal = null } = {}) => {
    const gltf = await timeLimit((manager) => meshoptLoader(manager).loadAsync(url), { label: url, signal });
    gltf.scene.updateMatrixWorld(true);
    let source = null;
    gltf.scene.traverse((o) => {
        if (o.isSkinnedMesh && !source) {
            source = o;
        }
    });
    if (!source) {
        throw new Error("no skinned mesh in the hands glb");
    }
    return bindHands(source, rig);
};
