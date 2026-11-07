// the status bar's clock, wifi bars, and battery on the home and cover screens, from scene/status.js (the visitor's
// clock, the measured round trip, and the 3d battery cycle). the screens are live html, so a change writes straight
// into them. screens is a function, since a rebuild of the scene makes new ones
import { createStatus } from "../scene/status.js";

const PING_SHOWN_MS = 2500;

// onChange(status, kind) hears each change too, with kind "time", "wifi", "battery", "plugged", or "unplugged"
export const createFlatStatus = ({ screens, onChange = () => {} }) => {
  let pingUntil = 0;
  let pingTimer = null;
  let stopped = false;
  // the bar reports once while it's being made, before it exists
  let bar = null;

  const render = () => {
    const shown = screens();
    if (!bar || !shown || stopped) {
      return;
    }
    shown.update({
      status: { ...bar.status },
      showPing: performance.now() < pingUntil,
    });
  };

  bar = createStatus((status, kind) => {
    render();
    onChange(status, kind);
  });
  render();

  // tapping the indicators shows the measured ping in place of the clock for a moment
  const showPing = async () => {
    await bar.pingNow();
    if (stopped) {
      return;
    }
    pingUntil = performance.now() + PING_SHOWN_MS;
    render();
    clearTimeout(pingTimer);
    pingTimer = setTimeout(render, PING_SHOWN_MS + 100);
  };

  const stop = () => {
    stopped = true;
    clearTimeout(pingTimer);
    bar.stop();
  };

  return { status: bar.status, bar, render, showPing, stop };
};
