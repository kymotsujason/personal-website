import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resizeKind, turnSetFor, visibleDeadline } from "./resize.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const fakeDocument = () => {
  const listeners = [];
  const doc = {
    hidden: false,
    addEventListener: (_type, fn) => listeners.push(fn),
    removeEventListener: (_type, fn) => {
      const at = listeners.indexOf(fn);
      if (at >= 0) {
        listeners.splice(at, 1);
      }
    },
    setHidden: (hidden) => {
      doc.hidden = hidden;
      [...listeners].forEach((fn) => fn());
    },
    listeners,
  };
  return doc;
};

test("a resize in the same orientation fits, and one across it turns", () => {
  expect(resizeKind({ portrait: false, width: 1280, height: 800 })).toBe("fit");
  expect(resizeKind({ portrait: false, width: 900, height: 800 })).toBe("fit");
  expect(resizeKind({ portrait: false, width: 600, height: 900 })).toBe("turn");
  expect(resizeKind({ portrait: true, width: 600, height: 900 })).toBe("fit");
  expect(resizeKind({ portrait: true, width: 900, height: 600 })).toBe("turn");
  // a square window is landscape, as chooseSet has it
  expect(resizeKind({ portrait: true, width: 700, height: 700 })).toBe("turn");
});

test("a turn mounts the new orientation's opening set, with the cable in while it charges", () => {
  expect(turnSetFor({ portrait: true, charging: false })).toBe("portrait-open");
  expect(turnSetFor({ portrait: false, charging: false })).toBe("landscape");
  expect(turnSetFor({ portrait: true, charging: true })).toBe(
    "cable-portrait-open",
  );
  expect(turnSetFor({ portrait: false, charging: true })).toBe(
    "cable-landscape",
  );
});

test("the turn's deadline counts only the time the page is visible", () => {
  const doc = fakeDocument();
  const late = vi.fn();
  visibleDeadline(10000, late, { doc });
  vi.advanceTimersByTime(4000);
  doc.setHidden(true);
  // a minute in a hidden tab doesn't count
  vi.advanceTimersByTime(60000);
  expect(late).not.toHaveBeenCalled();
  doc.setHidden(false);
  vi.advanceTimersByTime(5999);
  expect(late).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(late).toHaveBeenCalledTimes(1);
  expect(doc.listeners).toHaveLength(0);
});

test("a deadline stopped in time never fires, and lets go of its listener", () => {
  const doc = fakeDocument();
  const late = vi.fn();
  const stop = visibleDeadline(10000, late, { doc });
  vi.advanceTimersByTime(9000);
  stop();
  vi.advanceTimersByTime(60000);
  doc.setHidden(true);
  doc.setHidden(false);
  vi.advanceTimersByTime(60000);
  expect(late).not.toHaveBeenCalled();
  expect(doc.listeners).toHaveLength(0);

  // one started in a hidden tab waits for the tab to show
  const hidden = fakeDocument();
  hidden.hidden = true;
  const later = vi.fn();
  visibleDeadline(10000, later, { doc: hidden });
  vi.advanceTimersByTime(30000);
  expect(later).not.toHaveBeenCalled();
  hidden.setHidden(false);
  vi.advanceTimersByTime(10000);
  expect(later).toHaveBeenCalledTimes(1);
});
