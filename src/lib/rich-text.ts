/**
 * Minimal, safe rich text for CFO answers: paragraphs, bullet/numbered lists, **bold**
 * and _italic_. Parsed into a tree rendered as React elements: never as HTML, so model
 * or bank text can't inject markup.
 */

export type Inline = { type: "text" | "bold" | "italic"; text: string };
export type Block =
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

const BULLET = /^\s*(?:[•\-*])\s+(.*)$/;
const NUMBERED = /^\s*\d{1,2}[.)]\s+(.*)$/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|(?<![\w])_([^_]+)_(?![\w])/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ type: "text", text: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { type: "bold", text: m[1] } : { type: "italic", text: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export function parseRichText(input: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of input.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = chunk.split("\n").filter((l) => l.trim() !== "");
    let paragraph: Inline[][] = [];
    let list: { ordered: boolean; items: Inline[][] } | null = null;
    const flushParagraph = () => {
      if (paragraph.length) blocks.push({ type: "paragraph", lines: paragraph });
      paragraph = [];
    };
    const flushList = () => {
      if (list) blocks.push({ type: "list", ...list });
      list = null;
    };
    for (const line of lines) {
      const bullet = BULLET.exec(line);
      const numbered = NUMBERED.exec(line);
      if (bullet || numbered) {
        flushParagraph();
        const ordered = Boolean(numbered && !bullet);
        if (!list || list.ordered !== ordered) {
          flushList();
          list = { ordered, items: [] };
        }
        list.items.push(parseInline((bullet ?? numbered)![1]));
      } else {
        flushList();
        paragraph.push(parseInline(line.trim()));
      }
    }
    flushParagraph();
    flushList();
  }
  return blocks;
}
