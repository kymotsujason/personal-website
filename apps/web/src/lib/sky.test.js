import { expect, test } from "vitest";
import { applySky, skyColors, skyVars } from "./sky";

const close = (got, want) => {
  expect(got).toHaveLength(3);
  want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 3));
};

test("clear night uses the night pair", () => {
  const { top, low } = skyColors({
    day: 0,
    warm: 0,
    scene: "clear",
    intensity: "moderate",
  });
  close(top, [0.05, 0.07, 0.2]);
  close(low, [0.24, 0.18, 0.42]);
});

test("clear day uses the day pair", () => {
  const { top, low } = skyColors({
    day: 1,
    warm: 0,
    scene: "clear",
    intensity: "moderate",
  });
  close(top, [0.17, 0.42, 0.8]);
  close(low, [0.47, 0.7, 0.94]);
});

test("dusk turns the bottom pink", () => {
  const { top, low } = skyColors({
    day: 0.5,
    warm: 1,
    scene: "clear",
    intensity: "moderate",
  });
  close(top, [0.11, 0.245, 0.5]);
  close(low, [0.77875, 0.5, 0.5825]);
});

test("a cloudy day is greyer and darker", () => {
  const { top } = skyColors({
    day: 1,
    warm: 0,
    scene: "cloudy",
    intensity: "moderate",
  });
  close(top, [0.2757, 0.4059, 0.6008]);
});

test("fog by day uses the haze colors", () => {
  const { top, low } = skyColors({
    day: 1,
    warm: 0,
    scene: "fog",
    intensity: "moderate",
  });
  close(top, [0.4, 0.45, 0.53]);
  close(low, [0.42, 0.47, 0.54]);
});

test("rain darkens more as it gets heavier", () => {
  const light = skyColors({
    day: 1,
    warm: 0,
    scene: "rain",
    intensity: "light",
  });
  const heavy = skyColors({
    day: 1,
    warm: 0,
    scene: "rain",
    intensity: "heavy",
  });
  expect(heavy.top[0]).toBeLessThan(light.top[0]);
});

const night = {
  day: 0,
  warm: 0,
  scene: "clear",
  intensity: "moderate",
  sunUp: 0,
  moonUp: 0,
  sun: null,
  moon: null,
};

test("skyVars gives rgb strings and the star amount", () => {
  const vars = skyVars(night);
  expect(vars["--sky-top"]).toBe("rgb(13, 18, 51)");
  expect(vars["--sky-low"]).toBe("rgb(61, 46, 107)");
  expect(vars["--stars"]).toBe("1");
  expect(skyVars({ ...night, day: 1 })["--stars"]).toBe("0");
});

