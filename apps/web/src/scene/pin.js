const adjugate = (m) => [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]
];

const multiply = (a, b) => {
    const c = new Array(9);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            let sum = 0;
            for (let k = 0; k < 3; k++) {
                sum += a[3 * i + k] * b[3 * k + j];
            }
            c[3 * i + j] = sum;
        }
    }
    return c;
};

const multiplyVector = (m, v) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
];

const basisToPoints = (p) => {
    const m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1];
    const v = multiplyVector(adjugate(m), [p[3][0], p[3][1], 1]);
    return multiply(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
};

// homography from the element's own rect onto four projected corners (tl, tr, bl, br), as one flat matrix3d
export const cornerPin = (w, h, corners) => {
    const source = basisToPoints([[0, 0], [w, 0], [0, h], [w, h]]);
    const target = basisToPoints(corners);
    const t = multiply(target, adjugate(source));
    const n = t.map((value) => value / t[8]);
    // a surface facing the camera squarely has no perspective terms, so it gets a 2d matrix and the browser's 2d path
    if (Math.abs(n[6]) < 1e-8 && Math.abs(n[7]) < 1e-8) {
        return `matrix(${n[0]}, ${n[3]}, ${n[1]}, ${n[4]}, ${n[2]}, ${n[5]})`;
    }
    return `matrix3d(${n[0]}, ${n[3]}, 0, ${n[6]}, ${n[1]}, ${n[4]}, 0, ${n[7]}, 0, 0, 1, 0, ${n[2]}, ${n[5]}, 0, 1)`;
};

// the other way: a point on screen back to the spot on the element (in its own px) that's drawn there
export const unpin = (w, h, corners, point) => {
    const source = basisToPoints([[0, 0], [w, 0], [0, h], [w, h]]);
    const target = basisToPoints(corners);
    const back = multiply(source, adjugate(target));
    const [x, y, z] = multiplyVector(back, [point[0], point[1], 1]);
    return [x / z, y / z];
};

// positive when the projected quad keeps its orientation, so the surface faces the viewer
export const facing = (corners) => {
    const [tl, tr, bl] = corners;
    const ax = tr[0] - tl[0];
    const ay = tr[1] - tl[1];
    const bx = bl[0] - tl[0];
    const by = bl[1] - tl[1];
    return ax * by - ay * bx;
};
