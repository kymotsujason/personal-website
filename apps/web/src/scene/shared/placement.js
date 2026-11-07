import { DUO, FOV, HOME_FILL } from "../state.js";

// how far in front of the phone's center the open screen's html lies (device.js pins it there), which is the plane the
// zoom pose puts at zoomDist
export const SCREEN_FRONT = DUO.depth / 2 + 0.003;

// in portrait the hinge keeps the closed slab centered by shifting it up half a device as it closes, which made the
// whole device sink while opening. this cancels that shift in world space (cm in y), so the body half holds still and
// the lid opens upward
export const centerShift = (fold, portrait) => (portrait ? -(DUO.halfW / 2) * Math.min(Math.max(fold, 0), 1) : 0);

// the home screens' css px per cm of the phone (device.js lays them out at this)
export const PX_PER_CM = 54.4;
// how far the two halves' screens overlap at the hinge, in cm, so no seam shows (device.js hole)
export const SEAM = 0.02;

// the open screen, its halves, and the cover in the open screen's css px, upright on screen, the way device.js lays
// them out from the model. side is the flap's half with the widgets, main is where the cover lies over the body's half
// when closed (its content continues there open), and flap, body, and cover are each screen's whole box, which is
// what the capture records the corners of. main and cover can start a little outside the screen, since the cover is
// taller than it
export const screenLayout = (portrait) => {
    const { halfW, halfScreenW, screenH, screenR, coverW, coverH, coverR } = DUO;
    const sy = screenH / 2;
    // a point in the body's frame onto the open screen, which portrait's roll turns a quarter
    const toPx = (x, y) => (portrait ? [(y + sy) * PX_PER_CM, (halfScreenW + x) * PX_PER_CM] : [(x + halfScreenW) * PX_PER_CM, (sy - y) * PX_PER_CM]);
    const rect = (x0, x1, y0, y1) => {
        const [ax, ay] = toPx(x0, y0);
        const [bx, by] = toPx(x1, y1);
        return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
    };
    // closed, the flap is turned over onto the body, so the cover's x in the flap is -x in the body
    const main = rect(halfW / 2 - coverW / 2, halfW / 2 + coverW / 2, -coverH / 2, coverH / 2);
    return {
        fullW: (portrait ? screenH : halfScreenW * 2) * PX_PER_CM,
        fullH: (portrait ? halfScreenW * 2 : screenH) * PX_PER_CM,
        radius: screenR * PX_PER_CM,
        side: rect(-halfScreenW, 0, -sy, sy),
        main,
        flap: rect(-halfScreenW, SEAM, -sy, sy),
        body: rect(-SEAM, halfScreenW, -sy, sy),
        cover: { x: 0, y: 0, w: main.w, h: main.h },
        coverRadius: coverR * PX_PER_CM
    };
};

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
        zoom: { x: 0, y: 0, z: -(zoomDist + SCREEN_FRONT), rx: 0, ry: 0, rz: 0 },
        fullStart: {
            x: bodyW * 0.1, y: -visibleH(homeDist) * 0.75 - bodyH * 0.4,
            z: -homeDist * 1.25, rx: -1.15, ry: 0.28, rz: -0.12
        },
        fastStart: { x: 0, y: -bodyH * 0.18, z: -homeDist * 1.06, rx: -0.28, ry: 0.05, rz: -0.03 }
    };
};

// the margin the phone keeps from the window's edges while the charging cable goes in (of the window's size), and how
// far it lifts while the hand goes for the cable, at most (of the window's height), as if the holding hand raises it to
// make room. it never lifts past the top margin
const PRESENT_MARGIN = 0.07;
const PRESENT_LIFT = 0.06;

// the move (cm, in the scene) for the charging cable: the phone rises by PRESENT_LIFT of the window's height while
// staying whole in view with PRESENT_MARGIN on every side, backing off from the camera if there isn't room to rise.
// outer is the phone's bounds in window px, and z its distance along the camera's z (negative, in cm)
export const fitInView = ({ outer, z, width, height }) => {
    const d = -z;
    const mx = width * PRESENT_MARGIN;
    const my = height * PRESENT_MARGIN;
    const lift = PRESENT_LIFT * height;
    const cx = width / 2;
    const cy = height / 2;
    // the phone has to fit with room to rise: between the top margin and the bottom margin raised by the lift
    const scale = Math.max(1, (outer.right - outer.left) / (width - 2 * mx), (outer.bottom - outer.top) / (height - 2 * my - lift));
    const s = 1 / scale;
    const box = { left: cx + (outer.left - cx) * s, right: cx + (outer.right - cx) * s, top: cy + (outer.top - cy) * s, bottom: cy + (outer.bottom - cy) * s };
    const shiftX = Math.max(mx - box.left, 0) - Math.max(box.right - (width - mx), 0);
    // up by the lift (more if the bottom is still past its margin), but never past the top margin
    const room = Math.max(box.top - my, 0);
    const up = Math.min(Math.max(lift, box.bottom - (height - my)), room);
    const shiftY = -up;
    const worldPerPx = (2 * Math.tan((FOV / 2) * (Math.PI / 180)) * d * scale) / height;
    return { x: shiftX * worldPerPx, y: -shiftY * worldPerPx, z: -(d * scale - d) };
};
