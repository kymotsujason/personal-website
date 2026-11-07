import { expect, test } from "vitest";
import {
  AVOID_GAIN,
  AVOID_MAX,
  DESK_FOV,
  DESK_REST_PITCH,
} from "../scene/shared/motion.js";
import {
  REST_VIEW,
  clampView,
  dodgeFor,
  lookBy,
  motionPose,
  stepAvoid,
  stepView,
  trailOf,
  createView,
} from "./look.js";

// the 3d scene's clamp as backdrop.js had it before it moved into scene/shared/lookLimits.js, written out with plain math
const old = (() => {
  const rad = (d) => (d * Math.PI) / 180;
  const DESK = {
    lonMin: -100.72,
    lonMax: 83.16,
    latMin: -62.6,
    latMax: 78.48,
    forward: -14,
    topLat: 50,
  };
  const MARGIN = 2;
  const halfV = DESK_FOV / 2;
  const pitchLimits = [
    DESK.latMin + halfV + MARGIN,
    Math.min(DESK.latMax - MARGIN, DESK.topLat) - halfV,
  ];
  const rest = Math.max(
    pitchLimits[0],
    Math.min(pitchLimits[1], DESK_REST_PITCH),
  );
  const lonSpan = (aspect, yaw, pitch) => {
    const tanV = Math.tan(rad(halfV));
    const tanH = tanV * aspect;
    const a = rad(-yaw);
    const p = rad(pitch);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= 32; i++) {
      const t = (i / 32) * 4;
      const side = Math.floor(Math.min(t, 3.999));
      const f = t - side;
      const u = [-1 + 2 * f, 1, 1 - 2 * f, -1][side];
      const v = [1, 1 - 2 * f, -1, -1 + 2 * f][side];
      const x = u * tanH;
      const y = v * tanV;
      const x1 = x * Math.cos(a) - Math.sin(a);
      const z1 = -x * Math.sin(a) - Math.cos(a);
      const z2 = y * Math.sin(p) + z1 * Math.cos(p);
      const lon = (Math.atan2(x1, -z2) * 180) / Math.PI;
      lo = Math.min(lo, lon);
      hi = Math.max(hi, lon);
    }
    return [lo, hi];
  };
  const limits = (aspect, pitch) => {
    const lonLo = DESK.lonMin - DESK.forward + MARGIN;
    const lonHi = DESK.lonMax - DESK.forward - MARGIN;
    const solve = (side, bound) => {
      let a = -180;
      let b = 180;
      for (let i = 0; i < 30; i++) {
        const m = (a + b) / 2;
        const reach = lonSpan(aspect, m, pitch)[side];
        if (side === 0 ? reach < bound : reach <= bound) a = m;
        else b = m;
      }
      return side === 0 ? b : a;
    };
    const yawMin = solve(0, lonLo);
    const yawMax = solve(1, lonHi);
    const center = (DESK.lonMin + DESK.lonMax) / 2 - DESK.forward;
    return {
      yaw: yawMin <= yawMax ? [yawMin, yawMax] : [center, center],
      pitch: pitchLimits[0] <= pitchLimits[1] ? pitchLimits : [rest, rest],
    };
  };
  const clamp = (aspect, yaw, pitch) => {
    const [lo, hi] = limits(aspect, pitch).pitch;
    const p = Math.min(Math.max(pitch, lo), hi);
    const l = limits(aspect, p);
    return { yaw: Math.min(Math.max(yaw, l.yaw[0]), l.yaw[1]), pitch: p };
  };
  return { rest, clamp };
})();

test("the look clamp matches the 3D clamp at 1280 by 800", () => {
  const aspect = 1280 / 800;
  expect(REST_VIEW.pitch).toBe(old.rest);
  // far past every edge, then a spread of targets inside and outside
  const targets = [
    [500, 500],
    [-500, -500],
    [500, -500],
    [-500, 500],
    [0, REST_VIEW.pitch],
    [20, -10],
    [-20, 5],
    [35, -22],
  ];
  targets.forEach(([yaw, pitch]) => {
    const mine = clampView({ yaw, pitch }, aspect);
    const theirs = old.clamp(aspect, yaw, pitch);
    expect(mine.yaw).toBeCloseTo(theirs.yaw, 9);
    expect(mine.pitch).toBeCloseTo(theirs.pitch, 9);
  });
  // the numbers the 3d scene reached at this window, so a change to both sides at once still fails
  const corner = clampView({ yaw: 500, pitch: REST_VIEW.pitch }, aspect);
  expect(corner.yaw).toBeCloseTo(43.8896, 3);
  expect(
    clampView({ yaw: -500, pitch: REST_VIEW.pitch }, aspect).yaw,
  ).toBeCloseTo(-33.4484, 3);
  expect(clampView({ yaw: 0, pitch: 500 }, aspect).pitch).toBeCloseTo(12.5, 9);
  expect(clampView({ yaw: 0, pitch: -500 }, aspect).pitch).toBeCloseTo(
    -23.1,
    9,
  );
});

