export function parseNumber(raw: string) {
  const cleaned = raw.replace(/[₹$€£,\s]/g, "");
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function tokenize(expression: string) {
  const tokens: Array<{ type: "number" | "op" | "paren"; value: string; number?: number }> = [];
  const source = expression.replace(/×|x/gi, "*").replace(/÷/g, "/").replace(/,/g, "");
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if ("+-*/()".includes(char)) {
      tokens.push({ type: char === "(" || char === ")" ? "paren" : "op", value: char });
      index += 1;
      continue;
    }
    if (/\d/.test(char) || (char === "." && /\d/.test(source[index + 1] || ""))) {
      const match = source.slice(index).match(/^\d+(?:\.\d+)?/);
      if (!match) break;
      tokens.push({ type: "number", value: match[0], number: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    return null;
  }
  return tokens;
}

function evaluateTokens(tokens: NonNullable<ReturnType<typeof tokenize>>) {
  let index = 0;
  function peek() {
    return tokens[index];
  }
  function consume() {
    return tokens[index++];
  }
  function parseExpression(): number {
    let value = parseTerm();
    while (peek()?.type === "op" && (peek()?.value === "+" || peek()?.value === "-")) {
      const op = consume().value;
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }
  function parseTerm(): number {
    let value = parseUnary();
    while (peek()?.type === "op" && (peek()?.value === "*" || peek()?.value === "/")) {
      const op = consume().value;
      const right = parseUnary();
      if (op === "/" && right === 0) throw new Error("division by zero");
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }
  function parseUnary(): number {
    if (peek()?.type === "op" && peek()?.value === "-") {
      consume();
      return -parseUnary();
    }
    if (peek()?.type === "op" && peek()?.value === "+") {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const token = consume();
    if (!token) throw new Error("empty");
    if (token.type === "number" && token.number !== undefined) return token.number;
    if (token.value === "(") {
      const value = parseExpression();
      if (peek()?.value !== ")") throw new Error("unbalanced");
      consume();
      return value;
    }
    throw new Error("invalid");
  }
  const result = parseExpression();
  if (index !== tokens.length) throw new Error("trailing");
  if (!Number.isFinite(result)) throw new Error("nonfinite");
  return result;
}

export function evaluateArithmetic(expression: string) {
  const tokens = tokenize(expression);
  if (!tokens?.length) return null;
  try {
    return evaluateTokens(tokens);
  } catch {
    return null;
  }
}

export type VerifiedCalculation = {
  expression: string;
  result: number;
  note?: string;
};

function formatResult(value: number) {
  if (Number.isInteger(value)) return value;
  return Number(value.toFixed(8));
}

export function extractCalculations(text: string): VerifiedCalculation[] {
  const found: VerifiedCalculation[] = [];
  const seen = new Set<string>();
  const push = (expression: string, result: number, note?: string) => {
    const key = `${expression}=${result}`;
    if (seen.has(key) || !Number.isFinite(result)) return;
    seen.add(key);
    found.push({ expression, result: formatResult(result), note });
  };

  const percentOf = /(-?\d[\d,]*(?:\.\d+)?)\s*%\s+of\s+(-?\d[\d,]*(?:\.\d+)?)/gi;
  for (const match of text.matchAll(percentOf)) {
    const left = parseNumber(match[1]);
    const right = parseNumber(match[2]);
    if (left === null || right === null) continue;
    push(`${left}% of ${right}`, (left / 100) * right);
  }

  const product = /(-?\d[\d,]*(?:\.\d+)?)\s*(?:customers|users|units|seats)?\s*[×x*]\s*(?:₹|\$|€|£)?\s*(-?\d[\d,]*(?:\.\d+)?)/gi;
  for (const match of text.matchAll(product)) {
    const left = parseNumber(match[1]);
    const right = parseNumber(match[2]);
    if (left === null || right === null) continue;
    const monthly = left * right;
    push(`${left} × ${right}`, monthly);
    if (/\b(month|monthly|per month|\/mo)\b/i.test(text)) {
      push(`${left} × ${right} × 12`, monthly * 12, "Annualised from a monthly figure. This is arithmetic only, not a conversion or paying-customer assumption.");
    }
  }

  const expressions = text.match(/-?\d[\d,]*(?:\.\d+)?(?:\s*[+\-×x*/÷()]\s*-?\d[\d,]*(?:\.\d+)?)+/g) || [];
  for (const expression of expressions) {
    const result = evaluateArithmetic(expression);
    if (result === null) continue;
    push(expression.replace(/\s+/g, " ").trim(), result);
  }

  return found.slice(0, 8);
}

export function formatCalculationContext(calculations: VerifiedCalculation[]) {
  if (!calculations.length) return "";
  return [
    "Deterministic arithmetic (computed outside the language model; use these results):",
    ...calculations.map((item) => `- ${item.expression} = ${item.result}${item.note ? ` (${item.note})` : ""}`),
    "Do not invent additional statistics. If a figure is an assumption (conversion rate, paying customers), label it as an assumption.",
  ].join("\n");
}
