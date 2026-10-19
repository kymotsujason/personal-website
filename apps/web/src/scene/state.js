import { glassFor } from "./skyLevel.js";

// cm, open size from macrumors (164.6 x 117.8 x 5.2 mm), inner screen sized to a 7.6 inch diagonal
export const DUO = {
    halfW: 8.23,
    bodyH: 11.78,
    depth: 0.52,
    gap: 0.09,
    outerR: 0.9,
    hingeR: 0.06,
    halfScreenW: 7.9,
    screenH: 11.1,
    screenR: 0.7,
    coverW: 7.7,
    coverH: 11.2,
    coverR: 0.75
};

// how far from flat the unfold can be when the icons start taking taps
export const TAP_FOLD = 0.12;

export const FOV = 32;
export const HOME_FILL = 0.86;

// what the spike's test panel picked: the flat page at full zoom, the device, the hands, and the phone's finish.
// the dev panel changes them, and nothing else in the scene reads the panel
export const settings = { flatAtFullZoom: true, device: "auto", hands: "hands", finish: "star-white" };

// every field is declared here, so each module reads and writes the same names
export const state = {
    // what glass the sky's level allows (see skyLevel.js glassFor)
    glassLevel: glassFor(0),
    portrait: false,
    // which of portrait's grip paths the hands are on, the fold they had last frame, and whether the pose editor holds them
    foldPath: "open",
    lastFold: 0,
    posing: false,
    // how far the hands have gone ahead along the opening path before the phone moves, 0 to 1 (see leadOpen)
    lead: 0,
    root: null,
    hinged: null,
    pivot: null,
    surfaces: {},
    poses: null,
    appVisible: false,
    zoomed: false,
    busy: false,
    handModel: null,
    phoneModel: null,
    hingeTurn: null,
    cameraSolid: null,
    // the hinge cover's box in the frame that turns it, for the hands' collision checks
    hingeSolid: null,
    flap: null,
    body: null,
    hands: null,
    screen: null,
    cover: null,
    wallpaper: null,
    frost: null,
    glass: null,
    volume: null,
    charger: null,
    // "open" or "closed" once the phone has settled, null before the first intro unlocks it
    phone: null,
    openApp: null,
    // the data-app of the page a navigation in flight is going to, once it's known, or null (see navigation.js)
    pendingPage: null,
    openIcon: null,
    appEl: null,
    appSplash: null,
    // #page shown as a plain flat page at full zoom, with no transform, in place of pinned onto the app window
    pageFlat: false,
    // #page's opacity while it fades in or out over the phone with reduced motion (see appWindow.js), or null
    pageFade: null,
    appLive: null,
    homeLaidOut: false,
    screensChanged: false,
    statusChanged: false,
    chargeFit: null,
    warmedUp: false
};

export const pose = { x: 0, y: 0, z: -40, rx: 0, ry: 0, rz: 0, blur: 0, idle: 1, fold: 0 };
