// the 2d scene, shown under html.has-flat-scene. for now it shows #page as the flat page on its first frame and lets
// every navigation through, so the site keeps working until the scene itself is built on top of this entry point.
// stageEl, siteData, arrival (window.__arrival), and from aren't read yet, and they're named so the layout's call
// matches the full scene's
export const startFlatScene = ({
  stageEl,
  pageEl,
  siteData,
  music,
  onShown,
  onFailed,
  onPageFlat,
  arrival,
  from,
}) => {
  const root = document.documentElement;
  let failed = false;
  let shown = false;

  // the scene opens the music app's player itself, the way the 3d scene does when the app opens
  const loadMusicPage = () => {
    if (!failed && document.getElementById("page")?.dataset.app === "Music") {
      music.loadPlayer();
    }
  };

  const fail = (reason) => {
    if (failed) {
      return;
    }
    failed = true;
    root.classList.remove("has-flat-scene", "flat-ready");
    pageEl.removeAttribute("style");
    console.warn("the 2d scene stopped", reason);
    onFailed(reason);
  };

  // nothing moves the phone yet, and the player waits on this before loading under has-flat-scene
  music.waitWhile(() => false);

  requestAnimationFrame(() => {
    if (failed || root.classList.contains("scene-failed")) {
      return;
    }
    shown = true;
    root.classList.add("flat-ready");
    Object.assign(window, { __flatShown: true });
    onPageFlat(true);
    onShown();
    loadMusicPage();
  });

  const navigation = async ({ swapped }) => {
    swapped.then((done) => {
      if (done && shown) {
        loadMusicPage();
      }
    });
  };

  const status = () => ({
    phone: null,
    busy: false,
    zoomed: false,
    app: null,
    shown,
    switchingTo: null,
    switcher: false,
    swapOpen: false,
  });

  return { fail, status, navigation };
};
