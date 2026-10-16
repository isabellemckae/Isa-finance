import { describe, expect, it } from "vitest";
import { parseInline, parseRichText } from "./rich-text";

describe("parseRichText", () => {
  it("parses paragraphs, bullets, numbered lists, bold and italic", () => {
    expect(parseRichText("You can spend **$310.00**.\n\n• Bills: $75.99\n- Buffer\n\n1. One\n2. Two\n\n_Estimate._")).toEqual([
      { type: "paragraph", lines: [[{ type: "text", text: "You can spend " }, { type: "bold", text: "$310.00" }, { type: "text", text: "." }]] },
      { type: "list", ordered: false, items: [[{ type: "text", text: "Bills: $75.99" }], [{ type: "text", text: "Buffer" }]] },
      { type: "list", ordered: true, items: [[{ type: "text", text: "One" }], [{ type: "text", text: "Two" }]] },
      { type: "paragraph", lines: [[{ type: "italic", text: "Estimate." }]] },
    ]);
  });

  it("keeps HTML as plain text and ignores underscores inside words", () => {
    expect(parseInline("<img src=x onerror=alert(1)> snake_case_name")).toEqual([
      { type: "text", text: "<img src=x onerror=alert(1)> snake_case_name" },
    ]);
  });
});
