import * as THREE from "three";

// the scene's window and document listeners and its intervals all end together when the scene fails (see index.js),
// through this one signal
const controller = new AbortController();

export const signal = controller.signal;

export const endScene = () => controller.abort();

// and its fetches all end through this one, the three loaders' included
const fetches = new AbortController();

export const endFetches = () => fetches.abort();

// three's loaders read their manager's controller for each request. the manager's own makes a fresh one after an
// abort, so a load started after the failure would go ahead, and this one stays aborted
export const loadingManager = new THREE.LoadingManager();
Object.defineProperty(loadingManager, "abortController", { value: fetches });

// a signal that ends with the scene's fetches, or with the one given, whichever is first. a browser without
// AbortSignal.any gets the same by hand
export const sceneSignal = (own = null) => {
    if (!own) {
        return fetches.signal;
    }
    const both = new AbortController();
    const end = () => both.abort();
    [own, fetches.signal].forEach((s) => {
        if (s.aborted) {
            end();
        } else {
            s.addEventListener("abort", end, { once: true });
        }
    });
    return both.signal;
};

export const sceneFetch = (url, options = {}) => fetch(url, { ...options, signal: sceneSignal(options.signal) });

// what a failure calls, set by index.js, so each entry point can hand it what it threw
let onFail = () => {};
export const setFail = (fn) => {
    onFail = fn;
};
export const failScene = (reason) => onFail(reason);

// an event handler or a timer's callback, with anything it throws or rejects with handed to the failure
export const guard = (fn) => function (...args) {
    try {
        const result = fn.apply(this, args);
        if (result && typeof result.catch === "function") {
            result.catch(failScene);
        }
        return result;
    } catch (error) {
        failScene(error);
        return undefined;
    }
};

// gives back null once the scene has ended, without starting the interval
export const every = (fn, ms) => {
    if (signal.aborted) {
        return null;
    }
    const id = setInterval(guard(fn), ms);
    signal.addEventListener("abort", () => clearInterval(id));
    return id;
};
