// the site's swap in place of Astro's. only #page takes the new page's content, so the stage, the scene in it, and
// the player host outside it are never replaced, and the music keeps playing. fns is Astro's swapFunctions
export const customSwap = (newDocument, rootState, fns) => {
  fns.deselectScripts(newDocument);
  fns.swapRootAttributes(newDocument);
  // the root's classes and custom properties never come from the server, and Astro's root swap removed them
  const root = document.documentElement;
  root.classList.add(...rootState.classes);
  for (const [name, value] of Object.entries(rootState.props)) {
    root.style.setProperty(name, value);
  }
  fns.swapHeadElements(newDocument);
  const restore = fns.saveFocus();
  const page = document.getElementById("page");
  const next = newDocument.getElementById("page");
  if (page && next) {
    swapPage(page, next);
  } else {
    fns.swapBodyElement(newDocument.body, document.body);
  }
  restore();
};

// the inline style belongs to the scene, so it stays
const swapPage = (page, next) => {
  for (const { name } of [...page.attributes]) {
    if (name !== "style" && !next.hasAttribute(name)) {
      page.removeAttribute(name);
    }
  }
  for (const { name, value } of [...next.attributes]) {
    if (name !== "style") {
      page.setAttribute(name, value);
    }
  }
  page.replaceChildren(...next.childNodes);
};
