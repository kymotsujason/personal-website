// the address switches for testing (?slow and ?noweather) count only where this is true, the dev server and the capture
// build, so the build that ships ignores them. node's own tests have no import.meta.env or __CAPTURE__
export const testSwitches = Boolean(import.meta.env?.DEV) || (typeof __CAPTURE__ !== "undefined" && __CAPTURE__);
