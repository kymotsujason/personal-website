import { expect, test } from "vitest";
import { formatDay, readingMinutes } from "./format";

test("formatDay reads the day from the date's own text", () => {
  expect(formatDay("2020-01-01T17:56:51.000-08:00")).toBe("January 1, 2020");
  expect(formatDay("2026-10-12")).toBe("October 12, 2026");
});

test("readingMinutes rounds up and is at least one", () => {
  expect(
    readingMinutes("one two three four five six seven eight nine ten"),
  ).toBe(1);
  expect(readingMinutes(Array(1200).fill("word").join(" "))).toBe(6);
  expect(readingMinutes("")).toBe(1);
});
