// the page's depth inputs, written to the root since #page's style belongs to the scene and the root survives
// navigation. --px and --py come from the pointer (-1 to 1) where there's a fine one, and --py from the scroll (0 to 1) otherwise.
// --scroll and --read come from the page's own scroll, and only on a page with a ring or a hero. the pointer is read at
// most once a frame, and a value is only written when it changed. the glass highlight is placed on each pane in its
// own coordinates, since a fixed background inside a transformed pane is measured from the pane and not the window
const root = document.documentElement;
const fine = matchMedia("(hover: hover) and (pointer: fine)");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

let pointer = null;
let queued = false;
const written = new Map();

const put = (name, value) => {
  if (written.get(name) === value) {
    return;
  }
  written.set(name, value);
  if (value === null) {
    root.style.removeProperty(name);
  } else {
    root.style.setProperty(name, value);
  }
};

const round = (v) => String(Math.round(v * 1000) / 1000);
const clamp = (v) => Math.min(Math.max(v, 0), 1);

// panes with a highlight written on them, so taking it off touches only those
const lit = new Set();

const unlight = () => {
  for (const pane of lit) {
    pane.style.removeProperty("--hl-x");
    pane.style.removeProperty("--hl-y");
  }
  lit.clear();
};

// every rect is read before any pane is written, so a frame lays out once. a pane off screen keeps its last place
const light = () => {
  const panes = [...document.querySelectorAll("#page .glass")];
  const rects = panes.map((pane) => pane.getBoundingClientRect());
  panes.forEach((pane, i) => {
    const r = rects[i];
    if (r.bottom < 0 || r.top > innerHeight || r.width === 0) {
      return;
    }
    pane.style.setProperty("--hl-x", `${Math.round(pointer.x - r.left)}px`);
    pane.style.setProperty("--hl-y", `${Math.round(pointer.y - r.top)}px`);
    lit.add(pane);
  });
};

const frame = () => {
  queued = false;
  const body = document.querySelector("#page > .body");
  const top = body ? body.scrollTop : 0;
  const range = body ? body.scrollHeight - body.clientHeight : 0;
  // only the post's ring and the hero read these, and a root property write restyles the whole document
  if (document.querySelector("#page .ring, #page .hero")) {
    put("--read", round(range > 0 ? clamp(top / range) : 0));
    put("--scroll", reduced.matches ? "0" : round(top));
  } else {
    put("--read", null);
    put("--scroll", null);
  }
  if (reduced.matches || root.classList.contains("page-pinned")) {
    put("--px", null);
    put("--py", null);
    unlight();
    return;
  }
  if (fine.matches) {
    if (pointer) {
      put("--px", round((pointer.x / innerWidth) * 2 - 1));
      put("--py", round((pointer.y / innerHeight) * 2 - 1));
      light();
    } else {
      put("--px", null);
      put("--py", null);
      unlight();
    }
    return;
  }
  put("--px", null);
  put("--py", round(clamp(top / 600)));
  unlight();
};

// the failure test counts the scene's frames and leaves this one out by the mark
frame.layout = true;

const queue = () => {
  if (!queued) {
    queued = true;
    requestAnimationFrame(frame);
  }
};

document.addEventListener(
  "pointermove",
  (event) => {
    if (event.pointerType === "touch") {
      return;
    }
    pointer = { x: event.clientX, y: event.clientY };
    queue();
  },
  { passive: true },
);
document.documentElement.addEventListener("pointerleave", () => {
  pointer = null;
  queue();
});
document.addEventListener("scroll", queue, { capture: true, passive: true });
document.addEventListener("astro:after-swap", () => {
  lit.clear();
  frame();
});
addEventListener("resize", queue);
fine.addEventListener("change", queue);
reduced.addEventListener("change", queue);
queue();
