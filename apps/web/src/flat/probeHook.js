// window.__flat for the speed probes (tests/prod/flat-probes.spec.ts), loaded only where __CAPTURE__ is true. nothing
// mounts on load, so other specs that open the 2d site cost nothing. a probe calls mount(), which builds a stage and the
// screens of its own (nothing mounts them on the site yet) and builds them again for another set or size
import { chooseLighting, phoneHeightPx, sizeFor } from "./frames.js";
import { loadManifest } from "./manifest.js";
import { createScreens } from "./screens.js";
import { createStage } from "./stage.js";

export const installFlatHook = ({ stageEl, pageEl, siteData, music }) => {
  const hook = {
    stage: null,
    frames: null,
    screens: null,
    manifest: null,
    setPose: (pose) => hook.stage.setPose(pose),
    // the fold picks the frame, and the screens are warped onto that frame's corners
    setFold: (fold, lead = 0) => {
      hook.stage.setFold(fold, lead);
      const index = hook.frames.frameFor(fold, lead);
      hook.screens.place(hook.manifest.frames[index], hook.manifest);
    },
    unmount: () => {
      hook.screens?.destroy();
      hook.stage?.destroy();
      hook.stage = null;
      hook.frames = null;
      hook.screens = null;
      hook.manifest = null;
    },
    mount: async ({ set, lighting, size } = {}) => {
      hook.unmount();
      const portrait = innerHeight > innerWidth;
      const manifest = await loadManifest(
        set ?? (portrait ? "cable-portrait-open" : "cable-landscape"),
        lighting ?? chooseLighting(new Date().getHours()),
        size ??
          sizeFor({
            phonePx:
              phoneHeightPx({
                width: innerWidth,
                height: innerHeight,
                portrait,
              }) * devicePixelRatio,
          }),
      );
      const stage = createStage({ stageEl, pageEl, manifest });
      const screens = createScreens({
        host: stage.layers.screens,
        siteData,
        music,
        portrait: manifest.orientation === "portrait",
      });
      hook.stage = stage;
      hook.frames = stage.frameLayer;
      hook.screens = screens;
      hook.manifest = manifest;
      await stage.frameLayer.decode();
      stage.setPose(stage.placed.rest);
      hook.setFold(0);
      return manifest;
    },
  };
  Object.assign(window, { __flat: hook });
};
