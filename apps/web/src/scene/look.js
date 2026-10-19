import * as THREE from "three";
import { state } from "./state.js";
import { backdrop } from "./renderer.js";
import { gesture, phoneEdges, blockNextClick } from "./fold.js";
import { signal, guard } from "./lifetime.js";

// with the phone closed, dragging anywhere but the phone's border looks around the desk. the desk moves with the
// pointer, like grabbing it, and a press that doesn't move still taps through to the cover's icons
let lookDrag = null;
const LOOK_SLOP = 6;
const onPhone = (x, y) => {
    const { outer } = phoneEdges();
    return x >= outer.left && x <= outer.right && y >= outer.top && y <= outer.bottom;
};
const endLook = guard((event) => {
    if (!lookDrag || event.pointerId !== lookDrag.id) {
        return;
    }
    if (lookDrag.moved) {
        blockNextClick();
    }
    lookDrag = null;
    document.body.classList.remove("looking");
});

// with the phone closed, the hands move it out of the way of the mouse, since where the cursor is over the desk is
// likely where the visitor is looking. the move grows with how far the cursor is from the phone's resting spot, so
// it's nothing while the cursor is on the phone and it can't chase itself as the phone moves
const AVOID_GAIN = 0.45;
const AVOID_MAX = 0.16;      // of the window's smaller side
export const avoid = { tx: 0, ty: 0, x: 0, y: 0 };

export const installLook = () => {
    addEventListener("pointerdown", guard((event) => {
        // a press on the phone is for the phone (its cover icons, or the border swipe), only the background drags the view
        if (gesture || state.busy || state.phone !== "closed" || onPhone(event.clientX, event.clientY)) {
            return;
        }
        lookDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    }), { capture: true, signal });
    addEventListener("pointermove", guard((event) => {
        if (!lookDrag || event.pointerId !== lookDrag.id) {
            return;
        }
        const dx = event.clientX - lookDrag.x;
        const dy = event.clientY - lookDrag.y;
        if (!lookDrag.moved && Math.hypot(dx, dy) < LOOK_SLOP) {
            return;
        }
        lookDrag.moved = true;
        document.body.classList.add("looking");
        const degPerPx = backdrop.camera.fov / innerHeight;
        backdrop.lookBy(-dx * degPerPx, dy * degPerPx);
        lookDrag.x = event.clientX;
        lookDrag.y = event.clientY;
        event.preventDefault();
    }), { capture: true, passive: false, signal });
    addEventListener("pointerup", endLook, { capture: true, signal });

    addEventListener("pointermove", guard((event) => {
        if (event.pointerType !== "mouse" || state.phone !== "closed" || state.busy || (lookDrag && lookDrag.moved)) {
            return;
        }
        const { outer } = phoneEdges();
        // the grab cursor only over the desk, since a press on the phone doesn't drag the view
        const overPhone = event.clientX >= outer.left && event.clientX <= outer.right && event.clientY >= outer.top && event.clientY <= outer.bottom;
        if (overPhone !== document.body.classList.contains("over-phone")) {
            document.body.classList.toggle("over-phone", overPhone);
        }
        // where the phone would be without the current move
        const left = outer.left - avoid.x;
        const right = outer.right - avoid.x;
        const top = outer.top - avoid.y;
        const bottom = outer.bottom - avoid.y;
        const dx = event.clientX - THREE.MathUtils.clamp(event.clientX, left, right);
        const dy = event.clientY - THREE.MathUtils.clamp(event.clientY, top, bottom);
        let tx = -dx * AVOID_GAIN;
        let ty = -dy * AVOID_GAIN;
        const cap = AVOID_MAX * Math.min(innerWidth, innerHeight);
        const len = Math.hypot(tx, ty);
        if (len > cap) {
            tx *= cap / len;
            ty *= cap / len;
        }
        avoid.tx = tx;
        avoid.ty = ty;
    }), { signal });
    document.documentElement.addEventListener("mouseleave", guard(() => {
        avoid.tx = 0;
        avoid.ty = 0;
    }), { signal });
    addEventListener("pointercancel", endLook, { capture: true, signal });
};
