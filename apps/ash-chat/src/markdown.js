const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);

function unescapeMarkdownLine(line) {
  const parts = String(line).split(/(`[^`\n]+`)/);
  return parts.map((part, index) => {
    if (index % 2 === 1) return part;
    const math = [];
    const held = part.replace(/\\\((?:[\s\S]*?)\\\)|\\\[(?:[\s\S]*?)\\\]/g, (match) => {
      math.push(match);
      return `\0MATH${math.length - 1}\0`;
    });
    const unescaped = held
      .replace(/\\<(br)(\s*\/?)>/gi, "")
      .replace(/<(br)(\s*\/?)>/gi, "")
      .replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, "$1");
    return unescaped.replace(/\0MATH(\d+)\0/g, (_match, slot) => math[Number(slot)] ?? "");
  }).join("");
}

function inlineMarkdown(text) {
  let value = escapeHtml(text);
  value = value.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  value = value.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label, href) => {
    const safeHref = escapeHtml(href);
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return value;
}

export function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let list = "";
  let code = null;
  let codeLines = [];
  let inTable = false;
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = "";
  };
  const closeTable = () => {
    if (inTable) {
      output.push("</tbody></table>");
      inTable = false;
    }
  };
  const closeQuote = () => {
    if (quote.length) {
      output.push(`<blockquote>${quote.map((item) => `<p>${inlineMarkdown(item)}</p>`).join("")}</blockquote>`);
      quote = [];
    }
  };

  for (const rawLine of lines) {
    const fence = rawLine.match(/^\s*```([a-zA-Z0-9_+-]*)\s*$/);
    if (fence) {
      flushParagraph();
      closeList();
      closeTable();
      closeQuote();
      if (code === null) {
        code = fence[1] || "text";
        codeLines = [];
      } else {
        output.push(`<pre><code class="language-${escapeHtml(code)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        code = null;
        codeLines = [];
      }
      continue;
    }
    if (code !== null) {
      codeLines.push(rawLine);
      continue;
    }
    const line = unescapeMarkdownLine(rawLine);
    if (!line.trim()) {
      flushParagraph();
      closeList();
      closeTable();
      closeQuote();
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      closeList();
      closeTable();
      closeQuote();
      output.push("<hr>");
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      closeTable();
      closeQuote();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const quoteItem = line.match(/^\s*>\s?(.*)$/);
    if (quoteItem) {
      flushParagraph();
      closeList();
      closeTable();
      quote.push(quoteItem[1]);
      continue;
    }
    closeQuote();
    const listItem = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      const nextList = /^\s*\d+\./.test(line) ? "ol" : "ul";
      if (list && list !== nextList) closeList();
      if (!list) {
        list = nextList;
        output.push(`<${list}>`);
      }
      output.push(`<li>${inlineMarkdown(listItem[1])}</li>`);
      continue;
    }
    const tableRow = line.match(/^\s*\|(.*)$/);
    if (tableRow || (inTable && line.includes("|") && !list)) {
      const body = (tableRow ? tableRow[1] : line).replace(/\|\s*$/, "");
      const cells = body.split("|").map((cell) => cell.trim());
      const isDivider = cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
      if (isDivider) {
        if (!inTable) {
          flushParagraph();
          closeList();
        }
        continue;
      }
      flushParagraph();
      closeList();
      const header = !inTable;
      if (!inTable) {
        output.push("<table><tbody>");
        inTable = true;
      }
      const tag = header ? "th" : "td";
      output.push(`<tr>${cells.map((cell) => `<${tag}>${inlineMarkdown(cell)}</${tag}>`).join("")}</tr>`);
      continue;
    }
    closeTable();
    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  closeTable();
  closeQuote();
  if (code !== null) {
    output.push(`<pre><code class="language-${escapeHtml(code)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  return output.join("");
}
