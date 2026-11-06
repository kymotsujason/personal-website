import { expect, test } from "vitest";
import { firstParagraph, parseEntry } from "../projects";

const source = (eol: string, body: string) =>
  [
    "---",
    "title: Sample",
    "rank: 1",
    "links:",
    "  - label: Repo",
    "    url: https://example.com",
    "---",
    "",
    body,
  ].join(eol);

test("a code span keeps its underscores in the first paragraph", async () => {
  const e = await parseEntry(
    "a.md",
    source("\n", "It reads `frame_id` and snake_case_word.\n\nSecond."),
  );
  expect(firstParagraph(e)).toBe("It reads frame_id and snake_case_word.");
});

test("emphasis, links, and entities come out as the page's text", async () => {
  const e = await parseEntry(
    "a.md",
    source(
      "\n",
      "A *bold* claim, a [link](https://example.com), and R&amp;D.\n\nSecond.",
    ),
  );
  expect(firstParagraph(e)).toBe("A bold claim, a link, and R&D.");
});

test("a CRLF entry still has its frontmatter and body", async () => {
  const e = await parseEntry(
    "a.md",
    source("\r\n", "Words here.\r\n\r\nSecond."),
  );
  expect(e.data.title).toBe("Sample");
  expect(e.data.links).toEqual([{ label: "Repo", url: "https://example.com" }]);
  expect(firstParagraph(e)).toBe("Words here.");
});

test("an entry with no frontmatter is an error", async () => {
  await expect(parseEntry("a.md", "Just words.")).rejects.toThrow(
    /no frontmatter/,
  );
});

test("a link title with a greater-than sign stays out of the first paragraph's text", async () => {
  const e = await parseEntry(
    "a.md",
    source(
      "\n",
      'A [fast](https://example.com "Frames > 30") camera.\n\nSecond.',
    ),
  );
  expect(firstParagraph(e)).toBe("A fast camera.");
});

test("a code block before the first paragraph is not the first paragraph", async () => {
  const e = await parseEntry(
    "a.md",
    source("\n", "```\nsome code\n```\n\nReal words.\n\nSecond."),
  );
  expect(firstParagraph(e)).toBe("Real words.");
});

test("a quoted paragraph is not a top level paragraph", async () => {
  const e = await parseEntry(
    "a.md",
    source("\n", "> A quote.\n\nReal words.\n\nSecond."),
  );
  expect(firstParagraph(e)).toBe("Real words.");
});
