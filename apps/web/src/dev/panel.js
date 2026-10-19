// the spike's test panel, built in dev when the address has ?dev. it sets the scene's settings and pins the time,
// the weather, and the battery, and holds the pose editor
import { sunHours } from "../scene/weather.js";
import { BATTERY_CYCLE, BATTERY_DRAIN, batteryAt } from "../scene/status.js";
import { state, pose, settings } from "../scene/state.js";
import { cancelAll } from "../scene/tween.js";
import { renderer, weather, hourOverride, setHourOverride, setWeatherOverride, applyWeather, applyDaylight } from "../scene/renderer.js";
import { frameStats } from "../scene/quality.js";
import { buildDevice, placeKeys, handKeys, LEAD } from "../scene/device.js";
import { statusBar } from "../scene/home.js";
import { playIntro, showFromAddress } from "../scene/intro.js";
import { sceneStarted } from "../scene/index.js";
import { createPoseEditor } from "./poseEditor.js";

const PANEL_HTML = `
    <div class="row">
        <label>Device</label>
        <select id="device-select">
            <option value="auto">duo, auto</option>
            <option value="landscape">duo, landscape</option>
            <option value="portrait">duo, portrait</option>
        </select>
    </div>
    <div class="row">
        <label>Hand</label>
        <select id="hand-select">
            <option value="hands">hands, skin</option>
            <option value="hands-clay">hands, clay</option>
            <option value="none">none</option>
        </select>
    </div>
    <div class="row">
        <label>Phone</label>
        <select id="phone-select">
            <option value="star-white">Star White</option>
            <option value="night-sky">Night Sky</option>
            <option value="clay">softened</option>
        </select>
    </div>
    <div class="row">
        <button id="replay-full">Full intro</button>
        <button id="replay-fast">Fast intro</button>
    </div>
    <div class="row">
        <label><input type="checkbox" id="handoff-check" checked /> flat page at full zoom</label>
    </div>
    <div class="row">
        <label>Time</label>
        <input type="range" id="day-time" min="0" max="24" step="0.25" />
    </div>
    <div class="row">
        <label></label>
        <span id="day-read">--</span>
        <button id="day-now">Now</button>
    </div>
    <div class="row">
        <label>Weather</label>
        <select id="weather-scene">
            <option value="auto">Auto</option>
            <option value="clear">Clear</option>
            <option value="partly cloudy">Partly cloudy</option>
            <option value="cloudy">Cloudy</option>
            <option value="fog">Fog</option>
            <option value="drizzle">Drizzle</option>
            <option value="rain">Rain</option>
            <option value="snow">Snow</option>
            <option value="thunder">Thunder</option>
        </select>
        <select id="weather-intensity">
            <option value="light">Light</option>
            <option value="moderate" selected>Moderate</option>
            <option value="heavy">Heavy</option>
        </select>
    </div>
    <div class="row" id="weather-read">--</div>
    <div class="row">
        <label>Battery</label>
        <input type="range" id="battery-time" min="0" max="720" step="1" />
        <span id="battery-read">--</span>
    </div>
    <div class="row">
        <button id="battery-low">21%</button>
        <button id="battery-plug">Plug in</button>
        <select id="battery-speed">
            <option value="1">1x</option>
            <option value="10">10x</option>
            <option value="60">60x</option>
        </select>
        <button id="battery-live">Live</button>
    </div>
    <div class="row" id="stats">fps --</div>`;

let dayTime = null;
let dayRead = null;

// the time of day sets the room's light, checked each minute. the test slider pins an hour, Now goes back to the clock
export const showDaylight = () => {
    const { hour, day } = applyDaylight();
    const h = Math.floor(hour);
    const m = Math.round((hour - h) * 60);
    dayRead.textContent = `${h}:${String(m).padStart(2, "0")} ${Math.round(day * 100)}%${hourOverride === null ? "" : " pinned"}`;
    if (hourOverride === null) {
        dayTime.value = String(hour);
    }
};

const rebuildAndReplay = () => {
    buildDevice();
    if (!showFromAddress()) {
        playIntro(true);
    }
};

