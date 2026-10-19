// the phone's status bar: the visitor's own clock, wifi bars from the measured round trip to the site, and a battery
// that drains and recharges on a loop as an easter egg. each part calls onChange when what it shows changes
import { read, write } from "../lib/storage.js";

const PING_EVERY = 15000;
const PING_TIMEOUT = 4000;

// the battery runs one shared cycle across visits: it drains to 1%, a cable plugs in, it charges back to 100%
const DRAIN_TIME = 10 * 60 * 1000;
const CHARGE_TIME = 2 * 60 * 1000;
const BATTERY_KEY = "duo-battery-start";

// the clock the way the ios status bar shows it: hours and minutes, no am/pm, in the visitor's own 12 or 24 hour style
export const clockText = (date) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
    .formatToParts(date)
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();

const barsFor = (ms) => {
    if (ms === null) {
        return 0;
    }
    if (ms < 100) {
        return 3;
    }
    return ms < 300 ? 2 : 1;
};

// private modes can refuse storage, and the cycle then just starts over on each visit
const batteryStart = () => {
    const stored = Number(read("local", BATTERY_KEY));
    if (stored > 0 && stored <= Date.now()) {
        return stored;
    }
    const now = Date.now();
    write("local", BATTERY_KEY, now);
    return now;
};

export const BATTERY_CYCLE = DRAIN_TIME + CHARGE_TIME;
export const BATTERY_DRAIN = DRAIN_TIME;

// where the cycle is at a given time: the level, whether it's charging, and how long until that changes
export const batteryAt = (start, now) => {
    const t = (now - start) % (DRAIN_TIME + CHARGE_TIME);
    if (t < DRAIN_TIME) {
        return { level: Math.max(1, Math.round(100 - (99 * t) / DRAIN_TIME)), charging: false, phaseLeft: DRAIN_TIME - t };
    }
    const c = t - DRAIN_TIME;
    return { level: Math.min(100, Math.round(1 + (99 * c) / CHARGE_TIME)), charging: true, phaseLeft: CHARGE_TIME - c };
};

// how long until the battery is checked again, in real ms: each second draining and every 300 ms charging, which is
// often enough for the level to show each step (it moves about every 6 s draining and 1.2 s charging). a phase that
// ends before the next check gets its own check just after it ends, so the cable goes in or out at the same moment
// however the checks before it fell
export const nextCheck = (b, speed) => {
    const every = (b.charging ? 300 : 1000) / speed;
    const untilEnd = b.phaseLeft / speed;
    return untilEnd <= every ? untilEnd + 20 : every;
};

export const createStatus = (onChange) => {
    const status = { time: clockText(new Date()), ping: null, bars: 0, online: navigator.onLine, level: 100, charging: false };
    const start = batteryStart();
    const timers = [];
    // the battery's own clock, so the test controls can jump it or speed it up without touching the saved start
    const clock = { anchorReal: Date.now(), anchorVirtual: Date.now(), speed: 1 };
    const batteryNow = () => clock.anchorVirtual + (Date.now() - clock.anchorReal) * clock.speed;

    const tickClock = () => {
        const now = new Date();
        status.time = clockText(now);
        // armed first, so a callback that throws doesn't stop the clock
        timers[0] = setTimeout(tickClock, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 20);
        onChange(status, "time");
    };

    // a few recent round trips, so one slow request doesn't drop the bars
    const recent = [];
    let pinging = null;
    // a hidden tab isn't pinged, so a forgotten one isn't asking every 15 s all day. it's pinged again once shown
    const ping = async () => {
        if (globalThis.document?.hidden) {
            return;
        }
        if (!navigator.onLine) {
            recent.length = 0;
            status.ping = null;
        } else {
            const abort = new AbortController();
            pinging = abort;
            const timeout = setTimeout(() => abort.abort(), PING_TIMEOUT);
            const t0 = performance.now();
            try {
                // a static file, so the pings don't count as worker requests, and no-store keeps each one a real trip
                await fetch("/ping.txt", { method: "HEAD", cache: "no-store", signal: abort.signal });
                recent.push(performance.now() - t0);
                if (recent.length > 3) {
                    recent.shift();
                }
                status.ping = [...recent].sort((a, b) => a - b)[Math.floor(recent.length / 2)];
            } catch {
                recent.length = 0;
                status.ping = null;
            }
            clearTimeout(timeout);
        }
        const bars = barsFor(status.ping);
        const shown = status.ping === null ? null : Math.round(status.ping);
        if (bars !== status.bars || shown !== status.shownPing) {
            status.bars = bars;
            status.shownPing = shown;
            onChange(status, "wifi");
        }
    };

    const tickBattery = () => {
        const b = batteryAt(start, batteryNow());
        const changed = b.level !== status.level || b.charging !== status.charging;
        const plugged = b.charging && !status.charging;
        const unplugged = !b.charging && status.charging;
        status.level = b.level;
        status.charging = b.charging;
        timers[2] = setTimeout(tickBattery, nextCheck(b, clock.speed));
        if (changed) {
            onChange(status, plugged ? "plugged" : unplugged ? "unplugged" : "battery");
        }
    };

    const retime = (virtual, speed) => {
        clock.anchorReal = Date.now();
        clock.anchorVirtual = virtual;
        clock.speed = speed;
        clearTimeout(timers[2]);
        tickBattery();
    };

    tickClock();
    ping();
    timers[1] = setInterval(ping, PING_EVERY);
    addEventListener("online", ping);
    addEventListener("offline", ping);
    addEventListener("visibilitychange", ping);
    tickBattery();

    return {
        status,
        pingNow: ping,
        // test controls: where in the cycle the battery is (ms), and how fast its clock runs
        batteryPosition: () => (batteryNow() - start) % BATTERY_CYCLE,
        setBattery: (at, speed = clock.speed) => {
            const cycleStart = batteryNow() - ((batteryNow() - start) % BATTERY_CYCLE);
            retime(cycleStart + at, speed);
        },
        setBatterySpeed: (speed) => retime(batteryNow(), speed),
        batteryLive: () => retime(Date.now(), 1),
        stop: () => {
            clearTimeout(timers[0]);
            clearInterval(timers[1]);
            clearTimeout(timers[2]);
            removeEventListener("online", ping);
            removeEventListener("offline", ping);
            removeEventListener("visibilitychange", ping);
            if (pinging) {
                pinging.abort();
            }
        }
    };
};
