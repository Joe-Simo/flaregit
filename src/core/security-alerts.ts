/** F13 slice: secret-pattern scanning. Reports line numbers only and never echoes the matched value. */

const PATTERNS: readonly {readonly kind: string; readonly regex: RegExp}[] = [
  {kind: "private-key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/},
  {kind: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/},
  {kind: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/},
];

export interface Finding {
  readonly kind: string;
  readonly line: number;
}

export function scanText(text: string): Finding[] {
  const findings: Finding[] = [];
  text.split("\n").forEach((content, index) => {
    for (const pattern of PATTERNS) if (pattern.regex.test(content)) findings.push({kind: pattern.kind, line: index + 1});
  });
  return findings;
}
