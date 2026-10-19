// the home route's weather, ported from the spike's weatherServer.js. it only ever sends open-meteo a location rounded
// to half a degree, and that rounding is also what the answers are cached by
export const CELL = 0.5;
// seconds, since the cache api keeps an entry for as long as its cache-control header says
const TTL = 30 * 60;
const FAIL_TTL = 60;
// under the client's own 6000 ms, so the client hears the worker's answer instead of giving up first
export const UPSTREAM_TIMEOUT = 5000;

export const roundCell = (lat, lon) => [
  Math.round(lat / CELL) * CELL,
  Math.round(lon / CELL) * CELL,
];

// the cache api wants a url for a key. it's always on jasonyue.ca, the zone the worker serves, whatever host the
// request came in on
export const cacheKey = (cellLat, cellLon) =>
  `https://jasonyue.ca/__cache/weather/${cellLat}/${cellLon}`;

const round4 = (n) => Math.round(n * 1e4) / 1e4;

// tzdata's coordinates: sign, degrees, minutes, and maybe seconds, latitude then longitude ("+4916-12307")
export const parseIso6709 = (text) => {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/.exec(
    text || "",
  );
  if (!m) {
    return null;
  }
  const lat =
    (Number(m[2]) + Number(m[3]) / 60 + Number(m[4] || 0) / 3600) *
    (m[1] === "-" ? -1 : 1);
  const lon =
    (Number(m[6]) + Number(m[7]) / 60 + Number(m[8] || 0) / 3600) *
    (m[5] === "-" ? -1 : 1);
  return [round4(lat), round4(lon)];
};

// zone1970.tab: country codes, coordinates, zone name, and a comment, split by tabs
export const parseZoneTab = (text) => {
  const zones = {};
  text.split("\n").forEach((line) => {
    if (!line || line.startsWith("#")) {
      return;
    }
    const [, coords, zone] = line.split("\t");
    const at = parseIso6709(coords);
    if (zone && at) {
      zones[zone] = at;
    }
  });
  return zones;
};

// tzdata's links ("L Asia/Kolkata Asia/Calcutta"), as [target, alias]. browsers still report some old names, so the
// aliases get their target's city
export const parseLinks = (text) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("L "))
    .map((line) => line.split(" ").slice(1, 3))
    .filter((pair) => pair.length === 2);

// every zone name a browser might report, with its city. zone1970.tab comes first, then zone.tab fills the country
// zones zone1970 merged into a neighbor (europe/oslo into berlin, atlantic/reykjavik into abidjan) with their own
// city, and only then do links fill the names neither file has, which are plain renames like asia/calcutta
export const buildCities = (zone1970Text, zoneTabText, ziText) => {
  const cities = parseZoneTab(zone1970Text);
  Object.entries(parseZoneTab(zoneTabText)).forEach(([zone, at]) => {
    if (!cities[zone]) {
      cities[zone] = at;
    }
  });
  parseLinks(ziText).forEach(([target, alias]) => {
    if (cities[target] && !cities[alias]) {
      cities[alias] = cities[target];
    }
  });
  return cities;
};

// the city for a zone name the visitor sent, or null. the name is untrusted, so it only counts as the table's own key,
// never as something an object inherits (__proto__, constructor), and the entry has to be two numbers
export const cityFor = (cities, zone) => {
  if (!Object.hasOwn(cities, zone)) {
    return null;
  }
  const at = cities[zone];
  if (
    !Array.isArray(at) ||
    at.length !== 2 ||
    !at.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    return null;
  }
  return at;
};

export const toHours = (iso) => {
  const m = /T(\d{2}):(\d{2})/.exec(iso || "");
  return m ? Math.round((Number(m[1]) + Number(m[2]) / 60) * 100) / 100 : null;
};

