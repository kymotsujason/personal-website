import * as THREE from "three";

// the intro's blur over the whole frame. it was a css filter on the page, which has to be blurred again every frame
// as the radius eases, at a cost that grows with the radius on a phone's dense screen. here the frame
// that was just drawn is copied into a texture with mipmaps and drawn back blurred, as a spiral of samples from a
// coarser mip level (like the desk's own blur in backdrop.js). the copy holds the canvas's final colors, so they're
// drawn back as they are, with no tone mapping or color conversion of their own
const SAMPLES = 24;

const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

const fragmentShader = `
    uniform sampler2D source;
    uniform vec2 texel;
    uniform float sigma;
    varying vec2 vUv;
    void main() {
        float lod = max(0.0, log2(sigma / 1.5));
        float turn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
        vec4 sum = vec4(0.0);
        float total = 0.0;
        for (int i = 0; i < ${SAMPLES}; i++) {
            float fi = float(i);
            float r = sqrt((fi + 0.5) / ${SAMPLES.toFixed(1)}) * 2.0 * sigma;
            float a = fi * 2.39996323 + turn;
            float w = exp(-0.5 * r * r / (sigma * sigma));
            sum += textureLod(source, vUv + vec2(cos(a), sin(a)) * r * texel, lod) * w;
            total += w;
        }
        gl_FragColor = sum / total;
    }
`;

export const createFocusBlur = (renderer) => {
    const material = new THREE.ShaderMaterial({
        uniforms: { source: { value: null }, texel: { value: new THREE.Vector2() }, sigma: { value: 1 } },
        vertexShader,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
        toneMapped: false
    });
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    scene.add(quad);
    const size = new THREE.Vector2();
    let copy = null;

    // a texture the size of the drawing buffer, with its mip levels allocated empty, made again when the size changes
    const fit = () => {
        renderer.getDrawingBufferSize(size);
        const w = Math.max(1, size.x);
        const h = Math.max(1, size.y);
        if (copy && copy.image.width === w && copy.image.height === h) {
            return copy;
        }
        if (copy) {
            copy.dispose();
        }
        copy = new THREE.DataTexture(null, w, h);
        copy.minFilter = THREE.LinearMipmapLinearFilter;
        copy.magFilter = THREE.LinearFilter;
        copy.generateMipmaps = true;
        copy.source.dataReady = false;
        copy.needsUpdate = true;
        renderer.initTexture(copy);
        material.uniforms.source.value = copy;
        material.uniforms.texel.value.set(1 / w, 1 / h);
        return copy;
    };

    return {
        // makes the texture and compiles the shader, while the page is still black
        prewarm: () => {
            fit();
            renderer.compile(scene, camera);
        },
        // sigma is the blur's radius in the drawing buffer's px. called right after the frame is drawn to the canvas
        draw: (sigma) => {
            const texture = fit();
            renderer.copyFramebufferToTexture(texture);
            const gl = renderer.getContext();
            renderer.state.bindTexture(gl.TEXTURE_2D, renderer.properties.get(texture).__webglTexture);
            gl.generateMipmap(gl.TEXTURE_2D);
            renderer.state.unbindTexture();
            material.uniforms.sigma.value = Math.max(sigma, 0.01);
            renderer.render(scene, camera);
        }
    };
};
