// how far a slow device turns the sky down: 0 draws at 30 fps, 1 at 15, 2 holds still. slow and fast count seconds in a
// row while the sky is on screen. three slow ones step it down, and thirty fast ones step it back up, but only once a
// visit, so a passing hitch doesn't stop the sky for good while a device that's really too slow doesn't flip back
// and forth
export const SLOW_STEP = 3;
export const FAST_STEP = 30;

export const stepSkyLevel = ({ level, slow, fast, retried }) => {
    if (slow >= SLOW_STEP && level < 2) {
        return { level: level + 1, slow: 0, fast: 0, retried };
    }
    if (fast >= FAST_STEP && level > 0 && !retried) {
        return { level: level - 1, slow: 0, fast: 0, retried: true };
    }
    return { level, slow, fast, retried };
};

// the glass a level can afford. the frosted glass blurs the sky again each time the sky draws, and following the
// phone's tilt redraws the screen whenever the phone turns, so a device slow enough to turn the sky down gets plain
// glass (the sky lifted toward the tint, its rims still lit) that holds still. at level 2 the sky stops, and plain
// glass then costs nothing at all
export const glassFor = (level) => (level >= 1 ? { frosted: false, tilt: false } : { frosted: true, tilt: true });

// the site's steps after a still sky, in order: simpler glass on the phone's screens, then no focus blur, then the
// desk kept at its small images. a device still slow with the sky stopped takes one more after three slow seconds in
// a row, and never steps back, since each one only saves work
export const LATER = { simpleGlass: 1, noFocusBlur: 2, smallDesk: 3 };

export const stepLater = ({ level, slow }) => {
    if (slow >= SLOW_STEP && level < LATER.smallDesk) {
        return { level: level + 1, slow: 0 };
    }
    return { level, slow };
};