const buildPanel = () => {
    const panel = document.createElement("div");
    panel.id = "panel";
    panel.innerHTML = PANEL_HTML;
    document.body.appendChild(panel);

    const deviceSelect = document.getElementById("device-select");
    const handSelect = document.getElementById("hand-select");
    const phoneSelect = document.getElementById("phone-select");
    const handoffCheck = document.getElementById("handoff-check");
    deviceSelect.value = settings.device;
    handSelect.value = settings.hands;
    phoneSelect.value = settings.finish;
    handoffCheck.checked = settings.flatAtFullZoom;
    deviceSelect.addEventListener("change", () => {
        settings.device = deviceSelect.value;
        rebuildAndReplay();
    });
    handSelect.addEventListener("change", () => {
        settings.hands = handSelect.value;
        rebuildAndReplay();
    });
    phoneSelect.addEventListener("change", () => {
        settings.finish = phoneSelect.value;
        rebuildAndReplay();
    });
    handoffCheck.addEventListener("change", () => {
        settings.flatAtFullZoom = handoffCheck.checked;
    });
    document.getElementById("replay-full").addEventListener("click", () => playIntro(false));
    document.getElementById("replay-fast").addEventListener("click", () => playIntro(true));

    dayTime = document.getElementById("day-time");
    dayRead = document.getElementById("day-read");
    dayTime.addEventListener("input", () => {
        setHourOverride(Number(dayTime.value));
        showDaylight();
    });
    document.getElementById("day-now").addEventListener("click", () => {
        setHourOverride(null);
        showDaylight();
    });
    showDaylight();
    setInterval(showDaylight, 60000);

    // weather test controls: pin a scene and how hard it comes down, or Auto for the visitor's real weather. the readout
    // says what the route answered, and the sunrise and sunset on the visitor's clock
    const weatherScene = document.getElementById("weather-scene");
    const weatherIntensity = document.getElementById("weather-intensity");
    const weatherRead = document.getElementById("weather-read");
    const clockText = (hour) => {
        const minutes = Math.round(hour * 60);
        return `${Math.floor(minutes / 60) % 24}:${String(minutes % 60).padStart(2, "0")}`;
    };
    const showWeather = () => {
        if (!weather) {
            weatherRead.textContent = "no weather, so a clear sky from the clock";
            return;
        }
        const sun = sunHours(weather);
        const sunText = weather.polar ? `polar ${weather.polar}` : `sun ${clockText(sun.sunrise)} to ${clockText(sun.sunset)}`;
        weatherRead.textContent = `code ${weather.code} from ${weather.source || "?"}  ${sunText}`;
    };
    const onWeatherPick = () => {
        setWeatherOverride(weatherScene.value === "auto" ? null : { scene: weatherScene.value, intensity: weatherIntensity.value });
        applyWeather();
    };
    weatherScene.addEventListener("change", onWeatherPick);
    weatherIntensity.addEventListener("change", onWeatherPick);
    showWeather();
    // the scene takes the weather when it arrives, and the readout catches up within a second
    setInterval(showWeather, 1000);

    // battery test controls: scrub the cycle, jump to the edges worth checking, and speed the clock up. none of it is
    // saved, and Live goes back to the visitor's real cycle
    const batteryTime = document.getElementById("battery-time");
    const batteryRead = document.getElementById("battery-read");
    const batterySpeed = document.getElementById("battery-speed");
    batteryTime.max = String(BATTERY_CYCLE / 1000);
    batteryTime.addEventListener("input", () => statusBar.setBattery(Number(batteryTime.value) * 1000));
    // 21% is one step above the red, and plug in starts two seconds before the drain bottoms out at 1%
    document.getElementById("battery-low").addEventListener("click", () => statusBar.setBattery(((100 - 21.4) / 99) * BATTERY_DRAIN));
    document.getElementById("battery-plug").addEventListener("click", () => statusBar.setBattery(BATTERY_DRAIN - 2000));
    batterySpeed.addEventListener("change", () => statusBar.setBatterySpeed(Number(batterySpeed.value)));
    document.getElementById("battery-live").addEventListener("click", () => {
        batterySpeed.value = "1";
        statusBar.batteryLive();
    });
    const statsEl = document.getElementById("stats");
    setInterval(() => {
        const at = statusBar.batteryPosition();
        const { level, charging } = batteryAt(0, at);
        if (document.activeElement !== batteryTime) {
            batteryTime.value = String(Math.round(at / 1000));
        }
        batteryRead.textContent = `${level}% ${charging ? "chg" : "drn"}`;
        statsEl.textContent = `fps ${frameStats.fps.toFixed(0)}  p95 ${frameStats.p95.toFixed(1)}ms\n${state.portrait ? "portrait" : "landscape"}  dpr ${devicePixelRatio}  render ${renderer.getPixelRatio()}`;
    }, 250);

    // the portrait grips are posed by eye in the panel, against photos of people holding a foldable in portrait. while
    // it's open the phone holds still at the fold being edited
    createPoseEditor({
        panel,
        leadTime: LEAD.time,
        getHands: () => state.hands,
        getBones: () => state.handModel.bones,
        getRoot: () => state.root,
        isPortrait: () => state.portrait && Boolean(state.hands),
        hold: (keys, fold, reset, lead = 0) => {
            state.posing = true;
            state.lead = lead;
            placeKeys(keys);
            if (reset) {
                Object.assign(pose, state.poses.rest, { idle: 0, blur: 0 });
                cancelAll();
                state.busy = false;
            }
            pose.fold = fold;
        },
        release: () => {
            state.posing = false;
            if (state.hands) {
                placeKeys(handKeys());
            }
            Object.assign(pose, state.poses.rest, { idle: 1, blur: 0, fold: 0 });
        }
    });
};

sceneStarted.then(buildPanel);
