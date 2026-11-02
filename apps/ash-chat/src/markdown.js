const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);

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

  for (const line of lines) {
    const fence = line.match(/^\s*```([a-zA-Z0-9_+-]*)\s*$/);
    if (fence) {
      flushParagraph();
      closeList();
      closeTable();
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
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      closeList();
      closeTable();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      closeTable();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
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
    const tableRow = line.match(/^\s*\|(.+)\|\s*$/);
    if (tableRow) {
      const cells = tableRow[1].split("|").map((cell) => cell.trim());
      const isDivider = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
      if (isDivider) continue;
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
  if (code !== null) {
    output.push(`<pre><code class="language-${escapeHtml(code)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  return output.join("");
}
