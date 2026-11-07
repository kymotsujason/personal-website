// the cpu side copies of the scene's images, let go once the scene has stopped: an image bitmap is closed, and any other
// image is dropped from its texture, so neither stays held for the rest of the page load (a handoff to the 2d scene,
// say, which decodes its own frames on top)
export const freeTexture = (texture) => {
    if (!texture || !texture.isTexture) {
        return;
    }
    const image = texture.image;
    if (image && typeof image.close === "function") {
        image.close();
    }
    texture.image = null;
    texture.dispose();
};

const texturesOf = (material) => {
    const values = Object.values(material);
    if (material.uniforms) {
        values.push(...Object.values(material.uniforms).map((uniform) => uniform && uniform.value));
    }
    return values.filter((value) => value && value.isTexture);
};

// every texture on the materials under each root (and a scene's background and environment), each freed once. a root
// that isn't an object3d is passed over, so it can't keep the others' images held
export const releaseImages = (...roots) => {
    const found = new Set();
    roots.forEach((root) => {
        if (!root || typeof root.traverse !== "function") {
            return;
        }
        root.traverse((object) => {
            [object.material].flat().forEach((material) => {
                if (material) {
                    texturesOf(material).forEach((texture) => found.add(texture));
                }
            });
        });
        [root.background, root.environment].forEach((value) => {
            if (value && value.isTexture) {
                found.add(value);
            }
        });
    });
    found.forEach(freeTexture);
};
