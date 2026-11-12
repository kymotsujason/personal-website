// the page's depth inputs, written on each of #page's children, since only the page's own content reads them. a
// write on the root restyled the whole document, the 2d scene's thousands of frame pieces included, on every pointer
// move and every scroll frame (about 225 ms a second of style in a 2026-11-12 trace against 114 for 3d). #page's own
// style belongs to the scene, which leaves none behind once it stops, and its children are new after each swap, so the
// frame after a swap writes them again. --px and --py come from the pointer (-1 to 1) where there's a fine one, and
// --py from the scroll (0 to 1) otherwise. --scroll and --read come from the page's own scroll, and only on a page with
// a ring or a hero. the pointer is read at most once a frame, and a value is only written where it differs. the glass
// highlight is placed on each pane in its own coordinates, since a fixed background inside a transformed pane is
// measured from the pane and not the window
const root = document.documentElement;
const fine = matchMedia("(hover: hover) and (pointer: fine)");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

let pointer = null;
let queued = false;

// read from each child itself, so a child a swap put in gets the values again
const put = (name, value) => {
  const children = document.getElementById("page")?.children ?? [];
  for (const child of children) {
    if (child.style.getPropertyValue(name) === (value ?? "")) {
      continue;
    }
    if (value === null) {
      child.style.removeProperty(name);
    } else {
      child.style.setProperty(name, value);
    }
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
  // only the post's ring and the hero read these
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
