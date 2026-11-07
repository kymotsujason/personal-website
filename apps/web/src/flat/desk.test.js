import { expect, test } from "vitest";
import { DESK_FOV } from "../scene/shared/motion.js";
import { deskQuads } from "./desk.js";

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
