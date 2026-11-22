import { Fragment, type ReactNode } from "react";

import { openExternalUrl } from "@/platform/open-external";

function isSafeExternalHref(href: string): boolean {
  const trimmed = href.trim();
  return /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed);
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  // Matches `[label](url)`, `` `code` ``, `**bold**`, or `*italic*`.
  const pattern =
    /(\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-${index++}`;
    if (match[2] !== undefined && match[3] !== undefined) {
      const label = match[2];
      const href = match[3];
      if (isSafeExternalHref(href)) {
        tokens.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-text underline underline-offset-2 hover:text-brand"
            onClick={(event) => {
              event.preventDefault();
              void openExternalUrl(href);
            }}
          >
            {label}
          </a>,
        );
      } else {
        tokens.push(label);
      }
    } else if (match[4] !== undefined) {
      tokens.push(
        <code
          key={key}
          className="rounded bg-inset px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {match[4]}
        </code>,
      );
    } else if (match[5] !== undefined) {
      tokens.push(
        <strong key={key} className="font-semibold text-foreground">
          {match[5]}
        </strong>,
      );
    } else if (match[6] !== undefined) {
      tokens.push(<em key={key}>{match[6]}</em>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens;
}

/**
 * Lightweight safe Markdown renderer for announcement detail drawers.
 * Renders React elements directly (zero raw HTML injection) and routes external
 * links through the host platform bridge (`openExternalUrl`).
 */
export function NotificationMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre
          key={`code-${i}`}
          className="overflow-x-auto rounded-lg border border-border bg-inset p-3 font-mono text-xs leading-relaxed text-foreground"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const body = renderInline(heading[2].trim(), `h-${i}`);
      blocks.push(
        level === 1 ? (
          <h3
            key={`h-${i}`}
            className="text-base font-semibold tracking-tight text-foreground"
          >
            {body}
          </h3>
        ) : level === 2 ? (
          <h4
            key={`h-${i}`}
            className="text-sm font-semibold tracking-tight text-foreground"
          >
            {body}
          </h4>
        ) : (
          <h5 key={`h-${i}`} className="text-sm font-medium text-foreground">
            {body}
          </h5>
        ),
      );
      i += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`q-${i}`}
          className="border-s-2 border-brand/60 ps-3 text-sm leading-relaxed text-muted-foreground"
        >
          {quoteLines.map((qLine, qi) => (
            <p key={qi}>{renderInline(qLine, `q-${i}-${qi}`)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul
          key={`ul-${i}`}
          className="list-disc space-y-1 ps-5 text-sm leading-relaxed text-foreground/90"
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ul-${i}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol
          key={`ol-${i}`}
          className="list-decimal space-y-1 ps-5 text-sm leading-relaxed text-foreground/90"
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ol-${i}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3}\s|```|>|[-*]\s|\d+\.\s)/.test(lines[i])
    ) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p
        key={`p-${i}`}
        className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap"
      >
        {paragraphLines.map((pLine, idx) => (
          <Fragment key={idx}>
            {idx > 0 && "\n"}
            {renderInline(pLine, `p-${i}-${idx}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="space-y-3">{blocks}</div>;
}
