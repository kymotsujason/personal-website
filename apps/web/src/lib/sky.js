import { luminance } from "./contrast.js";

// a css copy of the home screen sky: the same colors as sky() in scene/wallpaper.js, as custom properties on the root
const INTENSITY = { light: 0.35, moderate: 0.65, heavy: 1 };

// from lookFor in the shader: how dark the clouds are, how grey the bare sky is, and how much of the sun shows
const lookFor = (scene, intensity) => {
  const k = INTENSITY[intensity] ?? INTENSITY.moderate;
  switch (scene) {
    case "partly cloudy":
      return { dark: 0, overcast: 0, sun: 1 };
    case "cloudy":
      return { dark: 0.2, overcast: 0.55, sun: 0 };
    case "fog":
      return { dark: 0, overcast: 0, sun: 0.5 };
    case "drizzle":
      return { dark: 0.25, overcast: 0.6, sun: 0.35 };
    case "rain":
      return { dark: 0.45 + 0.2 * k, overcast: 0.85, sun: 0 };
    case "snow":
      return { dark: 0.1, overcast: 0.55, sun: 0 };
    case "thunder":
      return { dark: 0.8, overcast: 0.95, sun: 0 };
    default:
      return { dark: 0, overcast: 0, sun: 1 };
  }
};

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// the shader's cloud cover for each scene. the page's cloud picture was drawn at cloudy's cover, so a scene shows it as
// much as its own cover against that, and its lit tops are as bright as the shader's cloud color: a light grey by day,
// greyer the more overcast, and a dim blue grey at night, darker in a storm
const COVER = {
  "partly cloudy": 0.45,
  fog: 0.35,
  cloudy: 0.85,
  drizzle: 0.75,
  rain: 0.85,
  snow: 0.7,
  thunder: 0.95,
};
const DRAWN_COVER = 0.85;
// the most of the picture's alpha anywhere, so the dim can cover its densest cloud
const CLOUD_ALPHA = 0.92;
const CLOUD_TOP = [0.96, 0.97, 0.99];

const cloudsFor = (scene, intensity, day) => {
  const look = lookFor(scene, intensity);
  const shown = Math.min((COVER[scene] ?? 0) / DRAWN_COVER, 1);
  // fog's haze is the shader's pale blue grey, not a cloud's white
  const dayLight = scene === "fog" ? 0.64 : 0.97 + (0.8 - 0.97) * look.overcast;
  const light = (0.33 + (dayLight - 0.33) * day) * (1 - look.dark * 0.55);
  return { shown, light };
};

export const skyColors = ({ day, warm, scene, intensity }) => {
  const look = lookFor(scene, intensity);
  let dayTop = mix([0.17, 0.42, 0.8], [0.4, 0.45, 0.52], look.overcast);
  let dayLow = mix([0.47, 0.7, 0.94], [0.56, 0.61, 0.67], look.overcast);
  let nightTop = mix([0.05, 0.07, 0.2], [0.08, 0.1, 0.17], look.overcast);
  let nightLow = mix([0.24, 0.18, 0.42], [0.18, 0.19, 0.27], look.overcast);
  if (scene === "fog") {
    dayTop = [0.4, 0.45, 0.53];
    dayLow = [0.42, 0.47, 0.54];
    nightTop = [0.1, 0.11, 0.14];
    nightLow = [0.15, 0.16, 0.19];
  }
  const top = mix(nightTop, dayTop, day).map((v) => v * (1 - look.dark * 0.35));
  let low = mix(nightLow, dayLow, day).map((v) => v * (1 - look.dark * 0.3));
  low = mix(low, [0.92, 0.52, 0.55], warm * (1 - 0.7 * look.overcast) * 0.75);
  return { top, low };
};

