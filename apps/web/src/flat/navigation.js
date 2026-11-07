// the site's navigations drive the 2d phone the way scene/navigation.js drives the 3d one: a close plays before the
// swap, so the window shows the app's content until the zoom ends, and an open or a fade plays after it, once #page
// holds the new page. whatever order navigations arrive and drop in, the phone ends on the page the router swapped in
// last. that module reaches three and keeps its state at module level, so this one is its copy with its own state for
// each scene

// how often a wait looks at the scene again. it's a timer and not a frame, so a hidden tab still gets there
const POLL_MS = 16;
const TRANSITION_CAP_MS = 1000;
// the most moves one settle makes for one target, in case two moves undo each other
const SETTLE_MOVES = 12;

const normalPath = (pathname) => pathname.replace(/(.)\/+$/, "$1");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// scene gives { status(), hasApp(name), openApp(name, { from }), closeApp(), fadeTo(name), switchTo(name, opts),
// leaveSwitcher(), showUrl(), rebuildPending(), fail(error), failed() }, and links { navigate(path), goHome() } from
// the layout. without links a tap opens the app itself
export const createNavigation = (
  scene,
  links = null,
  {
    poll = POLL_MS,
    transitionCap = TRANSITION_CAP_MS,
    moves = SETTLE_MOVES,
  } = {},
) => {
  const tick = () => pause(poll);
  // the navigation in flight, and the app its page is for once that's known (null for the home screen)
  let pending = null;
  // the page a navigation in flight is going to once it's known, as "home" or the app's name
  let pendingPage = null;
  // the box a tap on the home screen asked the window to grow out of, for the open that follows its navigation
  let tapped = null;
  // #page took new content while the window showed it, so the window fades it in
  let stale = false;
  // swaps whose view transition hasn't finished, since an open waits for the router's transition to be over
  let transitioning = 0;
  let settling = null;
  // a kick that came while a settle was running, which starts the count again or, if that settle has stopped, a new one
  let kicked = false;

  const failed = () => scene.failed();

  // a tap on an icon or a widget asks for the app's page, and the open follows the navigation. false when there's no
  // navigation, so the caller opens the app itself
  const requestApp = (app, { from = null, path = app.path } = {}) => {
    if (!links) {
      return false;
    }
    tapped = { name: app.name, from };
    links.navigate(path);
    return true;
  };

  // the home bar and escape. false when there's no navigation, so the caller closes the app itself
  const requestHome = () => {
    if (!links) {
      return false;
    }
    links.goHome();
    return true;
  };

  const pageApp = () => {
    const name = document.getElementById("page")?.dataset.app;
    return scene.hasApp(name) ? name : null;
  };

  // where the phone should end: a navigation in flight once its page is known, or else the page #page holds. null
  // while the page in flight isn't known yet
  const target = () => {
    if (pending) {
      return pending.known
        ? { app: pending.app, swapped: false, nav: pending }
        : null;
    }
    return { app: pageApp(), swapped: true };
  };

  // one move toward the target, "wait" while the scene is busy, or "stop" once there's nothing left to do. a close
  // may start before its swap, while an open or a fade waits for #page to hold the page it shows
  const step = () => {
    if (failed()) {
      return "stop";
    }
    const s = scene.status();
    if (
      s.phone === null ||
      s.busy ||
      transitioning > 0 ||
      scene.rebuildPending()
    ) {
      return "wait";
    }
    const want = target();
    if (!want) {
      return "stop";
    }
    if (want.app === null) {
      // a swap the cap let land mid close leaves nothing to fade in once the window is gone
      stale = false;
      return s.zoomed ? scene.closeApp() : "stop";
    }
    if (!want.swapped) {
      // another app's page on its way while one is open plays the switch now, which lets the swap through partway
      // instead of waiting for it. a page the browser already animated to, or a rebuild, jumps instead
      const nav = want.nav;
      if (
        s.zoomed &&
        s.app !== null &&
        s.app !== want.app &&
        nav &&
        !nav.switched &&
        !nav.jumps() &&
        scene.switchTo
      ) {
        nav.switched = true;
        return scene.switchTo(want.app, {
          back: nav.back,
          swapped: nav.swapped,
        });
      }
      return "stop";
    }
    if (!s.zoomed) {
      const from = tapped && tapped.name === want.app ? tapped.from : null;
      tapped = null;
      return scene.openApp(want.app, { from });
    }
    if (s.app !== want.app || stale) {
      stale = false;
      return scene.fadeTo(want.app);
    }
    return "stop";
  };

  const settle = async () => {
    let count = 0;
    while (count < moves) {
      if (kicked) {
        kicked = false;
        count = 0;
      }
      const next = step();
      if (next === "stop") {
        return;
      }
      if (next === "wait") {
        await tick();
        continue;
      }
      count++;
      await next;
    }
  };

  const kick = () => {
    if (settling) {
      kicked = true;
      return;
    }
    // a move that throws is a scene entry point failing, so the page shows flat. that also ends a move that left the
    // scene busy, which every later navigation would otherwise wait out
    settling = settle()
      .catch((error) => scene.fail(error))
      .finally(() => {
        settling = null;
        if (kicked) {
          kicked = false;
          kick();
        }
      });
  };

  // the swap can go ahead unless the window shows #page in a way the new page would break: mid open or mid close, or
  // open at full zoom while the page in flight is the home screen (or isn't known yet)
  const safeToSwap = () => {
    if (failed()) {
      return true;
    }
    const s = scene.status();
    if (s.phone === null || !s.shown) {
      return true;
    }
    const want = target();
    // a switch to this page lets its swap through once the cards are partway over
    if (s.busy) {
      return Boolean(
        s.swapOpen && want && want.app !== null && want.app === s.switchingTo,
      );
    }
    return Boolean(want && want.app !== null);
  };

  const handler = async ({
    to,
    direction,
    uaTransition,
    page,
    swapped,
    signal: dropped,
  }) => {
    // the browser already played its own back animation, or a rebuild is about to set the phone, so it jumps
    const jumps = () => uaTransition || scene.rebuildPending();
    const mine = {
      known: false,
      app: null,
      back: direction === "back",
      swapped,
      jumps,
      switched: false,
    };
    pending = mine;
    // Back or Forward while the switcher shows puts the open app back first. a card the switcher opened is its own
    // navigation, which it's already handing over to
    const now = scene.status();
    if (now.switcher && now.switchingTo === null) {
      scene.leaveSwitcher();
    }
    let swappedYet = false;
    const learn = (name) => {
      if (pending !== mine) {
        return;
      }
      mine.known = true;
      mine.app = scene.hasApp(name) ? name : null;
      pendingPage = mine.app ?? "home";
      if (mine.app === null && jumps() && scene.status().phone !== null) {
        scene.showUrl();
      }
      kick();
    };
    if (normalPath(to.pathname) === "/") {
      learn("home");
    } else {
      page.then(learn);
    }
    swapped.then(async (done) => {
      swappedYet = true;
      if (pending === mine) {
        pending = null;
        pendingPage = null;
      }
      if (!done) {
        kick();
        return;
      }
      const s = scene.status();
      // a switch running now shows the new page itself as its card arrives, and a page of the same app slides in
      // with the view transition (see .page-slide in flat.css), so neither needs the fade
      stale =
        s.shown &&
        s.switchingTo === null &&
        !document.documentElement.classList.contains("page-slide");
      if (jumps() && s.phone !== null) {
        scene.showUrl();
        stale = false;
      }
      if (done.viewTransition) {
        transitioning++;
        // a transition that never reports finishing doesn't hold the phone for long
        await Promise.race([
          done.viewTransition.finished.catch(() => {}),
          pause(transitionCap),
        ]);
        transitioning--;
      }
      kick();
    });
    kick();
    while (!safeToSwap() && !dropped.aborted && !swappedYet) {
      await tick();
    }
  };

  return {
    handler,
    safeToSwap,
    requestApp,
    requestHome,
    // the page a navigation in flight is going to once known ("home" or an app's name), else null
    pendingPage: () => pendingPage,
    // a move toward the address's page, for a change the scene made outside a navigation (the intro ending)
    kick,
  };
};
