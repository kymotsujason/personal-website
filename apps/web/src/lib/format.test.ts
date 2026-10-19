import { expect, test } from "vitest";
import { formatDay, isRealDay, newestFirst, readingMinutes } from "./format";

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

test("newestFirst orders dates by their own text, newest first", () => {
  const dates = [
    "2019-06-01",
    "2020-01-01T03:00:00.000Z",
    "2019-12-31T23:00:00.000-08:00",
    "2019-06-01T09:00:00.000-07:00",
  ];
  expect([...dates].sort(newestFirst)).toEqual([
    "2020-01-01T03:00:00.000Z",
    "2019-12-31T23:00:00.000-08:00",
    "2019-06-01T09:00:00.000-07:00",
    "2019-06-01",
  ]);
});

test("isRealDay checks the day against the calendar", () => {
  expect(isRealDay("2024-02-29")).toBe(true);
  expect(isRealDay("2019-11-01T18:25:00.000-07:00")).toBe(true);
  expect(isRealDay("2019-02-31")).toBe(false);
  expect(isRealDay("2019-02-29")).toBe(false);
  expect(isRealDay("2026-13-01")).toBe(false);
  expect(isRealDay("0000-01-01")).toBe(true);
});
