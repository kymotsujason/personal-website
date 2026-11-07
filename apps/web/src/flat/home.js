// what /api/home gives the 2d scene, the way startScene uses it (scene/index.js): the weather sets the sky and what
// falls on it, and the github graph fills its widget. until the weather answers the sky is clear and follows the clock.
// after that it's asked again once the weather is half an hour old, checked each minute and when a hidden tab is shown
// again (never while hidden), and a later answer's graph replaces the shown one. the sky is redrawn from the clock each
// minute, since in the 2d scene nothing else refreshes it (Site.astro leaves it to the scene)
import { applySky, skyVars } from "../lib/sky.js";
import { daylight, hourNow } from "../scene/daylight.js";
import { readContributions } from "../scene/github.js";
import { moonPlace, sunPlace } from "../scene/skyPath.js";
import {
  conditionFor,
  createWeatherFeed,
  loadHome,
  moonHours,
  readWeather,
  sunHours,
} from "../scene/weather.js";
import { fallFor } from "./rain.js";

const CLEAR = { scene: "clear", intensity: "moderate" };

// the sky's variables and the fall for a weather answer (or null) at an hour on the visitor's clock
export const skyFor = (weather, hour) => {
  const sun = weather ? sunHours(weather) : {};
  const polar = weather ? (weather.polar ?? null) : null;
  const { day, warm } = daylight(hour, sun.sunrise, sun.sunset, polar);
  const sunAt = sunPlace(hour, {
    sunrise: sun.sunrise ?? 7,
    sunset: sun.sunset ?? 19,
    polar,
  });
  const moonAt = moonPlace(hour, weather ? moonHours(weather) : null);
  const condition = weather ? conditionFor(weather.code) : CLEAR;
  return {
    vars: skyVars({
      day,
      warm,
      scene: condition.scene,
      intensity: condition.intensity,
      sun: [sunAt.x, sunAt.y],
      sunUp: sunAt.up,
      moon: [moonAt.x, moonAt.y],
      moonUp: moonAt.up,
    }),
    fall: fallFor(condition, day),
  };
};

// signal is the scene's. a request ends with it
const fetchWith =
  (signal) =>
  (url, options = {}) => {
    const inner = new AbortController();
    const stop = () => inner.abort();
    signal.addEventListener("abort", stop, { once: true });
    options.signal?.addEventListener("abort", stop, { once: true });
    return fetch(url, { ...options, signal: inner.signal }).finally(() => {
      signal.removeEventListener("abort", stop);
    });
  };

// screens() and rain() give the current ones, since a rebuild of the scene makes new
export const createHome = ({
  screens,
  rain,
  signal,
  guard,
  root = document.documentElement,
}) => {
  let weather = null;
  // the graph shown, which new screens (a turn) get again
  let shownContributions = null;

  const drawSky = () => {
    const { vars, fall } = skyFor(weather, hourNow());
    applySky(root, vars);
    rain()?.set(fall);
  };

  const askHome = async () => {
    const home = await loadHome({ fetchImpl: fetchWith(signal) });
    const contributions = readContributions(home ? home.github : null);
    // an answer without the graph keeps what's shown
    if (contributions) {
      shownContributions = contributions;
      screens()?.update({ contributions });
    }
    return home;
  };

  const feed = createWeatherFeed({
    load: () => askHome().then(readWeather),
    hidden: () => document.hidden,
    onWeather: (data) => {
      weather = data;
      drawSky();
    },
  });

  const timer = setInterval(
    guard(() => {
      drawSky();
      return feed.refresh();
    }),
    60000,
  );
  document.addEventListener(
    "visibilitychange",
    guard(() => (document.hidden ? null : feed.refresh())),
    { signal },
  );
  signal.addEventListener("abort", () => clearInterval(timer), { once: true });

  return {
    // the first ask, once the screens exist, and the sky from the clock until it answers
    start: () => {
      screens()?.update({ contributions: null });
      drawSky();
      return guard(feed.refresh)();
    },
    drawSky,
    // new screens and rain after a turn, with the graph and the fall the old ones had
    restore: () => {
      screens()?.update({ contributions: shownContributions });
      drawSky();
    },
    weather: () => weather,
  };
};
