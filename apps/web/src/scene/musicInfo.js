// the small values the scene needs before the music player loads, so the player's own module can stay a later chunk

// the phone's volume buttons step a level from 0 to LEVEL_STEPS, as ios does. a track plays at its own volume at
// LEVEL_DEFAULT, scaled up or down from there, so the top step is twice as loud and 0 is silent
export const LEVEL_STEPS = 16;
export const LEVEL_DEFAULT = 8;
export const savedLevel = (storage) => {
    const n = Number(storage.getItem("volumeLevel"));
    return storage.getItem("volumeLevel") !== null && Number.isInteger(n) && n >= 0 && n <= LEVEL_STEPS ? n : LEVEL_DEFAULT;
};

export const artFor = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

// the end of an upload's title that's about the upload, not the song (" - English Subtitles", " - now on Amazon MP3")
const UPLOAD_NOTE = /\b(subtitles?|lyrics|now on|official|mp3)\b/i;

// a shorter title for the card: bracketed notes like (Official Video) and [HD] come off, and so does a trailing part
// about the upload. a title that's nothing but notes keeps its original text
export const cleanTitle = (title) => {
    const parts = title.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").split(" - ");
    if (parts.length > 1 && UPLOAD_NOTE.test(parts[parts.length - 1])) {
        parts.pop();
    }
    const short = parts.join(" - ").replace(/\s+/g, " ").trim();
    return short || title;
};
