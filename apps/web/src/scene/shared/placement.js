import { DUO, FOV, HOME_FILL } from "../state.js";

// where the phone sits for a window of this size, in the camera's space (cm), for both scenes. nothing here may reach
// three.js, since the 2d bundle imports it
export const place = ({ width, height, portrait }) => {
    const bodyW = portrait ? DUO.bodyH : DUO.halfW * 2;
    const bodyH = portrait ? DUO.halfW * 2 : DUO.bodyH;
    const screenW = portrait ? DUO.screenH : DUO.halfScreenW * 2;
    const screenH = portrait ? DUO.halfScreenW * 2 : DUO.screenH;

    const aspect = width / height;
    const tanHalf = Math.tan((FOV / 2) * (Math.PI / 180));
    const homeDist = Math.max(bodyH / (HOME_FILL * 2 * tanHalf), bodyW / (HOME_FILL * 2 * tanHalf * aspect));

    // cover: the screen fills the window in one dimension exactly and overflows in the other
    const zoomDist = Math.min(screenH / (2 * tanHalf), screenW / (2 * tanHalf * aspect));
    const visibleH = (dist) => 2 * dist * tanHalf;
    const appW = (screenW / (visibleH(zoomDist) * aspect)) * width;
    const appH = (screenH / visibleH(zoomDist)) * height;

    return {
        homeDist,
        zoomDist,
        appW,
        appH,
        rest: { x: 0, y: 0, z: -homeDist, rx: 0, ry: 0, rz: 0 },
        // the opening plays at the home distance. in landscape the closed slab sits centered so it's fully in view,
        // in portrait the body half stays low while the lid opens upward, then rises a little into the home pose
        // closed and fully in view with room below it, a little farther back and lower than home, so the unfold can
        // carry it up and closer into the home pose in one motion
        stage: portrait
            ? { x: 0, y: -0.9, z: -homeDist * 1.12, rx: 0.05, ry: 0, rz: 0 }
            : { x: 0, y: -0.5, z: -homeDist * 1.1, rx: 0.05, ry: 0, rz: 0 },
        // zoomDist is where the screen itself has to be, and the screen sits in front of the device's center plane by
        // half its depth, so the device stops that much farther back. without this the app ended 1.55% larger than
        // the window and visibly shrank when the flat page took over
        zoom: { x: 0, y: 0, z: -(zoomDist + DUO.depth / 2 + 0.003), rx: 0, ry: 0, rz: 0 },
        fullStart: {
            x: bodyW * 0.1, y: -visibleH(homeDist) * 0.75 - bodyH * 0.4,
            z: -homeDist * 1.25, rx: -1.15, ry: 0.28, rz: -0.12
        },
        fastStart: { x: 0, y: -bodyH * 0.18, z: -homeDist * 1.06, rx: -0.28, ry: 0.05, rz: -0.03 }
    };
};
