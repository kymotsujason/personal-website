// the page's depth inputs, written to the root since #page's style belongs to the scene and the root survives
// navigation. --px and --py (-1 to 1) come from the pointer where there's a fine one, and from the scroll otherwise.
// --mx and --my put the glass highlight under the pointer. --scroll and --read come from the page's own scroll, and
// only on a page with a ring or a hero. the pointer is read at most once a frame, and a value is only written when it
// changed
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
    put("--mx", null);
    put("--my", null);
    return;
  }
  if (fine.matches) {
    if (pointer) {
      put("--px", round((pointer.x / innerWidth) * 2 - 1));
      put("--py", round((pointer.y / innerHeight) * 2 - 1));
      put("--mx", `${Math.round(pointer.x)}px`);
      put("--my", `${Math.round(pointer.y)}px`);
    } else {
      put("--px", null);
      put("--py", null);
      put("--mx", null);
      put("--my", null);
    }
    return;
  }
  put("--px", null);
  put("--py", round(clamp(top / 600)));
  put("--mx", null);
  put("--my", null);
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
document.addEventListener("astro:after-swap", frame);
addEventListener("resize", queue);
fine.addEventListener("change", queue);
reduced.addEventListener("change", queue);
queue();
