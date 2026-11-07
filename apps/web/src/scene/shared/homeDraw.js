// the home screen drawn into a 2d canvas from its live html layout, for the 3d screens' textures and the 2d screens'
// picture while the phone moves. nothing here may reach three.js, since the 2d bundle imports it

// position of an element inside `root`, from layout offsets, so css transforms on root don't matter
const offsetIn = (el, root) => {
    let x = 0;
    let y = 0;
    let node = el;
    while (node && node !== root) {
        x += node.offsetLeft;
        y += node.offsetTop;
        node = node.offsetParent;
    }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
};

// the tapped icon's glyph box in home screen px, where the ios style app window grows from and shrinks back to
export const glyphRect = (homeEl, name) => {
    const button = [...homeEl.querySelectorAll(".app-icon")].find((b) => b.textContent.trim().endsWith(name));
    const glyph = button.querySelector(".glyph");
    const box = offsetIn(glyph, homeEl);
    return { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h, radius: parseFloat(getComputedStyle(glyph).borderTopLeftRadius) };
};

export const roundedRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
};

// css linear-gradient(angle) as a canvas gradient over a w x h box
const cssGradient = (ctx, w, h, angleDeg, stops) => {
    const a = angleDeg * (Math.PI / 180);
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
    const g = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
    stops.forEach(([at, color]) => g.addColorStop(at, color));
    return g;
};

