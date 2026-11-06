import { expect, test } from "vitest";
import { readPost } from "../posts";

test("a post's single quoted title and CRLF lines read the way the build reads them", () => {
  const text =
    "---\r\ntitle: 'It''s here'\r\ndate: \"2018-11-14\"\r\nslug: here\r\n---\r\n\r\ntitle: not this one\r\n";
  expect(readPost(text)).toEqual({
    title: "It's here",
    date: "2018-11-14",
    slug: "here",
  });
});

test("a post missing a field is an error", () => {
  expect(() => readPost("---\ntitle: A\nslug: a\n---\n")).toThrow(/no date/);
});
