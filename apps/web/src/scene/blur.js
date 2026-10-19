import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// a soft copy of a texture for frosted glass to show: the source drawn at a quarter size, then blurred across and
// down with a wide gaussian. it stays in the source's raw srgb values, the way the composite blends the sky
const SCALE = 4;
const TAPS = 9;

const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

const fragmentShader = `
    uniform sampler2D source;
    uniform vec2 stride;
    varying vec2 vUv;
    void main() {
        vec3 sum = vec3(0.0);
        float total = 0.0;
        for (int i = -${TAPS}; i <= ${TAPS}; i++) {
            float x = float(i);
            float w = exp(-x * x / ${((TAPS * TAPS) / 4).toFixed(2)});
            sum += texture2D(source, vUv + stride * x).rgb * w;
            total += w;
        }
        gl_FragColor = vec4(sum / total, 1.0);
    }
`;

export const createBlur = (renderer, source, width, height) => {
    const w = Math.max(Math.round(width / SCALE), 1);
    const h = Math.max(Math.round(height / SCALE), 1);
    const options = { colorSpace: THREE.NoColorSpace, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    const across = new THREE.WebGLRenderTarget(w, h, options);
    const down = new THREE.WebGLRenderTarget(w, h, options);
    const material = new THREE.ShaderMaterial({
        uniforms: { source: { value: source }, stride: { value: new THREE.Vector2() } },
        vertexShader,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending
    });
    const quad = new FullScreenQuad(material);
    const pass = (from, to, stride) => {
        material.uniforms.source.value = from;
        material.uniforms.stride.value.copy(stride);
        renderer.setRenderTarget(to);
        quad.render(renderer);
    };
    return {
        texture: down.texture,
        render: () => {
            const previous = renderer.getRenderTarget();
            pass(source, across, new THREE.Vector2(1.5 / w, 0));
            pass(across.texture, down, new THREE.Vector2(0, 1.5 / h));
            renderer.setRenderTarget(previous);
        },
        dispose: () => {
            across.dispose();
            down.dispose();
            material.dispose();
        }
    };
};
