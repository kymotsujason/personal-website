// a drag from the left edge of an inner page goes back to its list, the way ios does. the page's bar and content
// follow the finger over its sky, and letting go far enough along, or with a flick, goes back, where the slide back
// (see .page-slide in flat.css) carries on from where the finger left them. let go early and they spring back
import { goBackTo } from "./navigation.js";

// how far along the page, or how fast in px per ms, a release has to be to go back
const BACK_SHARE = 0.35;
const BACK_FLICK = 0.5;
const SPRING_MS = 250;
const SPRING = "cubic-bezier(0.32, 0.72, 0, 1)";
// a navigation that never swaps the page out leaves it where the finger let go, so it springs back after this
const STUCK_MS = 4000;

let drag = null;

const moving = (page) =>
  [":scope > header", ":scope > .body", ":scope > .toolbar"]
    .map((selector) => page.querySelector(selector))
    .filter(Boolean);

const place = (els, dx, ms = 0) => {
  for (const el of els) {
    el.style.transition = ms ? `transform ${ms}ms ${SPRING}` : "";
    el.style.transform = dx ? `translateX(${dx}px)` : "";
  }
};

const springBack = (els) => {
  place(els, 0, SPRING_MS);
  setTimeout(() => {
    for (const el of els) {
      el.style.transition = "";
    }
  }, SPRING_MS);
};

document.addEventListener("pointerdown", (event) => {
  const strip = event.target.closest?.(".edge-swipe");
  if (!strip || !event.isPrimary || event.button !== 0 || drag) {
    return;
  }
  const page = document.getElementById("page");
  const back = page?.querySelector(":scope > header .back");
  // in 3d only the flat page at full zoom, since the scene moves #page while it opens, closes, switches, or is swiped
  if (!back || page.style.transform) {
    return;
  }
  drag = {
    id: event.pointerId,
    x0: event.clientX,
    dx: 0,
    lastX: event.clientX,
    lastT: performance.now(),
    speed: 0,
    els: moving(page),
    href: back.getAttribute("href"),
    width: page.clientWidth,
  };
  strip.setPointerCapture(event.pointerId);
  event.preventDefault();
});

document.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.id) {
    return;
  }
  const now = performance.now();
  drag.speed = (event.clientX - drag.lastX) / Math.max(now - drag.lastT, 1);
  drag.lastX = event.clientX;
  drag.lastT = now;
  drag.dx = Math.max(0, event.clientX - drag.x0);
  place(drag.els, drag.dx);
});

const end = (event) => {
  if (!drag || event.pointerId !== drag.id) {
    return;
  }
  const { els, dx, speed, width, href } = drag;
  drag = null;
  if (
    event.type === "pointerup" &&
    dx > 0 &&
    (dx > width * BACK_SHARE || speed > BACK_FLICK)
  ) {
    goBackTo(href);
    setTimeout(() => {
      if (els.some((el) => el.isConnected)) {
        springBack(els);
      }
    }, STUCK_MS);
    return;
  }
  springBack(els);
};

document.addEventListener("pointerup", end);
document.addEventListener("pointercancel", end);
