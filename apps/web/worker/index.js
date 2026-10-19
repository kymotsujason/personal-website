// the worker runs only for requests no static file matches. /api/home answers the phone's weather and github widgets
// in one response, so a visit costs one worker request, and the daily cron saves github's contribution calendar
import cities from "../src/data/tzCities.json";
import { readGithub, refreshGithub } from "./github.js";
import { cityFor, createWeatherSource } from "./weather.js";

// cloudflare gives the location as strings, and a missing or unreadable one falls back to the time zone's city
const coordinate = (value, limit) => {
  const n = typeof value === "string" ? parseFloat(value) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};

const locate = (request, tz) => {
  const lat = coordinate(request.cf?.latitude, 90);
  const lon = coordinate(request.cf?.longitude, 180);
  if (lat !== null && lon !== null) {
    return [lat, lon];
  }
  return cityFor(cities, tz);
};

const loadWeather = async (request, url, ctx) => {
  const at = locate(request, url.searchParams.get("tz") || "");
  if (!at) {
    return null;
  }
  const weatherFor = createWeatherSource({
    cache: caches.default,
    waitUntil: (promise) => ctx.waitUntil(promise),
  });
  const result = await weatherFor(at[0], at[1]);
  if (!result.ok) {
    console.warn("weather_unavailable", result.reason);
    return null;
  }
  return result.weather;
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/home") {
      return env.ASSETS.fetch(request);
    }
    const [weather, github] = await Promise.all([
      loadWeather(request, url, ctx).catch((error) => {
        console.error("weather_rejected", error);
        return null;
      }),
      readGithub(env),
    ]);
    return Response.json(
      { weather, github },
      { headers: { "Cache-Control": "no-store" } },
    );
  },

  async scheduled(_controller, env) {
    await refreshGithub(env);
  },
};
