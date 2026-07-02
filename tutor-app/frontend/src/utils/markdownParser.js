import React from "react";

const SIMPLE_TEXT_REPLACEMENTS = [
  ["°", " degrees"],
  ["√", "sqrt"],
  ["π", "pi"],
  ["≤", "<="],
  ["≥", ">="],
  ["≠", "!="],
  ["→", " -> "],
  ["⇒", " -> "],
  ["Undefined", "Not defined"],
  ["undefined", "not defined"],
];

const LATEX_REPLACEMENTS = [
  [/\\text\{([^}]*)\}/g, "$1"],
  [/\\sqrt\{([^}]*)\}/g, "sqrt($1)"],
  [/\\leq?|\\le/g, " <= "],
  [/\\geq?|\\ge/g, " >= "],
  [/\\neq/g, " != "],
  [/\\times/g, " x "],
  [/\\div/g, " / "],
  [/\\cdot/g, " * "],
  [/\\quad/g, " "],
  [/\\circ/g, " degrees"],
  [/\^\{2\}|\^2/g, "^2"],
  [/\\/g, ""],
];

function normalizeMathText(input) {
  let text = String(input || "");

  for (const [pattern, replacement] of LATEX_REPLACEMENTS.slice(0, 2)) {
    text = text.replace(pattern, replacement);
  }

  // Convert simple fractions repeatedly so nested pieces get simplified.
  for (let i = 0; i < 5; i += 1) {
    const next = text.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1 / $2)");
    if (next === text) break;
    text = next;
  }

  for (const [pattern, replacement] of LATEX_REPLACEMENTS.slice(2)) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function convertMarkdownTablesToList(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;

  const isTableLine = (line) => line.includes("|") && /\|/.test(line);
  const isSeparator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

  while (i < lines.length) {
    if (!isTableLine(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const block = [];
    while (i < lines.length && isTableLine(lines[i])) {
      block.push(lines[i]);
      i += 1;
    }

    const rows = block
      .filter((line) => !isSeparator(line))
      .map((line) => line.split("|").map((c) => c.trim()).filter(Boolean));

    if (rows.length < 2) {
      out.push(...block);
      continue;
    }

    const headers = rows[0];
    out.push("### Quick Values");
    for (const row of rows.slice(1)) {
      if (!row.length) continue;
      const first = row[0];
      const pairs = [];
      for (let c = 1; c < Math.min(headers.length, row.length); c += 1) {
        pairs.push(`${headers[c]}: ${row[c]}`);
      }
      out.push(`- ${first} -> ${pairs.join(", ")}`);
    }
    out.push("");
  }

  return out.join("\n");
}

function normalizeTutorText(message) {
  let text = String(message || "").replace(/\r\n/g, "\n");

  // Unescape commonly escaped markdown/math characters from model output.
  text = text
    .replace(/\\\$/g, "$")
    .replace(/\\\|/g, "|")
    .replace(/\\_/g, "_")
    .replace(/\\#/g, "#");

  // Convert block math and inline math into readable plain text.
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, expr) => normalizeMathText(expr));
  text = text.replace(/\$([^$\n]+)\$/g, (_, expr) => normalizeMathText(expr));

  // Convert markdown tables into readable bullet lines.
  text = convertMarkdownTablesToList(text);

  // Remove non-ascii symbols to keep output clean and consistent.
  for (const [from, to] of SIMPLE_TEXT_REPLACEMENTS) {
    text = text.replaceAll(from, to);
  }
  text = text.replace(/[\u{1F300}-\u{1FAFF}]/gu, "");

  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

function isEquationLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;
  if (/^[#\-*]|^\d+\./.test(trimmed)) return false;
  if (/^\|.*\|$/.test(trimmed)) return false;

  const hasOperator = /[=<>]/.test(trimmed) || /\b(sin|cos|tan|cosec|sec|cot)\b/i.test(trimmed);
  const sentenceLike = /[.!?]$/.test(trimmed) && !trimmed.includes("=");
  return hasOperator && !sentenceLike;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseInline(line, keyPrefix) {
  const nodes = [];
  let remaining = line;
  let i = 0;

  const tokenRegex = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*|_[^_]+_)/;

  while (remaining.length) {
    const match = remaining.match(tokenRegex);
    if (!match || match.index === undefined) {
      nodes.push(remaining);
      break;
    }

    if (match.index > 0) {
      nodes.push(remaining.slice(0, match.index));
    }

    const token = match[0];
    if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      nodes.push(
        React.createElement("strong", { key: `${keyPrefix}-b-${i}` }, token.slice(2, -2))
      );
    } else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) {
      nodes.push(React.createElement("em", { key: `${keyPrefix}-i-${i}` }, token.slice(1, -1)));
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(
        React.createElement("del", { key: `${keyPrefix}-d-${i}` }, token.slice(2, -2))
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        React.createElement("code", { key: `${keyPrefix}-c-${i}`, className: "md-inline-code" }, token.slice(1, -1))
      );
    } else if (token.startsWith("[") && token.includes("](")) {
      const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/) || [];
      if (label && href) {
        nodes.push(
          React.createElement(
            "a",
            {
              key: `${keyPrefix}-a-${i}`,
              className: "md-link",
              href,
              target: "_blank",
              rel: "noreferrer noopener",
            },
            label
          )
        );
      } else {
        nodes.push(token);
      }
    }

    remaining = remaining.slice(match.index + token.length);
    i += 1;
  }

  return nodes;
}

