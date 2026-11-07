// the volume buttons' parts that need no three.js, shared by the 3d scene (scene/volume.js) and the 2d scene
// (flat/volume.js), so the two draw the same bar and agree on which button turns the volume up

// which button turns the volume up, by how the phone is held: the right one in landscape, and the upper one, nearer
// the hinge, in portrait
export const upButton = (portrait) => (portrait ? "near" : "far");

// the bar: a dark glass pill with the level filled in white and a speaker at its low end. drawn lying along the canvas,
// left to right, or standing, bottom to top
export const drawBar = (canvas, level, standing) => {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    if (standing) {
        // drawn lying down, then turned a quarter so it reads bottom to top
        ctx.translate(0, height);
        ctx.rotate(-Math.PI / 2);
    }
    const w = standing ? height : width;
    const h = standing ? width : height;
    const r = h / 2;
    ctx.fillStyle = "rgba(40, 40, 46, 0.72)";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
    ctx.fill();
    // the fill runs from just after the speaker to the far end
    const start = h * 1.05;
    const inset = h * 0.22;
    const track = w - start - inset;
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.beginPath();
    ctx.roundRect(start, inset, track, h - inset * 2, (h - inset * 2) / 2);
    ctx.fill();
    if (level > 0) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.roundRect(start, inset, Math.max(track * level, h - inset * 2), h - inset * 2, (h - inset * 2) / 2);
        ctx.fill();
    }
    ctx.restore();
    // the speaker, upright either way, with waves for how loud or a cross when silent. its spot at the low end, lying,
    // is turned the same quarter as the pill when standing
    const s = h * 0.17;
    const cx = standing ? h / 2 : h * 0.52;
    const cy = standing ? height - h * 0.52 : h / 2;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(cx - s * 1.2, cy - s * 0.55);
    ctx.lineTo(cx - s * 0.4, cy - s * 0.55);
    ctx.lineTo(cx + s * 0.5, cy - s * 1.3);
    ctx.lineTo(cx + s * 0.5, cy + s * 1.3);
    ctx.lineTo(cx - s * 0.4, cy + s * 0.55);
    ctx.lineTo(cx - s * 1.2, cy + s * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = h * 0.06;
    ctx.lineCap = "round";
    if (level <= 0) {
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.9, cy - s * 0.7);
        ctx.lineTo(cx + s * 2.1, cy + s * 0.7);
        ctx.moveTo(cx + s * 2.1, cy - s * 0.7);
        ctx.lineTo(cx + s * 0.9, cy + s * 0.7);
        ctx.stroke();
    } else {
        const waves = level > 0.66 ? 2 : 1;
        for (let i = 1; i <= waves; i++) {
            ctx.beginPath();
            ctx.arc(cx + s * 0.5, cy, s * (0.7 + i * 0.6), -Math.PI / 4, Math.PI / 4);
            ctx.stroke();
        }
    }
};