test("a drag moves the target by the view's degrees per px, and the view eases after it", () => {
  const view = createView();
  lookBy(view, 10, 5, 1.6);
  expect(view.targetYaw).toBe(10);
  expect(view.targetPitch).toBeCloseTo(REST_VIEW.pitch + 5, 9);
  expect(view.yaw).toBe(0);
  stepView(view, 1 / 60, 1.6);
  const k = 1 - Math.exp(-12 / 60);
  expect(view.yaw).toBeCloseTo(10 * k, 9);
  // the phone trails the view while it catches up
  expect(trailOf(view).yaw).toBeCloseTo(10 * (1 - k), 9);
  for (let i = 0; i < 600; i++) stepView(view, 1 / 60, 1.6);
  expect(view.yaw).toBeCloseTo(10, 4);
  expect(trailOf(view).yaw).toBeCloseTo(0, 4);
});

test("the trail is held to 12 degrees", () => {
  const view = createView();
  lookBy(view, 40, 0, 1.6);
  expect(trailOf(view).yaw).toBe(12);
});

const outer = { left: 400, right: 800, top: 200, bottom: 600 };

test("the dodge is off on touch", () => {
  const touch = dodgeFor({
    pointerType: "touch",
    phone: "closed",
    busy: false,
    looking: false,
    x: 1000,
    y: 400,
    outer,
    avoid: { x: 0, y: 0 },
    width: 1280,
    height: 800,
  });
  expect(touch).toBeNull();
  const pen = dodgeFor({
    pointerType: "pen",
    phone: "closed",
    busy: false,
    looking: false,
    x: 1000,
    y: 400,
    outer,
    avoid: { x: 0, y: 0 },
    width: 1280,
    height: 800,
  });
  expect(pen).toBeNull();
  const open = dodgeFor({
    pointerType: "mouse",
    phone: "open",
    busy: false,
    looking: false,
    x: 1000,
    y: 400,
    outer,
    avoid: { x: 0, y: 0 },
    width: 1280,
    height: 800,
  });
  expect(open).toBeNull();
  const busy = dodgeFor({
    pointerType: "mouse",
    phone: "closed",
    busy: true,
    looking: false,
    x: 1000,
    y: 400,
    outer,
    avoid: { x: 0, y: 0 },
    width: 1280,
    height: 800,
  });
  expect(busy).toBeNull();
});

test("the dodge moves away from a mouse over the desk, by the gain, capped, and not at all over the phone", () => {
  const base = {
    pointerType: "mouse",
    phone: "closed",
    busy: false,
    looking: false,
    outer,
    avoid: { x: 0, y: 0 },
    width: 1280,
    height: 800,
  };
  const near = dodgeFor({ ...base, x: 850, y: 400 });
  expect(near.tx).toBeCloseTo(-50 * AVOID_GAIN, 9);
  expect(near.ty).toBeCloseTo(0, 9);
  const far = dodgeFor({ ...base, x: 1280, y: 800 });
  expect(Math.hypot(far.tx, far.ty)).toBeCloseTo(AVOID_MAX * 800, 9);
  expect(far.tx).toBeLessThan(0);
  expect(far.ty).toBeLessThan(0);
  const over = dodgeFor({ ...base, x: 500, y: 300 });
  expect(over.tx + 0).toBeCloseTo(0, 9);
  // the phone's spot is where it would be without the move it has now
  const moved = dodgeFor({ ...base, avoid: { x: -50, y: 0 }, x: 900, y: 400 });
  expect(moved.tx).toBeCloseTo(-50 * AVOID_GAIN, 9);
});

test("the dodge eases toward its target and returns to nothing when off", () => {
  const avoid = { tx: 20, ty: -10, x: 0, y: 0 };
  stepAvoid(avoid, 1 / 60, false);
  const k = 1 - Math.exp(-4 / 60);
  expect(avoid.x).toBeCloseTo(20 * k, 9);
  expect(avoid.y).toBeCloseTo(-10 * k, 9);
  stepAvoid(avoid, 1 / 60, true);
  expect(avoid.tx).toBe(0);
  expect(avoid.ty).toBe(0);
});

test("the pose gets the drift, the dodge, and the trail the way the 3d loop adds them", () => {
  const pose = { x: 1, y: 2, z: -40, rx: 0.1, ry: 0.2, rz: 0.3 };
  const out = motionPose({
    pose,
    drift: { x: 0.01, y: 0.02, z: 0.03 },
    avoid: { x: 40, y: -20 },
    trail: { yaw: 5, pitch: -5 },
    focal: 500,
  });
  const perPx = 40 / 500;
  expect(out.x).toBeCloseTo(1 + 0.01 + 40 * perPx, 9);
  expect(out.y).toBeCloseTo(2 + 0.02 + 20 * perPx, 9);
  expect(out.z).toBeCloseTo(-40 + 0.03, 9);
  expect(out.rx).toBeCloseTo(0.1 + 5 * 0.004 + -20 * 0.0003, 9);
  expect(out.ry).toBeCloseTo(0.2 - 5 * 0.006 + 40 * 0.0004, 9);
  expect(out.rz).toBeCloseTo(0.3 - 40 * 0.0003, 9);
  // nothing to add leaves the same pose
  expect(
    motionPose({
      pose,
      drift: { x: 0, y: 0, z: 0 },
      avoid: { x: 0, y: 0 },
      trail: { yaw: 0, pitch: 0 },
      focal: 500,
    }),
  ).toEqual(pose);
});
