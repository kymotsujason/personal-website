const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// a day, or a time on that day with its offset, the way the ghost import writes a post's date
export const ISO_DATE =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

// a day as a date only form, the one a project's front matter uses
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// whether the text's first ten characters are a day on the calendar, so 2019-02-31 is refused
export const isRealDay = (text: string): boolean => {
  const [year, month, day] = text.slice(0, 10).split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  parsed.setUTCFullYear(year);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

// by the date's own text, the same text formatDay and postYear read, so a post written late on new year's eve in
// one zone can't sort as an instant into the next year's group
export const newestFirst = (a: string, b: string): number =>
  a < b ? 1 : a > b ? -1 : 0;

// reads the date's own first ten characters, so the time zone never shifts the day
export const formatDay = (date: string): string => {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
};

export const readingMinutes = (text: string): number => {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 230));
};
