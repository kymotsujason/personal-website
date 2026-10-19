// the About page's flip stack. each card keeps its place in data-pos (0 is the front), so the page needs no state of
// its own and a client side navigation brings a fresh stack. the next button covers the stack and is a real button,
// so Enter and Space arrive as clicks. the stacked look is CSS under (scripting: enabled), not a class set here

const announce = (stack) => {
  const live = stack
    .closest(".facts-widget")
    ?.querySelector("[data-facts-live]");
  if (live) {
    live.textContent =
      stack.querySelector('.fact[data-pos="0"]')?.textContent ?? "";
  }
};

// a card that isn't in front has transparent text but stays in the tree, so it's hidden from assistive technology
const hideBehind = (stack) => {
  stack.querySelectorAll(".fact").forEach((card) => {
    if (card.dataset.pos === "0") {
      card.removeAttribute("aria-hidden");
    } else {
      card.setAttribute("aria-hidden", "true");
    }
  });
};

// the live region stays empty on load, so a screen reader doesn't read a fact nobody asked for
const prepare = () => {
  document.querySelectorAll("[data-facts]").forEach(hideBehind);
};

const advance = (stack) => {
  const cards = [...stack.querySelectorAll(".fact")];
  const dots = stack.closest(".facts-widget")?.querySelectorAll(".dots i");
  cards.forEach((card, i) => {
    const pos = (Number(card.dataset.pos) - 1 + cards.length) % cards.length;
    card.dataset.pos = String(pos);
    dots?.[i]?.classList.toggle("on", pos === 0);
  });
  hideBehind(stack);
  announce(stack);
};

document.addEventListener("click", (event) => {
  const next =
    event.target instanceof Element
      ? event.target.closest("[data-facts-next]")
      : null;
  const stack = next?.closest("[data-facts]");
  if (stack) {
    advance(stack);
  }
});

document.addEventListener("astro:after-swap", prepare);
prepare();
