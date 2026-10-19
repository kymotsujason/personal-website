import { expect, test } from "vitest";
import { describePost } from "./describe";

test("a post's description is its first paragraph as plain text", () => {
  const body =
    "The posts from the *old blog* are [coming](https://x.y) back.\n\nSecond.";
  expect(describePost(body, "T")).toBe(
    "The posts from the old blog are coming back.",
  );
});

test("headings, images, quotes, lists, code, and html are skipped", () => {
  const body = [
    "# Heading",
    "![alt](a.jpg)",
    "> quoted",
    "- item",
    "```\ncode\n```",
    "<figure>raw</figure>",
    "The real start.",
  ].join("\n\n");
  expect(describePost(body, "T")).toBe("The real start.");
});

test("a long paragraph is cut at a word and ends in three periods", () => {
  const text = describePost("word ".repeat(80).trim(), "T");
  expect(text.length).toBeLessThanOrEqual(160);
  expect(text.endsWith("word...")).toBe(true);
});

test("a post with no paragraph falls back to its title", () => {
  const fallback = "Hello, a post on Jason Yue's blog.";
  expect(describePost("![only](an.jpg)", "Hello")).toBe(fallback);
  expect(describePost(undefined, "Hello")).toBe(fallback);
});

test("an indented code block is skipped", () => {
  expect(describePost("    const a = 1;\n\nAfter the code.", "T")).toBe(
    "After the code.",
  );
  expect(describePost("\tcode\n\nAfter the code.", "T")).toBe(
    "After the code.",
  );
});

test("backslash escapes give the character they escape", () => {
  expect(describePost("A \\_literal\\_ and a \\# sign.", "T")).toBe(
    "A _literal_ and a # sign.",
  );
});

test("the common html entities are decoded", () => {
  expect(
    describePost("Tom &amp; Jerry say &quot;hi&quot; &lt;b&gt; it&#39;s", "T"),
  ).toBe('Tom & Jerry say "hi" <b> it\'s');
  expect(describePost("&amp;lt; stays text", "T")).toBe("&lt; stays text");
});

test("reference links keep their text and reference definitions are skipped", () => {
  expect(describePost("[the site][home] and [this][] too.", "T")).toBe(
    "the site and this too.",
  );
  expect(describePost("Text ![logo][img] then more.", "T")).toBe(
    "Text then more.",
  );
  expect(describePost("[home]: https://jasonyue.ca\n\nReal text.", "T")).toBe(
    "Real text.",
  );
});

test("emphasis marks wrapping a word go and underscores inside words stay", () => {
  expect(
    describePost("Use **snake_case** and _italic_ and *this* names.", "T"),
  ).toBe("Use snake_case and italic and this names.");
  expect(describePost("The my_var_name and 2 * 3 * 4 stay.", "T")).toBe(
    "The my_var_name and 2 * 3 * 4 stay.",
  );
});