// yesterday through tomorrow, so a moon that rose last night or sets tomorrow morning is still covered
export const forecastUrl = (lat, lon) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code&daily=sunrise,sunset,moonrise,moonset,moon_phase&timezone=auto&past_days=1&forecast_days=2`;

const isNumber = (n) => typeof n === "number" && Number.isFinite(n);

// open-meteo marks a day the sun never rises or never sets by putting both times at midnight: the same midnight for
// polar night, and the next day's midnight as the sunset for polar day
const polarFor = (rise, set) => {
  if (!rise.endsWith("T00:00") || !set.endsWith("T00:00")) {
    return null;
  }
  if (rise === set) {
    return "night";
  }
  return set > rise ? "day" : null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;

// a time on one of the days asked for, as hours from the location's today at midnight (yesterday's are negative)
const hoursFrom = (iso, today) => {
  const h = toHours(iso);
  if (h === null) {
    return null;
  }
  return round2(
    Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(today)) / DAY_MS) *
      24 +
      h,
  );
};

// when the moon is up over the days asked for, as [rise, set] pairs of hours from today's midnight. a set with no rise
// before it was up since the first day began, and a rise with no set after it stays up past the last day's end.
// near the poles open-meteo has no times at all, so there are no stretches
const moonUps = (daily, today) => {
  const days = daily?.time || [];
  if (!days.length) {
    return [];
  }
  const start = round2(
    ((Date.parse(days[0]) - Date.parse(today)) / DAY_MS) * 24,
  );
  const end = round2(
    ((Date.parse(days[days.length - 1]) - Date.parse(today)) / DAY_MS) * 24 +
      24,
  );
  const events = [];
  [
    ["moonrise", "rise"],
    ["moonset", "set"],
  ].forEach(([field, kind]) => {
    (daily[field] || []).forEach((iso) => {
      const h = typeof iso === "string" ? hoursFrom(iso, today) : null;
      if (h !== null) {
        events.push([h, kind]);
      }
    });
  });
  events.sort((a, b) => a[0] - b[0]);
  const ups = [];
  let rise = null;
  events.forEach(([h, kind]) => {
    if (kind === "rise") {
      rise = rise === null ? h : rise;
      return;
    }
    ups.push([rise === null ? start : rise, h]);
    rise = null;
  });
  if (rise !== null) {
    ups.push([rise, end]);
  }
  return ups;
};

export const shapeForecast = (json) => {
  const code = json?.current?.weather_code;
  const today = (json?.current?.time || "").slice(0, 10);
  if (!today) {
    return null;
  }
  const index = (json?.daily?.time || []).indexOf(today);
  if (index < 0) {
    return null;
  }
  const rise = json?.daily?.sunrise?.[index];
  const set = json?.daily?.sunset?.[index];
  const sunrise = toHours(rise);
  const sunset = toHours(set);
  const utcOffset = json?.utc_offset_seconds;
  if (![code, sunrise, sunset, utcOffset].every(isNumber)) {
    return null;
  }
  const phase = json?.daily?.moon_phase?.[index];
  const moon = isNumber(phase)
    ? { phase, ups: moonUps(json.daily, today) }
    : null;
  return { code, sunrise, sunset, utcOffset, polar: polarFor(rise, set), moon };
};

// asks open-meteo for one cell, giving up after timeoutMs so a hung upstream doesn't hold the visitor's request open
const askOpenMeteo = async (fetchImpl, cellLat, cellLon, timeoutMs) => {
  let failure = null;
  const res = await fetchImpl(forecastUrl(cellLat, cellLon), {
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error) => {
    failure = error;
    return null;
  });
  if (!res) {
    return {
      ok: false,
      reason:
        failure && failure.name === "TimeoutError"
          ? "open-meteo took too long"
          : "open-meteo couldn't be reached",
    };
  }
  if (!res.ok) {
    return { ok: false, reason: `open-meteo answered ${res.status}` };
  }
  const weather = shapeForecast(await res.json().catch(() => null));
  if (!weather) {
    return {
      ok: false,
      reason: "open-meteo's answer was missing the weather or the sun times",
    };
  }
  return { ok: true, weather };
};

// answers are kept 30 minutes per cell in the cache api, and failures for a minute, so a busy moment or an upstream
// outage doesn't send every visitor on to open-meteo. the cache is each data center's own, and a cache that fails
// counts as a miss. waitUntil, when given, lets the visitor's answer go out before the cache write is done
export const createWeatherSource = ({
  cache,
  fetchImpl = fetch,
  timeoutMs = UPSTREAM_TIMEOUT,
  waitUntil = null,
} = {}) => {
  return async (lat, lon) => {
    const [cellLat, cellLon] = roundCell(lat, lon);
    const key = cacheKey(cellLat, cellLon);
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) {
      const stored = await hit.json().catch(() => null);
      if (stored && typeof stored.ok === "boolean") {
        return { ...stored, cached: true };
      }
    }
    const result = await askOpenMeteo(fetchImpl, cellLat, cellLon, timeoutMs);
    const entry = new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `max-age=${result.ok ? TTL : FAIL_TTL}`,
      },
    });
    const saving = cache.put(key, entry).catch(() => {});
    if (waitUntil) {
      waitUntil(saving);
    } else {
      await saving;
    }
    return { ...result, cached: false };
  };
};
