// drizzle, rain, and snow on the faces' skies, by the weather, as scene/precipitation.js has them: what falls in each
// scene, in the 3d glass's colors and intensities. the drops are css (styles/flat-scene.css), so this only picks the
// kind and the color and says whether they move

// what falls in each scene (precipitation.js KINDS): thunder falls as rain
const KINDS = {
  drizzle: "drizzle",
  rain: "rain",
  thunder: "rain",
  snow: "snow",
};
const INTENSITY = { light: 0.35, moderate: 0.65, heavy: 1 };

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// the glass's colors (precipitation.js): rain a grey blue by night and a pale one by day, snow near white, dimmer by
// night. alpha is how strong the drops are, and k the weather's intensity from 0 to 1
export const fallFor = ({ scene, intensity }, day) => {
  const kind = KINDS[scene] ?? null;
  if (!kind) {
    return { kind: null, k: 0, color: "transparent" };
  }
  const k = INTENSITY[intensity] ?? INTENSITY.moderate;
  const [rgb, alpha] =
    kind === "snow"
      ? [mix([0.75, 0.75, 0.75], [1, 1, 1], day).map((v) => v * 0.98), 0.85]
      : [mix([0.55, 0.58, 0.7], [0.88, 0.91, 0.96], day), 0.32];
  const [r, g, b] = rgb.map((v) => Math.round(Math.min(v, 1) * 255));
  return { kind, k, color: `rgba(${r}, ${g}, ${b}, ${alpha})` };
};

// the fall in each sky (the faces' .flat-sky elements), hidden while nothing falls
export const createRain = ({ skies }) => {
  const layers = skies.map((sky) => {
    const el = document.createElement("div");
    el.className = "flat-fall";
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
    ["far", "mid", "near"].forEach((depth) => {
      const layer = document.createElement("i");
      layer.className = depth;
      el.append(layer);
    });
    // over the clouds, under the dim, as the glass draws it behind the content
    sky.insertBefore(el, sky.querySelector(".dim"));
    return el;
  });
  let still = false;

  const set = ({ kind, k, color }) => {
    layers.forEach((el) => {
      el.hidden = kind === null;
      if (kind === null) {
        return;
      }
      el.dataset.kind = kind;
      el.style.setProperty("--k", String(k));
      el.style.setProperty("--fall", color);
    });
  };

  // a still sky holds the drops where they are (reduced motion, or a device the scene found slow)
  const setStill = (on) => {
    if (on === still) {
      return;
    }
    still = on;
    layers.forEach((el) => el.toggleAttribute("data-still", on));
  };

  const destroy = () => layers.forEach((el) => el.remove());

  return { set, setStill, destroy, layers };
};