const fontOf = (el) => {
    const cs = getComputedStyle(el);
    return `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
};

// ios style wifi fan: three arcs over a dot, the ones past the signal level dimmed, and a slash when offline
const drawWifi = (ctx, box, bars) => {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h - 1;
    const step = box.h / 3.4;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineCap = "round";
    ctx.lineWidth = step * 0.62;
    for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = i < bars ? 1 : 0.32;
        ctx.beginPath();
        if (i === 0) {
            ctx.arc(cx, cy - step * 0.3, step * 0.38, 0, Math.PI * 2);
            ctx.fill();
            continue;
        }
        ctx.arc(cx, cy, step * (i + 0.55), Math.PI * 1.25, Math.PI * 1.75);
        ctx.stroke();
    }
    // the dot counts as the first bar, so 1 bar lights the dot, 3 lights everything
    if (bars === 0) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(box.x + 1, box.y);
        ctx.lineTo(box.x + box.w - 1, box.y + box.h);
        ctx.stroke();
    }
    ctx.restore();
};

const drawBolt = (ctx, x, y, h) => {
    ctx.beginPath();
    ctx.moveTo(x + h * 0.34, y);
    ctx.lineTo(x, y + h * 0.56);
    ctx.lineTo(x + h * 0.26, y + h * 0.56);
    ctx.lineTo(x + h * 0.16, y + h);
    ctx.lineTo(x + h * 0.5, y + h * 0.42);
    ctx.lineTo(x + h * 0.24, y + h * 0.42);
    ctx.closePath();
    ctx.fill();
};

// ios style battery: the level as a fill inside a dim body, the percent written over it, red when low. charging, the
// fill turns green and a small bolt sits inside the battery next to the number, the way ios draws it
const drawBattery = (ctx, box, el) => {
    const level = Number(el.dataset.level);
    const charging = el.dataset.charging === "true" && level < 100;
    const bodyW = box.w - 3;
    const r = box.h * 0.32;
    ctx.save();
    ctx.globalAlpha = 0.38;
    roundedRect(ctx, box.x, box.y, bodyW, box.h, r);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(box.x + bodyW + 1, box.y + box.h * 0.32, 2, box.h * 0.36, 1);
    ctx.fill();
    ctx.globalAlpha = 1;
    const low = level <= 20 && !charging;
    ctx.fillStyle = charging ? "#34c759" : low ? "#ff3b30" : "#fff";
    ctx.save();
    roundedRect(ctx, box.x, box.y, bodyW, box.h, r);
    ctx.clip();
    ctx.fillRect(box.x, box.y, (bodyW * level) / 100, box.h);
    ctx.restore();
    ctx.fillStyle = charging || low ? "#fff" : "#000";
    ctx.font = fontOf(el);
    ctx.textAlign = "left";
    const text = String(level);
    const textW = ctx.measureText(text).width;
    const boltH = box.h * 0.62;
    const boltW = boltH * 0.5;
    const gap = charging ? 1 : 0;
    const total = textW + (charging ? gap + boltW : 0);
    const x0 = box.x + (bodyW - total) / 2;
    ctx.fillText(text, x0, box.y + box.h / 2 + 0.5);
    if (charging) {
        drawBolt(ctx, x0 + textW + gap, box.y + (box.h - boltH) / 2, boltH);
    }
    ctx.restore();
};

const drawStatus = (ctx, rootEl) => {
    ctx.fillStyle = "#fff";
    const time = rootEl.querySelector(".status .time");
    const t = offsetIn(time, rootEl);
    ctx.font = fontOf(time);
    ctx.textAlign = "left";
    ctx.fillText(time.textContent, t.x, t.y + t.h / 2);
    const wifi = rootEl.querySelector(".status .wifi");
    drawWifi(ctx, offsetIn(wifi, rootEl), Number(wifi.dataset.bars));
    const battery = rootEl.querySelector(".status .battery");
    drawBattery(ctx, offsetIn(battery, rootEl), battery);
};

// the home screen drawn from the live html layout, so the texture and the invisible clickable html line up exactly
// a text line, wrapped to its box the way the html laid it out when it's marked .wrap
const drawText = (ctx, el, homeEl) => {
    const box = offsetIn(el, homeEl);
    const cs = getComputedStyle(el);
    ctx.save();
    ctx.globalAlpha = Number(cs.opacity);
    ctx.fillStyle = cs.color;
    ctx.font = fontOf(el);
    ctx.textAlign = "left";
    if (!el.classList.contains("wrap")) {
        ctx.fillText(el.textContent, box.x, box.y + box.h / 2 + 1);
        ctx.restore();
        return;
    }
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    const lines = [];
    let line = "";
    el.textContent.split(" ").forEach((word) => {
        const next = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(next).width > box.w) {
            lines.push(line);
            line = word;
        } else {
            line = next;
        }
    });
    lines.push(line);
    // data-lines caps the lines like css line clamping, and a line that still doesn't fit ends in three periods
    const max = Number(el.dataset.lines) || lines.length;
    const shown = lines.slice(0, max);
    shown.forEach((text, i) => {
        let fitted = text;
        const cut = i === max - 1 && lines.length > max;
        if (cut || ctx.measureText(fitted).width > box.w) {
            while (fitted && ctx.measureText(`${fitted}...`).width > box.w) {
                fitted = fitted.slice(0, -1);
            }
            fitted = `${fitted.trimEnd()}...`;
        }
        ctx.fillText(fitted, box.x, box.y + lineHeight * (i + 0.5) + 1);
    });
    ctx.restore();
};

// the music card's buttons as shapes: play, pause, and skip to the next or previous track
const drawControl = (ctx, box, icon) => {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const s = Math.min(box.w, box.h) * 0.36;
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    if (icon === "pause") {
        ctx.rect(cx - s * 0.75, cy - s, s * 0.5, s * 2);
        ctx.rect(cx + s * 0.25, cy - s, s * 0.5, s * 2);
    } else if (icon === "previous") {
        ctx.moveTo(cx + s, cy - s);
        ctx.lineTo(cx - s * 0.4, cy);
        ctx.lineTo(cx + s, cy + s);
        ctx.closePath();
        ctx.rect(cx - s * 0.9, cy - s, s * 0.4, s * 2);
    } else if (icon === "next") {
        ctx.moveTo(cx - s, cy - s);
        ctx.lineTo(cx + s * 0.4, cy);
        ctx.lineTo(cx - s, cy + s);
        ctx.closePath();
        ctx.rect(cx + s * 0.5, cy - s, s * 0.4, s * 2);
    } else {
        ctx.moveTo(cx - s * 0.7, cy - s);
        ctx.lineTo(cx + s, cy);
        ctx.lineTo(cx - s * 0.7, cy + s);
        ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
};

// a pair of beamed eighth notes on a faint tile, drawn as shapes so it doesn't hang on a font having the glyph
const drawArtPlaceholder = (ctx, ink, box) => {
    ctx.save();
    roundedRect(ctx, box.x, box.y, box.w, box.h, 10);
    ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
    ctx.fill();
    ctx.restore();
    const { x, y, w, h } = box;
    const stem = w * 0.035;
    const heads = [[0.38, 0.68], [0.66, 0.62]];
    ink.save();
    ink.fillStyle = "#fff";
    heads.forEach(([hx, hy]) => {
        ink.beginPath();
        ink.ellipse(x + w * hx, y + h * hy, w * 0.085, h * 0.065, -0.4, 0, Math.PI * 2);
        ink.fill();
        ink.fillRect(x + w * (hx + 0.085) - stem, y + h * (hy - 0.4), stem, h * 0.4);
    });
    ink.beginPath();
    ink.moveTo(x + w * 0.465 - stem, y + h * 0.28);
    ink.lineTo(x + w * 0.745, y + h * 0.22);
    ink.lineTo(x + w * 0.745, y + h * 0.3);
    ink.lineTo(x + w * 0.465 - stem, y + h * 0.36);
    ink.closePath();
    ink.fill();
    ink.restore();
};

// ios style widgets: the avatar (a png drawn with its own transparency), the album art, and a contribution graph on
// the base layer, and their text and buttons on the ink layer, all placed by the html layout. the cards under them
// aren't drawn here, they're frosted glass in the composite (composite.js)
const drawWidgets = (ctx, ink, homeEl) => {
    homeEl.querySelectorAll(".widget img.avatar").forEach((img) => {
        const box = offsetIn(img, homeEl);
        if (img.complete && img.naturalWidth) {
            ctx.drawImage(img, box.x, box.y, box.w, box.h);
        }
    });
    // the album art is youtube's 4:3 thumbnail with the 16:9 video letterboxed in its middle, so a square is cut from
    // the middle of the video and drawn with rounded corners
    // until the thumbnail has loaded (home.js sets its address from the track list) a plain tile with a note stands in
    homeEl.querySelectorAll(".widget img.art").forEach((img) => {
        const box = offsetIn(img, homeEl);
        if (!img.complete || !img.naturalWidth) {
            drawArtPlaceholder(ctx, ink, box);
            return;
        }
        const side = (img.naturalWidth * 9) / 16;
        ctx.save();
        roundedRect(ctx, box.x, box.y, box.w, box.h, 10);
        ctx.clip();
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, box.x, box.y, box.w, box.h);
        ctx.restore();
    });
    homeEl.querySelectorAll(".widget .ctl").forEach((el) => drawControl(ink, offsetIn(el, homeEl), el.dataset.icon));
    homeEl.querySelectorAll(".widget .graph span").forEach((cell) => {
        const box = offsetIn(cell, homeEl);
        roundedRect(ctx, box.x, box.y, box.w, box.h, 2);
        ctx.fillStyle = cell.style.background;
        ctx.fill();
    });
    homeEl.querySelectorAll(".widget .wt").forEach((el) => drawText(ink, el, homeEl));
};

// the box of any element inside a home screen, in its px, for the app window to grow out of (an icon or a widget)
export const elementRect = (homeEl, el) => {
    const box = offsetIn(el, homeEl);
    return { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) };
};

const WALLPAPER_STOPS = [[0, "#2b3a67"], [0.45, "#5b4b8a"], [1, "#e07a5f"]];

// the old fixed wallpaper alone, a w x h canvas at scale. the composite check compares against it
export const drawGradient = (w, h, scale) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = cssGradient(ctx, w, h, 160, WALLPAPER_STOPS);
    ctx.fillRect(0, 0, w, h);
    return canvas;
};

// the old wallpaper is one gradient over the whole open inner screen. frame says where that screen sits in this
// element's px, so the cover can draw just the part of it that lies under the cover when closed. with wallpaper off,
// the canvas stays clear behind the icons, for the composite to lay over the weather sky
//
// it's two layers. the base holds what keeps its colors (the icons, the art, the graph), and the ink holds the white
// text, the buttons, and the status bar, which the composite turns dark wherever the sky behind them is bright
const layerCanvas = (w, h, scale) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    return { canvas, ctx };
};

export const drawHome = (homeEl, scale, frame = null, withStatus = true, wallpaper = true) => {
    const w = homeEl.offsetWidth;
    const h = homeEl.offsetHeight;
    const wall = frame || { x: 0, y: 0, w, h };
    const { canvas, ctx } = layerCanvas(w, h, scale);
    const { canvas: inkCanvas, ctx: ink } = layerCanvas(w, h, scale);

    if (wallpaper) {
        ctx.save();
        ctx.translate(wall.x, wall.y);
        ctx.fillStyle = cssGradient(ctx, wall.w, wall.h, 160, WALLPAPER_STOPS);
        ctx.fillRect(-wall.x, -wall.y, w, h);
        ctx.restore();
    }
    drawWidgets(ctx, ink, homeEl);

    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    if (withStatus) {
        drawStatus(ink, homeEl);
    }

    homeEl.querySelectorAll(".app-icon").forEach((button) => {
        const glyph = button.querySelector(".glyph");
        const label = button.querySelector("span:not(.glyph)");
        const g = offsetIn(glyph, homeEl);
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 4;
        roundedRect(ctx, g.x, g.y, g.w, g.h, parseFloat(getComputedStyle(glyph).borderTopLeftRadius));
        ctx.fillStyle = getComputedStyle(glyph).backgroundColor;
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "#fff";
        ctx.font = fontOf(glyph);
        ctx.textAlign = "center";
        ctx.fillText(glyph.textContent, g.x + g.w / 2, g.y + g.h / 2 + 1);
        const l = offsetIn(label, homeEl);
        // a soft shadow keeps the labels readable over a bright sky, as ios does. it goes on the base layer on its
        // own: the text is drawn far off the canvas with its shadow thrown back to where the label is
        ctx.save();
        ctx.font = fontOf(label);
        ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
        ctx.shadowBlur = 4;
        // shadow offsets are in canvas px, past the scale the rest is drawn at
        ctx.shadowOffsetX = SHADOW_THROW * scale;
        ctx.shadowOffsetY = 1;
        ctx.fillText(label.textContent, l.x + l.w / 2 - SHADOW_THROW, l.y + l.h / 2);
        ctx.restore();
        ink.font = fontOf(label);
        ink.textAlign = "center";
        ink.fillText(label.textContent, l.x + l.w / 2, l.y + l.h / 2);
    });
    homeEl.querySelectorAll(".credit").forEach((el) => drawText(ink, el, homeEl));
    drawFocusRing(ink, homeEl);
    return { base: canvas, ink: inkCanvas };
};

// the html over the screen is invisible, so a keyboard focus is shown as a ring on the ink layer, which the composite
// turns dark over a bright sky like the rest of the white ink. a mouse tap leaves no ring, since :focus-visible skips it
const drawFocusRing = (ink, homeEl) => {
    const focused = document.activeElement;
    if (!focused || focused === homeEl || !homeEl.contains(focused) || !focused.matches(":focus-visible")) {
        return;
    }
    const box = offsetIn(focused, homeEl);
    const pad = 3;
    ink.save();
    ink.lineWidth = 3;
    ink.strokeStyle = "#fff";
    roundedRect(ink, box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2, 12);
    ink.stroke();
    ink.restore();
};

// how far off the canvas a label is drawn to throw only its shadow onto it
const SHADOW_THROW = 10000;

const clock = (seconds) => {
    const s = Math.max(Math.floor(seconds), 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// the music card's bar, filled as far as data-at says, with the time so far and the time left under it, the way ios
// draws its now playing bar. it thickens while it's dragged
export const drawProgress = (ctx, el, homeEl) => {
    const box = offsetIn(el, homeEl);
    const at = Number(el.dataset.at) || 0;
    const duration = Number(el.dataset.duration) || 0;
    const thick = el.dataset.dragging === "true" ? 8 : 4;
    const y = box.y + (box.h - thick) / 2;
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    roundedRect(ctx, box.x, y, box.w, thick, thick / 2);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#fff";
    ctx.fillRect(box.x, y, box.w * at, thick);
    ctx.restore();
    if (duration > 0) {
        const time = Number(el.dataset.time) || 0;
        ctx.font = `600 10px ${getComputedStyle(el).fontFamily}`;
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.fillText(clock(time), box.x, box.y + box.h);
        ctx.textAlign = "right";
        ctx.fillText(`-${clock(duration - time)}`, box.x + box.w, box.y + box.h);
    }
    ctx.restore();
};

// copies a box of base (in the home screen's px, plus a margin) back over canvas, clearing what was drawn there
const restoreBox = (ctx, canvas, base, x, y, w, h, scale) => {
    const x0 = Math.max(Math.floor(x * scale), 0);
    const y0 = Math.max(Math.floor(y * scale), 0);
    const x1 = Math.min(Math.ceil((x + w) * scale), canvas.width);
    const y1 = Math.min(Math.ceil((y + h) * scale), canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    ctx.drawImage(base, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
};

// redraws only the live parts of a home screen's ink layer (the status bar and the music card's bar), from `base` (the
// same ink drawn without them), so a clock tick or a moving bar doesn't lay out and paint the whole screen again
export const redrawStatus = (canvas, base, homeEl, scale) => {
    const ctx = canvas.getContext("2d");
    const bar = offsetIn(homeEl.querySelector(".status"), homeEl);
    restoreBox(ctx, canvas, base, 0, bar.y - 4, canvas.width / scale, bar.h + 8, scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    drawStatus(ctx, homeEl);
    homeEl.querySelectorAll(".m-progress").forEach((el) => {
        const box = offsetIn(el, homeEl);
        restoreBox(ctx, canvas, base, box.x - 4, box.y - 2, box.w + 8, box.h + 18, scale);
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        drawProgress(ctx, el, homeEl);
    });
};
