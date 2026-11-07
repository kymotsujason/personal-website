// the timings, easings, and plain motion math both scenes read, so the 3d scene and the 2d one can't drift apart.
// nothing here may reach three.js, since the 2d bundle imports it
export { ease } from "../tween.js";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// the intro

// ms into the fast intro when the phone starts to unfold. in portrait the hands get under the edge first
export const FAST_FOLD_AT = { landscape: 0, portrait: 100 };

// each part of the move eases out on its own clock: the rise slows gradually and carries a little climb into the
// opening, the approach overlaps the unfold, and the tilt squares up as it's taken out. nothing turns a corner, so
// nothing reads as a stop between coming into view and opening
export const MOVE = {
    rise: { keys: ["x", "y"], time: 1500, power: 4.5 },
    approach: { keys: ["z"], time: 2100, power: 2.5 },
    turn: { keys: ["rx", "ry", "rz"], time: 1100, power: 3 }
};
export const moveTotal = () => Math.max(...Object.values(MOVE).map((m) => m.time));

export const moveAt = (ms, start, rest) => {
    const out = {};
    Object.values(MOVE).forEach(({ keys, time, power }) => {
        const u = 1 - Math.pow(1 - clamp(ms / time, 0, 1), power);
        keys.forEach((k) => {
            out[k] = start[k] + (rest[k] - start[k]) * u;
        });
    });
    return out;
};

// opening, the thumbs come off the closed phone's front and get under its free edge in the first 0.01 of the fold. eased
// in, that much of the fold takes a few frames, so the thumbs jumped. the hands go ahead along the path over LEAD.time
// with the phone still closed, and then hold there (handFold takes the lesser of the two) until the fold catches up
export const LEAD = { fold: 0.01, time: 300 };

// closing and opening the phone

export const FOLD_TIME = { close: 900, open: 1000 };

const POSE_FIELDS = ["x", "y", "z", "rx", "ry", "rz"];

// one progress value drives both the distance and the fold. closing backs away early and folds late, opening unfolds
// early and moves in late, so the flap never swings up into the camera while the phone is still close
export const foldPoseAt = (from, to, foldFrom, foldTo, p, action) => {
    const move = action === "close" ? 1 - Math.pow(1 - p, 2.2) : Math.pow(p, 2.2);
    const fold = action === "close" ? Math.pow(p, 1.6) : 1 - Math.pow(1 - p, 1.6);
    const out = { fold: foldFrom + (foldTo - foldFrom) * fold };
    POSE_FIELDS.forEach((k) => {
        out[k] = from[k] + (to[k] - from[k]) * move;
    });
    return out;
};

// how finely a swipe's fold table samples the fold
export const FOLD_SAMPLES = 480;
// the most any corner of the phone may move on screen for each px the pointer moves
export const MAX_FOLLOW = 2.5;
// how many px of drag it takes to make up the few px the pointer moved before a swipe took hold
export const CATCH_UP = 80;

// the idle drift only translates: any tilt at rest made the screen a true 3d layer, and the browser drew its text
// with missing vertical strips along the layer's tile seams
export const idleDrift = (t, idle) => ({
    x: Math.sin(t * 0.6 + 1) * 0.05 * idle,
    y: Math.sin(t * 0.9) * 0.06 * idle,
    z: Math.sin(t * 0.5 + 2) * 0.08 * idle
});

// the app window

// the window grows out of its icon on this curve over OPEN_WINDOW_MS, while the phone comes in to the zoomed pose over
// ZOOM_MS. a fold not yet flat when an app opens finishes over FOLD_FINISH_MS
export const springOut = (t) => 1 - Math.pow(1 - t, 3.2);
export const OPEN_WINDOW_MS = 520;
export const ZOOM_MS = 600;
export const FOLD_FINISH_MS = 160;
// closing, the window shrinks back into its icon over CLOSE_MS after CLOSE_DELAY_MS, or over CLOSE_SWIPE_MS at once
// when a swipe up let it go, while the phone goes back to rest over REST_RETURN_MS
export const CLOSE_MS = 460;
export const CLOSE_DELAY_MS = 80;
export const CLOSE_SWIPE_MS = 380;
export const REST_RETURN_MS = 650;
// the apps' background, ios's dark appearance. flat.css's #page column colors go with it
export const APP_BACKGROUND = "#000000";
// #page's fade for an open or a close with reduced motion
export const CROSSFADE_MS = 300;
// another page on the window that's already open fades in over this
export const FADE_IN_MS = 220;

// visitors took a while to find their way home from an app, so the first app one opens nudges the home bar up with a
// line saying what it does, once per browser
export const HOME_HINT_KEY = "homeHintSeen";
export const HOME_HINT_MS = 3600;

// a link in one app to another: the window shrinks into a card, mostly in height, slides sideways to the next app's
// card, and grows to fill the screen again. the page swap is held until the cards are SWITCH_SWAP_AT of the way
export const SWITCH_MS = 420;
export const SWITCH_SWAP_AT = 0.35;
export const SWITCH_SHRINK_X = 0.06;
export const SWITCH_SHRINK_Y = 0.14;
export const SWITCH_GAP = 0.04;
// a swap that hasn't landed when the cards arrive is waited on for at most this long
export const SWITCH_SWAP_WAIT_MS = 4000;

