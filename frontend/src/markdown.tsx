import React, { useEffect, useState } from 'react';

/**
 * Render inline Markdown tokens (bold, italic, inline code, links) as safe React nodes.
 * Handles unclosed delimiters gracefully during mid-stream rendering.
 */
export function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*\n]+?\*\*|\*\*[^*\n]+$|`[^`\n]+?`|`[^`\n]+$|\*[^*\n]+?\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(pattern)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      nodes.push(text.slice(lastIndex, idx));
    }
    const token = match[0];
    if (token.startsWith('**')) {
      const inner = token.endsWith('**') && token.length > 4 ? token.slice(2, -2) : token.slice(2);
      nodes.push(<strong key={`b-${key++}`}>{inner}</strong>);
    } else if (token.startsWith('`')) {
      const inner = token.endsWith('`') && token.length > 2 ? token.slice(1, -1) : token.slice(1);
      nodes.push(<code key={`c-${key++}`} className="md-code">{inner}</code>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={`i-${key++}`}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('[')) {
      const label = match[2] ?? token;
      const href = match[3] ?? '#';
      nodes.push(
        <a key={`a-${key++}`} href={href} target="_blank" rel="noopener noreferrer" className="md-link">
          {label}
        </a>,
      );
    }
    lastIndex = idx + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes.length ? nodes : [text];
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.includes('|');
}

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return /^\|(?:\s*:?-{2,}:?\s*\|)+$/.test(t);
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
}

/**
 * Render Markdown text into structured React elements (headings, lists, tables, code blocks, quotes, paragraphs).
 */
export function renderMarkdownBlocks(text: string): React.ReactNode {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre key={`pre-${key++}`} className="md-pre">
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${key++}`} className="md-hr" />);
      i += 1;
      continue;
    }

    // Headings (# to ####)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = renderInlineMarkdown(headingMatch[2]);
      blocks.push(
        <div key={`h-${key++}`} className={`md-h md-h${level}`}>
          {content}
        </div>,
      );
      i += 1;
      continue;
    }

    // Markdown table
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseTableCells(trimmed);
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        bodyRows.push(parseTableCells(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={`tbl-${key++}`} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {headers.map((h, idx) => (
                  <th key={idx}>{renderInlineMarkdown(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {headers.map((_, cIdx) => (
                    <td key={cIdx}>{renderInlineMarkdown(row[cIdx] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2));
        i += 1;
      }
      blocks.push(
        <blockquote key={`bq-${key++}`} className="md-quote">
          {quoteLines.map((ql, idx) => (
            <p key={idx} className="md-p">{renderInlineMarkdown(ql)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // Unordered list (-, *, •)
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${key++}`} className="md-list">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list (1. 2. ...)
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${key++}`} className="md-list md-ol">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Regular paragraph (preserve consecutive soft lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !/^#{1,4}\s+/.test(lines[i].trim()) &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('> ') &&
      !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p-${key++}`} className="md-p">
        {paraLines.map((pl, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInlineMarkdown(pl)}
          </React.Fragment>
        ))}
      </p>,
    );
  }

  return <div className="md-content">{blocks}</div>;
}

/**
 * Progressive word-by-word streaming Markdown renderer for chat simulator bubbles.
 */
export function StreamingMarkdown({
  text,
  animate = false,
  onStreamTick,
}: {
  text: string;
  animate?: boolean;
  onStreamTick?: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(() => (animate ? 0 : text.length));

  useEffect(() => {
    if (!animate) {
      setVisibleCount(text.length);
      return;
    }
    setVisibleCount(0);
    if (!text.length) return;

    let current = 0;
    const stepSize = Math.max(8, Math.min(24, Math.ceil(text.length / 45)));
    const timer = window.setInterval(() => {
      let next = Math.min(text.length, current + stepSize);
      // Advance to the next word boundary so words don't split mid-character.
      while (next < text.length && !/\s/.test(text[next])) {
        next += 1;
      }
      current = next;
      setVisibleCount(current);
      onStreamTick?.();
      if (current >= text.length) {
        window.clearInterval(timer);
      }
    }, 22);

    return () => window.clearInterval(timer);
  }, [text, animate]);

  const isStreaming = animate && visibleCount < text.length;
  const displayed = isStreaming ? text.slice(0, visibleCount) : text;

  return (
    <div className="md-stream-wrap">
      {renderMarkdownBlocks(displayed)}
      {isStreaming && <span className="md-cursor" aria-hidden="true">▍</span>}
    </div>
  );
}
