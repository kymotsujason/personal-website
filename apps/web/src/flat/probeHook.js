// window.__flat for the speed probes (tests/prod/flat-probes.spec.ts), loaded only where __CAPTURE__ is true. it reads
// the running 2d scene's own stage, frames, and screens. a probe calls mount(), which waits for the scene to start,
// ends its intro, and leaves the phone open at rest, building another set only when the probe names one
export const installFlatHook = (probe) => {
  const { scene } = probe;
  const hook = {
    get stage() {
      return scene.stage;
    },
    get frames() {
      return scene.stage?.frameLayer ?? null;
    },
    get screens() {
      return scene.screens;
    },
    get manifest() {
      return scene.manifest;
    },
    setPose: (pose) => scene.stage.setPose(pose),
    // the fold picks the frame, and the screens are warped onto that frame's corners
    setFold: (fold, lead = 0) => {
      scene.stage.setFold(fold, lead);
      const index = scene.stage.frameLayer.frameFor(fold, lead);
      scene.screens.place(scene.manifest.frames[index], scene.manifest);
    },
    mount: (options) => probe.mount(options),
    unmount: () => probe.unmount(),
  };
  Object.assign(window, { __flat: hook });
};
