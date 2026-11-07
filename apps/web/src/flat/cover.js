// the black cover over the whole stage and #page, taking the pointer: a turn of the window decodes the new orientation
// under it (index.js), and the handoff from 3d loads the 2d scene under it (layouts/Site.astro). it goes up at once,
// fades once the scene under it has drawn, and goes at once on a failure. it imports nothing, so the layout can hold
// it without the 2d scene's chunk
export const createCover = (host) => {
  let el = null;
  return {
    up: () => {
      if (el) {
        el.classList.remove("lifting");
        return;
      }
      el = document.createElement("div");
      el.className = "flat-blackout";
      host.append(el);
    },
    lift: () => {
      const lifting = el;
      if (!lifting) {
        return;
      }
      el = null;
      lifting.classList.add("lifting");
      lifting.addEventListener("transitionend", () => lifting.remove(), {
        once: true,
      });
      // in case the fade never runs (a hidden tab)
      setTimeout(() => lifting.remove(), 400);
    },
    remove: () => {
      el?.remove();
      el = null;
    },
  };
};
