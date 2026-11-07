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
    // the desk's view, the dodge, the drift, and the rest rule's state
    effects: () => {
      const { look, drift } = scene.effects;
      return {
        yaw: look.view.yaw,
        pitch: look.view.pitch,
        targetYaw: look.view.targetYaw,
        targetPitch: look.view.targetPitch,
        avoidX: look.avoid.x,
        avoidY: look.avoid.y,
        idle: drift.idle(),
        calm: scene.calm,
        judged: scene.rest?.judged ?? false,
        verdict: scene.rest?.verdict ?? null,
        frosted: scene.frosted,
      };
    },
    // the phone's state as the navigation reads it, with its fold
    status: () => probe.status(),
    mount: (options) => probe.mount(options),
    unmount: () => probe.unmount(),
  };
  Object.assign(window, { __flat: hook });
};