// the dim is black over the sky, heavier where the sky is bright, so the bare sky stays a backdrop white reads on. the
// floors are the night and day looks, and the targets are the brightest the dimmed sky may be (relative luminance)
const FLOOR = { top: [0.15, 0.25], low: [0.35, 0.55] };
const TARGET = { top: 0.16, low: 0.1 };
// the densest cloud and then the sun glow at its strongest, over the sky they sit on, since the dim has to cover both
const lit = (c, cloud, glow) => {
  const clouded = cloud ? mix(c, cloud.slice(0, 3), cloud[3]) : c;
  return glow ? mix(clouded, glow.slice(0, 3), glow[3]) : clouded;
};

const dimFor = (c, day, end, cloud, glow) => {
  const [night, noon] = FLOOR[end];
  const floor = night + (noon - night) * day;
  const bright = lit(c, cloud, glow).map((v) => v * 255);
  let lo = floor;
  let hi = 0.95;
  if (luminance(bright.map((v) => v * (1 - lo))) <= TARGET[end]) {
    return floor;
  }
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(bright.map((v) => v * (1 - mid))) <= TARGET[end]) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return hi;
};

const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(", ")})`;
const percent = (v) => `${Math.round(v * 1000) / 10}%`;
const amount = (v) => String(Math.round(v * 1000) / 1000);
// the wallpaper shader's fade as a body sinks past the bottom edge, smoothstep(-0.03, 0.05, y)
const edgeFade = (y) => {
  const t = Math.min(Math.max((y + 0.03) / 0.08, 0), 1);
  return t * t * (3 - 2 * t);
};

export const skyVars = ({
  day,
  warm,
  scene,
  intensity,
  sun,
  moon,
  sunUp,
  moonUp,
}) => {
  const { top, low } = skyColors({ day, warm, scene, intensity });
  const look = lookFor(scene, intensity);
  const vars = {
    "--sky-top": rgb(top),
    "--sky-low": rgb(low),
    "--sun-x": "50%",
    "--sun-y": "100%",
    "--sun-glow": "transparent",
    "--moon-x": "50%",
    "--moon-y": "100%",
    "--moon-glow": "transparent",
    "--dim-top": "0.15",
    "--dim-low": "0.35",
    "--stars": amount(
      (1 - day) * (1 - look.overcast) * (scene === "fog" ? 0 : 1),
    ),
  };
  const clouds = cloudsFor(scene, intensity, day);
  vars["--clouds"] = amount(clouds.shown);
  vars["--cloud-light"] = amount(clouds.light);
  const cloud =
    clouds.shown > 0
      ? [...CLOUD_TOP.map((v) => v * clouds.light), CLOUD_ALPHA * clouds.shown]
      : null;
  const sunShow = sun && sunUp > 0 ? look.sun * edgeFade(sun[1]) : 0;
  let glow = null;
  if (sunShow > 0) {
    const color = mix([1, 0.98, 0.94], [1, 0.78, 0.55], warm).map((v) =>
      Math.round(v * 255),
    );
    vars["--sun-x"] = percent(sun[0]);
    vars["--sun-y"] = percent(1 - sun[1]);
    vars["--sun-glow"] = `rgba(${color.join(", ")}, ${amount(0.6 * sunShow)})`;
    glow = [...color.map((v) => v / 255), 0.6 * sunShow];
  }
  const moonShow =
    moon && moonUp > 0 && scene !== "fog"
      ? (1 - 0.9 * look.overcast) * edgeFade(moon[1])
      : 0;
  if (moonShow > 0) {
    vars["--moon-x"] = percent(moon[0]);
    vars["--moon-y"] = percent(1 - moon[1]);
    vars["--moon-glow"] = `rgba(224, 230, 255, ${amount(0.22 * moonShow)})`;
  }
  vars["--dim-top"] = amount(dimFor(top, day, "top", cloud, glow));
  vars["--dim-low"] = amount(dimFor(low, day, "low", cloud, glow));
  return vars;
};

export const applySky = (root, vars) => {
  Object.entries(vars).forEach(([name, value]) =>
    root.style.setProperty(name, value),
  );
};
