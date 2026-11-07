// @vitest-environment jsdom
import { expect, test } from "vitest";
import { createRain, fallFor } from "./rain.js";

test("each scene falls as the 3d glass has it", () => {
  expect(fallFor({ scene: "clear", intensity: "moderate" }, 1).kind).toBeNull();
  expect(fallFor({ scene: "fog", intensity: "moderate" }, 1).kind).toBeNull();
  expect(fallFor({ scene: "drizzle", intensity: "light" }, 1).kind).toBe(
    "drizzle",
  );
  expect(fallFor({ scene: "thunder", intensity: "heavy" }, 1).kind).toBe(
    "rain",
  );
  expect(fallFor({ scene: "snow", intensity: "heavy" }, 0).kind).toBe("snow");
  expect(fallFor({ scene: "rain", intensity: "heavy" }, 1).k).toBe(1);
  expect(fallFor({ scene: "rain", intensity: "light" }, 1).k).toBe(0.35);
  // rain's day color is the pale one at 0.32, and snow keeps 0.85
  expect(fallFor({ scene: "rain", intensity: "moderate" }, 1).color).toBe(
    "rgba(224, 232, 245, 0.32)",
  );
  expect(fallFor({ scene: "snow", intensity: "moderate" }, 1).color).toBe(
    "rgba(247, 250, 255, 0.85)",
  );
});

test("the fall goes into each sky under the dim, hidden when nothing falls, and still pauses it", () => {
  const sky = document.createElement("div");
  sky.innerHTML = '<div class="clouds"></div><div class="dim"></div>';
  const rain = createRain({ skies: [sky] });
  const el = sky.querySelector(".flat-fall");
  expect(el.hidden).toBe(true);
  expect(el.nextElementSibling.className).toBe("dim");
  rain.set(fallFor({ scene: "rain", intensity: "moderate" }, 0));
  expect(el.hidden).toBe(false);
  expect(el.dataset.kind).toBe("rain");
  expect(el.querySelectorAll("i")).toHaveLength(3);
  rain.setStill(true);
  expect(el.hasAttribute("data-still")).toBe(true);
  rain.setStill(false);
  expect(el.hasAttribute("data-still")).toBe(false);
  rain.set(fallFor({ scene: "clear", intensity: "moderate" }, 0));
  expect(el.hidden).toBe(true);
  rain.destroy();
  expect(sky.querySelector(".flat-fall")).toBeNull();
});
