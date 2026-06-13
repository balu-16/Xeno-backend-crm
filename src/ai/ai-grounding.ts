const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const NUMBER_PATTERN = /-?\d[\d,]*(?:\.\d+)?/g;
const STATUS_PATTERN =
  /\b(?:DRAFT|QUEUED|RUNNING|PAUSED|COMPLETED|FAILED|SENT|DELIVERED|OPENED|CLICKED|CONVERTED)\b/g;

export type GroundingIssue = {
  type: "number" | "email" | "uuid" | "status";
  value: string;
};

function normalizeNumber(value: string): string {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? String(parsed) : value;
}

function collectFacts(
  value: unknown,
  facts: { numbers: Set<string>; strings: Set<string> }
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    facts.numbers.add(String(value));
    return;
  }
  if (typeof value === "bigint") {
    facts.numbers.add(String(value));
    return;
  }
  if (typeof value === "string") {
    facts.strings.add(value.toLowerCase());
    for (const token of value.match(NUMBER_PATTERN) ?? []) {
      facts.numbers.add(normalizeNumber(token));
    }
    return;
  }
  if (Array.isArray(value)) {
    facts.numbers.add(String(value.length));
    for (const item of value) collectFacts(item, facts);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectFacts(item, facts);
    }
  }
}

function lineIsListMarker(text: string, start: number, token: string): boolean {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  return new RegExp(`^\\s*${token.replace(".", "\\.")}[.)]\\s`).test(
    text.slice(lineStart)
  );
}

export function findUngroundedClaims(
  response: string,
  toolOutputs: unknown[]
): GroundingIssue[] {
  const facts = { numbers: new Set<string>(), strings: new Set<string>() };
  for (const output of toolOutputs) collectFacts(output, facts);
  const corpus = JSON.stringify(toolOutputs).toLowerCase();
  const issues: GroundingIssue[] = [];

  for (const match of response.matchAll(NUMBER_PATTERN)) {
    const raw = match[0];
    if (
      typeof match.index === "number" &&
      lineIsListMarker(response, match.index, raw)
    ) {
      continue;
    }
    const normalized = normalizeNumber(raw);
    if (!facts.numbers.has(normalized)) {
      issues.push({ type: "number", value: raw });
    }
  }
  for (const match of response.matchAll(EMAIL_PATTERN)) {
    if (!corpus.includes(match[0].toLowerCase())) {
      issues.push({ type: "email", value: match[0] });
    }
  }
  for (const match of response.matchAll(UUID_PATTERN)) {
    if (!corpus.includes(match[0].toLowerCase())) {
      issues.push({ type: "uuid", value: match[0] });
    }
  }
  for (const match of response.matchAll(STATUS_PATTERN)) {
    if (!facts.strings.has(match[0].toLowerCase()) && !corpus.includes(match[0].toLowerCase())) {
      issues.push({ type: "status", value: match[0] });
    }
  }
  return issues;
}

export function groundedFallback(
  results: Array<{ tool: string; output: unknown }>
): string {
  const sections = results.map(({ tool, output }) => {
    const serialized = JSON.stringify(output, null, 2);
    const bounded =
      serialized.length > 12_000
        ? `${serialized.slice(0, 12_000)}\n... result truncated`
        : serialized;
    return `**${tool}**\n\n\`\`\`json\n${bounded}\n\`\`\``;
  });
  return [
    "Here is the authoritative CRM result:",
    "",
    ...sections
  ].join("\n");
}

