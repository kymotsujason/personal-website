// the home screen's plain helpers, for the 3d screens (home.js) and the 2d screens. nothing here may reach three.js,
// since the 2d bundle imports it
import { cleanTitle } from "../musicInfo.js";

// a div or span acting as a button answers Enter and Space with the click it would get from a tap. like a button, Enter
// clicks on keydown and Space on keyup, and a held key doesn't repeat the click
const pressOnKey = (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || (event.key === " ") !== (event.type === "keyup")) {
        return;
    }
    event.currentTarget.click();
};

export const listenForPress = (el, accept = () => true) => {
    const press = (event) => accept(event) && pressOnKey(event);
    el.addEventListener("keydown", press);
    el.addEventListener("keyup", press);
};

// the time as the slider reads it aloud, as 1:05 of 3:20
export const clock = (seconds) => {
    const s = Math.max(Math.floor(seconds), 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// where a key on the music card's bar seeks to, as a share of the track before it's clamped, or undefined for a key
// the bar doesn't answer
export const seekFor = (key, at, duration) => ({
    ArrowRight: at + 5 / duration,
    ArrowUp: at + 5 / duration,
    ArrowLeft: at - 5 / duration,
    ArrowDown: at - 5 / duration,
    PageUp: at + 0.1,
    PageDown: at - 0.1,
    Home: 0,
    End: 1
})[key];

// what the music card shows for the player's state. the play button still asks again, as the music page's pill does
export const musicCard = ({ current, playing, unavailable, failed }) => {
    const down = unavailable || failed;
    const title = (current && cleanTitle(current.title)) || "Music";
    const channel = down ? "Music unavailable" : (current && current.channel) || "Songs I grew up on";
    return {
        title,
        channel,
        playing,
        down,
        art: current ? current.art : "",
        icon: playing ? "pause" : "play",
        label: down ? "Music unavailable" : playing ? "Pause" : "Play",
        shown: JSON.stringify([title, channel, playing, down, current ? current.art : ""])
    };
};

// the github widget's total under its title
export const githubTotal = (contributions) => (contributions ? `${contributions.total.toLocaleString("en-US")} in the last year` : "");

// a line marked .fit shrinks until it's one line in its box, down to 10px, since the card's width follows the screen's
// size and the font differs between systems. it's measured with the canvas font the screen is drawn with
const FIT_MIN = 10;
export const fitLines = (homeEl) => {
    const ctx = document.createElement("canvas").getContext("2d");
    homeEl.querySelectorAll(".wt.fit").forEach((el) => {
        el.style.fontSize = "";
        const cs = getComputedStyle(el);
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const width = ctx.measureText(el.textContent).width;
        if (width > el.clientWidth) {
            const size = Math.floor(((parseFloat(cs.fontSize) * el.clientWidth) / width) * 2) / 2;
            el.style.fontSize = `${Math.max(size, FIT_MIN)}px`;
        }
    });
};