test("the sun glow sits at the sun with y from the top", () => {
  const vars = skyVars({ ...night, day: 1, sunUp: 1, sun: [0.25, 0.8] });
  expect(vars["--sun-x"]).toBe("25%");
  expect(vars["--sun-y"]).toBe("20%");
  expect(vars["--sun-glow"]).toMatch(/^rgba\(255, 25\d, 2[34]\d, 0\.[1-9]/);
});

test("the sun glow is warm near sunset and transparent when down", () => {
  const warm = skyVars({
    ...night,
    day: 0.5,
    warm: 1,
    sunUp: 1,
    sun: [0.9, 0.05],
  });
  expect(warm["--sun-glow"]).toMatch(/^rgba\(255, 199, 140/);
  expect(skyVars(night)["--sun-glow"]).toBe("transparent");
  expect(skyVars({ ...night, sunUp: 1, sun: [0.5, -1] })["--sun-glow"]).toBe(
    "transparent",
  );
});

test("the moon glow shows only while the moon is up", () => {
  const up = skyVars({ ...night, moonUp: 1, moon: [0.7, 0.5] });
  expect(up["--moon-x"]).toBe("70%");
  expect(up["--moon-y"]).toBe("50%");
  expect(up["--moon-glow"]).not.toBe("transparent");
  expect(skyVars(night)["--moon-glow"]).toBe("transparent");
});

test("applySky sets each property on the root", () => {
  const set = [];
  applySky(
    { style: { setProperty: (k, v) => set.push([k, v]) } },
    { "--a": "1", "--b": "2" },
  );
  expect(set).toEqual([
    ["--a", "1"],
    ["--b", "2"],
  ]);
});

test("clouds and fog hide the stars", () => {
  const stars = (scene) => Number(skyVars({ ...night, scene })["--stars"]);
  expect(stars("cloudy")).toBeLessThan(stars("clear"));
  expect(stars("cloudy")).toBeGreaterThan(0);
  expect(stars("fog")).toBe(0);
});

const noon = { ...night, day: 1, sunUp: 1, sun: [0.5, 0.8] };

test("a clear night keeps the night floors for the dim", () => {
  const vars = skyVars(night);
  expect(vars["--dim-top"]).toBe("0.15");
  expect(vars["--dim-low"]).toBe("0.35");
});

test("a bright day is dimmed more than a dark one", () => {
  const dim = (vars) => Number(vars["--dim-low"]);
  const bright = skyVars({ ...noon, scene: "partly cloudy" });
  const dark = skyVars({ ...noon, scene: "thunder" });
  expect(Number(bright["--dim-top"])).toBeGreaterThan(
    Number(dark["--dim-top"]),
  );
  expect(dim(bright)).toBeGreaterThan(dim(dark));
  expect(dim(dark)).toBeGreaterThanOrEqual(0.55);
});

test("the sun glow adds to the dim over it", () => {
  const without = skyVars({ ...noon, sunUp: 0, sun: null });
  const lit = skyVars(noon);
  expect(Number(lit["--dim-top"])).toBeGreaterThan(
    Number(without["--dim-top"]),
  );
});

test("clouds show by their scene's cover, lit by day and dim at night", () => {
  const at = (scene, day) =>
    skyVars({
      day,
      warm: 0,
      scene,
      intensity: "moderate",
      sun: null,
      moon: null,
    });
  expect(at("clear", 1)["--clouds"]).toBe("0");
  expect(at("cloudy", 1)["--clouds"]).toBe("1");
  expect(Number(at("partly cloudy", 1)["--clouds"])).toBeCloseTo(
    0.45 / 0.85,
    3,
  );
  const noon = Number(at("cloudy", 1)["--cloud-light"]);
  const night = Number(at("cloudy", 0)["--cloud-light"]);
  expect(noon).toBeGreaterThan(night * 2);
  expect(Number(at("thunder", 1)["--cloud-light"])).toBeLessThan(noon);
});

const glowAlpha = (glow) => Number(/, ([\d.]+)\)$/.exec(glow)[1]);
// the wallpaper shader's smoothstep(-0.03, 0.05, y) as a body sinks past the bottom edge (scene/wallpaper.js)
const shaderFade = (y) => {
  const t = Math.min(Math.max((y + 0.03) / 0.08, 0), 1);
  return t * t * (3 - 2 * t);
};

test("the sun glow fades past the bottom edge on the shader's curve", () => {
  const sunAt = (y) =>
    glowAlpha(
      skyVars({ ...night, day: 1, sunUp: 1, sun: [0.5, y] })["--sun-glow"],
    );
  const full = sunAt(0.8);
  for (const y of [-0.02, -0.01, 0.03]) {
    expect(sunAt(y) / full).toBeCloseTo(shaderFade(y), 2);
  }
});

test("the moon glow fades past the bottom edge on the shader's curve", () => {
  const moonAt = (y) =>
    glowAlpha(skyVars({ ...night, moonUp: 1, moon: [0.5, y] })["--moon-glow"]);
  const full = moonAt(0.8);
  for (const y of [-0.02, -0.01, 0.03]) {
    expect(moonAt(y) / full).toBeCloseTo(shaderFade(y), 2);
  }
});
