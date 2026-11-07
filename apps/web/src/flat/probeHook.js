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
        dragging: look.dragging(),
      };
    },
    // the volume buttons' hit areas in window px, the bar, and the sink
    volume: () => scene.volume.state(),
    // the charging cable's run, its sets, and the fold sets in use, and the battery's test control (ms into its cycle)
    charger: () => scene.charger.state(),
    battery: (at, speed) => probe.battery(at, speed),
    // the last step's frame meter (meter.js): ms measured, frames counted and how many were slow, and its verdict
    slowStep: () => scene.slowStep?.() ?? null,
    // the phone's state as the navigation reads it, with its fold
    status: () => probe.status(),
    // a resize or a turn the scene hasn't finished fitting to (a mount started then is cut off by it)
    rebuildPending: () => probe.rebuildPending(),
    mount: (options) => probe.mount(options),
    unmount: () => probe.unmount(),
  };
  Object.assign(window, { __flat: hook });
};