function CodeBlock({ code, language, id }) {
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard not available in some contexts; silently ignore.
    }
  };

  return React.createElement(
    "div",
    { className: "md-code-wrap", key: id },
    React.createElement(
      "div",
      { className: "md-code-head" },
      React.createElement("span", { className: "md-code-lang" }, language || "text"),
      React.createElement(
        "button",
        { className: "md-copy-btn", type: "button", onClick: onCopy },
        "Copy"
      )
    ),
    React.createElement("pre", { className: "md-code-pre" }, React.createElement("code", null, code))
  );
}

export function renderMarkdown(message) {
  const text = normalizeTutorText(message);
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      i += 1;
      const codeLines = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        React.createElement(CodeBlock, {
          key: `code-${blocks.length}`,
          id: `code-${blocks.length}`,
          language,
          code: codeLines.join("\n"),
        })
      );
      continue;
    }

    if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) {
      blocks.push(React.createElement("hr", { key: `hr-${blocks.length}`, className: "md-divider" }));
      i += 1;
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      const depth = Math.min((trimmed.match(/^#+/)?.[0]?.length || 1), 6);
      const level = `h${depth}`;
      const content = trimmed.replace(/^#{1,6}\s+/, "");
      blocks.push(
        React.createElement(
          level,
          { key: `h-${blocks.length}`, className: `md-heading md-${level}` },
          ...parseInline(content, `h-${blocks.length}`)
        )
      );
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        React.createElement(
          "blockquote",
          { key: `q-${blocks.length}`, className: "md-quote" },
          ...parseInline(quoteLines.join(" "), `q-${blocks.length}`)
        )
      );
      continue;
    }

    if (/^[-*]\s+\[( |x|X)\]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+\[( |x|X)\]\s+/.test(lines[i])) {
        const checked = /\[(x|X)\]/.test(lines[i]);
        const textContent = lines[i].replace(/^\s*[-*]\s+\[( |x|X)\]\s+/, "");
        items.push({ checked, textContent });
        i += 1;
      }

      blocks.push(
        React.createElement(
          "ul",
          { key: `todo-${blocks.length}`, className: "md-ul md-task-list" },
          ...items.map((item, idx) =>
            React.createElement(
              "li",
              { key: `todo-${blocks.length}-${idx}`, className: "md-task-item" },
              React.createElement("input", {
                type: "checkbox",
                checked: item.checked,
                disabled: true,
                readOnly: true,
              }),
              React.createElement(
                "span",
                { className: "md-task-label" },
                ...parseInline(item.textContent, `todo-${blocks.length}-${idx}`)
              )
            )
          )
        )
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        React.createElement(
          "ul",
          { key: `ul-${blocks.length}`, className: "md-ul" },
          ...items.map((item, idx) =>
            React.createElement(
              "li",
              { key: `ul-${blocks.length}-${idx}` },
              ...parseInline(item, `ul-${blocks.length}-${idx}`)
            )
          )
        )
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        React.createElement(
          "ol",
          { key: `ol-${blocks.length}`, className: "md-ol" },
          ...items.map((item, idx) =>
            React.createElement(
              "li",
              { key: `ol-${blocks.length}-${idx}` },
              ...parseInline(item, `ol-${blocks.length}-${idx}`)
            )
          )
        )
      );
      continue;
    }

    if (isEquationLine(trimmed)) {
      const eqLines = [];
      while (i < lines.length && isEquationLine(lines[i])) {
        eqLines.push(lines[i].trim());
        i += 1;
      }
      blocks.push(
        React.createElement(
          "pre",
          { key: `eq-${blocks.length}`, className: "md-equation" },
          eqLines.join("\n")
        )
      );
      continue;
    }

    const paragraphLines = [];
    while (i < lines.length && lines[i].trim()) {
      if (
        lines[i].trim().startsWith("```") ||
        /^#{1,6}\s+/.test(lines[i].trim()) ||
        /^>\s?/.test(lines[i].trim()) ||
        /^[-*]\s+\[( |x|X)\]\s+/.test(lines[i].trim()) ||
        /^[-*]\s+/.test(lines[i].trim()) ||
        /^\d+\.\s+/.test(lines[i].trim()) ||
        /^(---+|\*\*\*+|___+)$/.test(lines[i].trim())
      ) {
        break;
      }
      paragraphLines.push(lines[i]);
      i += 1;
    }

    const paragraphText = paragraphLines.join(" ").trim();
    blocks.push(
      React.createElement(
        "p",
        { key: `p-${blocks.length}`, className: "md-paragraph" },
        ...parseInline(paragraphText, `p-${blocks.length}`)
      )
    );
  }

  if (!blocks.length) {
    return React.createElement("p", { className: "md-paragraph" }, escapeHtml(text));
  }

  return blocks;
}
