import { expect, test } from "vitest";
import { DESK_FOV, DESK_REST_PITCH } from "../scene/shared/motion.js";
import { cubeMatrix, deskQuads, faceMatrix } from "./desk.js";

const FACES = {
  front: { dir: [0, 0, -1], up: [0, 1, 0] },
  right: { dir: [1, 0, 0], up: [0, 1, 0] },
  left: { dir: [-1, 0, 0], up: [0, 1, 0] },
};

test("the desk's faces land where the desk camera sees them", () => {
  const width = 1280;
  const height = 800;
  const focal = height / (2 * Math.tan((DESK_FOV / 2) * (Math.PI / 180)));
  const quads = Object.fromEntries(
    deskQuads({ width, height, size: 1044, faces: FACES, pitch: 0 }).map(
      (q) => [q.name, q],
    ),
  );

  // looking straight ahead, the 90 degree front face is a square 2 focal lengths across, centered
  const [tl, tr, br, bl] = quads.front.quad;
  const close = (p, q) => {
    expect(p[0]).toBeCloseTo(q[0], 6);
    expect(p[1]).toBeCloseTo(q[1], 6);
  };
  close(tl, [width / 2 - focal, height / 2 - focal]);
  close(tr, [width / 2 + focal, height / 2 - focal]);
  close(br, [width / 2 + focal, height / 2 + focal]);
  close(bl, [width / 2 - focal, height / 2 + focal]);
  expect(quads.front.rect).toEqual({ x0: 0, y0: 0, x1: 1044, y1: 1044 });

  // the side faces meet the front at its edges and reach past the window's, cut short of the camera
  close(quads.right.quad[0], tr);
  close(quads.right.quad[3], br);
  expect(quads.right.quad[1][0]).toBeGreaterThan(width);
  expect(quads.right.rect.x0).toBe(0);
  expect(quads.right.rect.x1).toBeLessThan(1044 / 2);
  close(quads.left.quad[1], tl);
  expect(quads.left.quad[0][0]).toBeLessThan(0);

  // tilted down, what's straight ahead shows above the middle
  const down = deskQuads({
    width,
    height,
    size: 1044,
    faces: FACES,
    pitch: -5,
  });
  const front = down.find((q) => q.name === "front").quad;
  expect((front[0][1] + front[3][1]) / 2).toBeLessThan(height / 2);
});

// a 4 by 4 matrix3d (column major, as css takes it) applied to a point, then the perspective of the desk's cube
const product = (a, b) =>
  Array.from({ length: 16 }, (_, n) => {
    const col = n >> 2;
    const row = n & 3;
    return [0, 1, 2, 3].reduce(
      (sum, k) => sum + a[4 * k + row] * b[4 * col + k],
      0,
    );
  });
const onScreen = (m, [x, y], { width, height, focal }) => {
  const px = m[0] * x + m[4] * y + m[12];
  const py = m[1] * x + m[5] * y + m[13];
  const pz = m[2] * x + m[6] * y + m[14];
  const scale = focal / (focal - pz);
  return [width / 2 + px * scale, height / 2 + py * scale];
};

test("the css cube puts each face where the desk camera sees it, at any view", () => {
  const width = 1280;
  const height = 800;
  const size = 1044;
  const focal = height / (2 * Math.tan((DESK_FOV / 2) * (Math.PI / 180)));
  const view = { width, height, focal };
  [
    [0, DESK_REST_PITCH],
    [20, -8],
    [10, 14],
    [-25, 6],
  ].forEach(([yaw, pitch]) => {
    const all = {
      ...FACES,
      up: { dir: [0, 1, 0], up: [0, 0, 1] },
      down: { dir: [0, -1, 0], up: [0, 0, -1] },
    };
    const quads = deskQuads({ width, height, size, faces: all, yaw, pitch });
    const cube = cubeMatrix(yaw, pitch, focal);
    quads.forEach(({ name, rect, quad }) => {
      const m = product(cube, faceMatrix(all[name], focal));
      // the rect's corners in the face's px from its center, at 2 focal lengths across
      const local = ([ix, iy]) => [
        ((ix / size) * 2 - 1) * focal,
        ((iy / size) * 2 - 1) * focal,
      ];
      const corners = [
        [rect.x0, rect.y0],
        [rect.x1, rect.y0],
        [rect.x1, rect.y1],
        [rect.x0, rect.y1],
      ];
      corners.forEach((corner, i) => {
        const got = onScreen(m, local(corner), view);
        expect(got[0]).toBeCloseTo(quad[i][0], 6);
        expect(got[1]).toBeCloseTo(quad[i][1], 6);
      });
    });
  });
});
