import { parseRichText, type Inline } from "@/lib/rich-text";

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.type === "bold" ? (
          <strong key={i} className="font-semibold">{p.text}</strong>
        ) : p.type === "italic" ? (
          <em key={i} className="text-muted-foreground">{p.text}</em>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** Renders CFO answers as React elements (no HTML injection possible). */
export function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed">
      {parseRichText(text).map((block, i) =>
        block.type === "paragraph" ? (
          <p key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <InlineText parts={line} />
              </span>
            ))}
          </p>
        ) : block.ordered ? (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j}><InlineText parts={item} /></li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-accent-ink">
            {block.items.map((item, j) => (
              <li key={j}><InlineText parts={item} /></li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
