// the charging cable's timing and the phone's move while it goes in or out, shared by both scenes. nothing here may
// reach three.js, since the 2d bundle imports it. charger.js runs the 3d hands, and loop.js moves the 3d phone
import { PLAN } from "./motion.js";

// the battery is about to need the cable when it's low, and does while it's charging (a visit that starts in the middle
// of a charge starts with the cable in)
export const CHARGER_BELOW = 5;
export const chargerWanted = (status) => status.charging || status.level <= CHARGER_BELOW;

// how far the phone turns its port edge toward the camera while the cable goes in (radians)
export const PRESENT_TILT = 0.1;
// the extra shake while one hand holds the open phone (cm, radians), and how far its free half sags (radians)
export const SHAKE_MOVE = 0.12;
export const SHAKE_TURN = 0.008;
export const SAG = 0.035;
// how far the phone gives when the plug is pushed home (cm)
export const PLUG_BUMP = 0.35;

// the left hand's own part of a run (s): away from its grip, bringing the plug, pushing it in, letting go, and back
export const CHARGE_TOTAL = PLAN.away + PLAN.bring + PLAN.push + PLAN.release + PLAN.back;
// where along the left hand's part the plug is in the port
export const PLUG_HOME = PLAN.away + PLAN.bring + PLAN.push;

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// the right hand takes its one handed grip before the left lets go, and the left has its grip back before the right
// returns to its own, so the phone always has a hand on it. `swap` is how long the right takes (0 when it has no one
// handed grip) and `run` how long the left hand's part is. gives the right hand's weight toward its one handed grip,
// and how far along its own part the left hand is
export const swapSchedule = (t, swap, run) => {
    const left = Math.min(Math.max(t - swap, 0), run);
    if (swap <= 0) {
        return { right: null, left };
    }
    const into = clamp01(t / swap);
    const out = clamp01((swap * 2 + run - t) / swap);
    return { right: smooth(Math.min(into, out)), left };
};

// while the hand works at the port the phone is turned a little to show that edge, like someone finding the port.
// 0 to 1 over the left hand's part `t`, rising as the hand leaves and settling once it's back
export const liftAt = (t) => {
    const rise = Math.min(t / PLAN.away, 1);
    const settle = Math.min(Math.max((CHARGE_TOTAL - t) / PLAN.back, 0), 1);
    const k = Math.min(rise, settle);
    return k * k * (3 - 2 * k);
};

// 0 to 1 and back as the plug is pushed home: rises through the end of the push, falls through the release
export const bumpAt = (t) => {
    const start = PLAN.away + PLAN.bring + PLAN.push * 0.5;
    const end = PLAN.away + PLAN.bring + PLAN.push + PLAN.release + 0.12;
    if (t <= start || t >= end) {
        return 0;
    }
    return Math.sin((Math.PI * (t - start)) / (end - start));
};

// how far the left hand is off its grip, 0 to 1, so the phone can wobble more while one hand holds it
export const handOffAt = (t) => {
    const b1 = PLAN.away;
    const b4 = PLUG_HOME + PLAN.release;
    if (t < b1) {
        return inOut(t / b1);
    }
    if (t < b4) {
        return 1;
    }
    return 1 - inOut(Math.min((t - b4) / PLAN.back, 1));
};

// the shake while one hand holds the phone, at full strength, at `seconds` on the page's clock
export const shakeAt = (seconds) => ({
    x: (Math.sin(seconds * 5.3) * 0.6 + Math.sin(seconds * 8.9 + 1.3) * 0.4) * SHAKE_MOVE,
    y: (Math.sin(seconds * 6.1 + 0.7) * 0.6 + Math.sin(seconds * 9.7 + 2.1) * 0.4) * SHAKE_MOVE,
    rx: Math.sin(seconds * 4.7 + 0.4) * SHAKE_TURN,
    ry: Math.sin(seconds * 5.9 + 1.9) * SHAKE_TURN
});

// the port's outward direction in the phone's own frame: down off the flap's bottom edge, which portrait's quarter
// roll turns to the left. the fold turns the flap about its y axis, so it doesn't change it
export const portOut = (portrait) => (portrait ? [-1, 0, 0] : [0, -1, 0]);

const rotX = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const rotY = ([x, y, z], a) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
const rotZ = ([x, y, z], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];

// the phone's pose with the charger's move on it, as scene/loop.js moves the root: the shake and the sag while one hand
// holds the open phone, then the turn of the port edge toward the camera (tx and ty, a turn about the phone's own x
// and y after its pose's turn), the rise by fit (fitInView's, once per run), and the bump as the plug goes home. left
// is how far along its own part the left hand is (s), and appVisible leaves the shake's turn and the sag out
export const chargeMove = ({ pose, left, fit, seconds, portrait, fold, appVisible = false }) => {
    const out = { ...pose, tx: pose.tx ?? 0, ty: pose.ty ?? 0 };
    const shaky = handOffAt(left) * clamp01(1 - fold);
    if (shaky > 0) {
        const shake = shakeAt(seconds);
        out.x += shake.x * shaky;
        out.y += shake.y * shaky;
        if (!appVisible) {
            out.rx += shake.rx * shaky;
            out.ry += shake.ry * shaky;
            // the left half droops in landscape, the top half tips back in portrait
            if (portrait) {
                out.rx -= SAG * shaky;
            } else {
                out.rz += SAG * shaky;
            }
        }
    }
    const present = liftAt(left);
    if (present <= 0 || !fit) {
        return out;
    }
    // the turn is about port out crossed with the camera's z, which is -x in landscape and +y in portrait
    const angle = PRESENT_TILT * present;
    if (portrait) {
        out.ty += angle;
    } else {
        out.tx -= angle;
    }
    out.x += fit.x * present;
    out.y += fit.y * present;
    out.z += fit.z * present;
    const bump = bumpAt(left);
    if (bump > 0) {
        // the port's outward direction as the phone now faces, the pose's turn on top of the tilt
        const dir = rotX(rotY(rotZ(rotX(rotY(portOut(portrait), out.ty), out.tx), out.rz), out.ry), out.rx);
        out.x -= dir[0] * PLUG_BUMP * bump;
        out.y -= dir[1] * PLUG_BUMP * bump;
        out.z -= dir[2] * PLUG_BUMP * bump;
    }
    return out;
};
