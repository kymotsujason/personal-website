const LIMIT = 160;

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&amp;": "&",
};

// a post has no summary, so its card shows the start of its first paragraph as plain text
export function describePost(body: string | undefined, title: string): string {
  for (const block of (body ?? "").split(/\n\s*\n/)) {
    if (/^( {4}|\t)/.test(block)) {
      continue;
    }
    const trimmed = block.trim();
    if (
      /^(#|>|[-*+]\s|\d+[.)]\s|```|~~~|\||<|!\[|---|\[[^\]]+\]:\s)/.test(
        trimmed,
      )
    ) {
      continue;
    }
    // escapes and entities are decoded last, so the text they spell isn't taken for markup
    const text = trimmed
      .replace(/!\[[^\]]*\](\([^)]*\)|\[[^\]]*\])/g, "")
      .replace(/\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/(^|[^\w\\])([*_]{1,3})(?=\S)(.*?\S)\2(?![\w])/g, "$1$3")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, "$1")
      .replace(/&(lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity])
      .replace(/\s+/g, " ")
      .trim();
    if (text === "") {
      continue;
    }
    if (text.length <= LIMIT) {
      return text;
    }
    const cut = text.slice(0, LIMIT - 3);
    const space = cut.lastIndexOf(" ");
    return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, "")}...`;
  }
  return `${title}, a post on Jason Yue's blog.`;
}