// the swipe up from the home bar. the window shrinks as it's pulled up, and on release it flies into its icon if it
// was pulled HOME_DISTANCE of the screen's height or flicked faster than HOME_FLICK (px per ms), or springs back to
// fill the screen over HOME_SPRING_BACK_MS
export const HOME_SHRINK = 0.65;
export const HOME_DISTANCE = 0.2;
export const HOME_FLICK = 0.5;
export const HOME_SPRING_BACK_MS = 300;
// the most the card rises, as a share of the screen's height. it rises one for one with the finger at first, then
// slower and slower toward this, as ios does, and the whole card stays on the screen
export const HOME_LIFT = 0.42;
// the card's gap from the window's edges, as a share of the screen's height, and how far into the pull it takes to
// blend from the whole screen into its motion, for each share of its size it has to lose on the way, so it shrinks at
// the same rate in any window. the zoomed screen covers the window, so in a window shaped unlike the screen it runs
// past two of the window's edges, and the card moves in a frame the size of the part that shows
export const HOME_EDGE = 0.03;
export const HOME_FIT = 0.45;
// a swipe that slows and rests opens the app switcher the way ios does. it's read from the finger's speed, not from
// it holding perfectly still, since a resting finger drifts: once the swipe is pulled up this far (a share of the
// screen's height) and its speed (px per ms, smoothed) stays under this for this long, the switcher opens. no move
// fires while the finger rests, so the speed fades with the time since the last one, and a fast swipe that stops dead
// still waits a little longer than one that slowed down first
export const SWITCHER_PULL = 0.06;
export const SWITCHER_SLOW = 0.25;
export const SWITCHER_REST_MS = 90;
export const SPEED_FADE_MS = 60;
// a release mostly sideways, this far along the page, switches straight to the app on that side
export const QUICK_SHARE = 0.2;

// the app switcher's numbers, grouped since several share a name with the home swipe's
export const SWITCHER = {
    // the cards' size and the gap between them, as shares of the page, and how far above the page's center they sit,
    // which leaves room for the labels
    CARD_SCALE: 0.62,
    CARD_GAP: 0.06,
    CARD_RISE: 0.04,
    // a label's height against its card's, and its gap above the card
    LABEL_SHARE: 0.085,
    LABEL_GAP: 0.03,
    // how far the home screen behind the cards zooms in and dims, in placeAppWindow's home (1 is an open app's, which
    // dims it to 0.7). this one dims it to 0.45
    BACKDROP_HOME: (1 - 0.45) / 0.3,
    // how much the darkened sky behind the cards hides the home screen, the way ios blurs the wallpaper there
    BACKDROP: 0.92,
    ENTER_MS: 320,
    SNAP_MS: 320,
    OPEN_MS: 340,
    HOME_FADE_MS: 200,
    LIFT_MS: 500,
    // how far a card can be pushed up, against its height, before it stops giving
    LIFT_LIMIT: 0.12,
    // a press that moves less than this (in the window's px) is a tap
    TAP_SLOP: 8,
    // a swipe up from outside the cards this far (in the window's px), or this fast (px per ms), goes home
    HOME_PULL: 40,
    HOME_FLICK: 0.5,
    // how far ahead a flick carries the row, in ms of its speed
    FLICK_AHEAD: 150,
    // a release this long after the last move was a finger at rest, so it carries no speed (no move fires while it rests)
    REST_MS: 50,
    // a swap that never lands leaves the opened card as a stand in for at most this long
    SWAP_WAIT_MS: 4000,
    // the swipe's neighbours fade in between these shares of the pull
    PEEK_FROM: 0.03,
    PEEK_TO: 0.14
};

// an ios style spring with a little bounce (bounce 0.2, about half a second), as a 0 to 1 curve over the tween. a
// switcher card pushed up springs back on it
export const liftSpring = (t) => {
    const seconds = t * 0.5;
    const zeta = 0.8;
    const omega = (2 * Math.PI) / 0.5;
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega * seconds) * (Math.cos(damped * seconds) + ((zeta * omega) / damped) * Math.sin(damped * seconds));
};

// how many app snapshots the switcher's cards can show besides #page
export const EXTRA_HOLES = 3;

// looking around and the dodge

// a drag that moves less than this (px) is still a tap
export const LOOK_SLOP = 6;
// with the phone closed it moves out of the mouse's way by this share of the cursor's distance from it, capped at
// AVOID_MAX of the window's smaller side
export const AVOID_GAIN = 0.45;
export const AVOID_MAX = 0.16;

// the volume buttons

// how far a pressed button sinks into the frame, cm, and how long the press and the bar take, ms
export const PRESS_DEPTH = 0.035;
export const PRESS_IN = 60;
export const PRESS_OUT = 140;
export const SHOW_FOR = 1400;
export const FADE_OUT = 260;
export const LEVEL_EASE = 120;
// the bar on the screen, cm: along the edge, across it, and in from the edge
export const BAR = { long: 2.6, short: 0.46, inset: 0.55 };
// the invisible area round each button that takes a press, cm. seen from the front the top edge is nearly edge on, so
// the buttons alone would be a few pixels tall
export const REACH = { along: 0.2, out: 0.7, inward: 0.15, depth: 0.45 };

// the charger's steps, in seconds. plugging in: reach away, come back with the plug, line it up, push it in, let go,
// return. unplugging is the same path backwards
export const PLAN = { swap: 0.35, away: 0.45, bring: 0.6, push: 0.28, release: 0.17, back: 0.5 };
