import { expect, test } from "bun:test";
import { Glob } from "bun";
import ts from "typescript";

const forbidden = /\b(candidates?|journals?|epochs?|incarnations?|evidence)\b|candidate|canonical HEAD|full-ref/i;
/** Internal acronyms are matched case-sensitively so ordinary words ("cast", "case") stay allowed. */
const forbiddenAcronyms = /\bCAS\b/;
const banned = (value: string) => forbidden.test(value) || forbiddenAcronyms.test(value);
const displayAttributes = new Set(["title", "aria-label", "aria-description", "placeholder", "alt", "label", "description", "summary", "hint", "message", "heading", "emptyText", "children"]);

/** Display copy reads like prose: it contains whitespace or starts with a capitalised word. */
function prose(value: string): boolean {
  const trimmed = value.trim();
  return /\s/.test(trimmed) || /^[A-Z][a-z]/.test(trimmed);
}

/** True when the expression's value is what React renders: it flows straight into a {…} child or display attribute. */
function rendered(node: ts.Node): boolean {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent) || ts.isConditionalExpression(current.parent) && current.parent.condition !== current || ts.isBinaryExpression(current.parent) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(current.parent.operatorToken.kind)) current = current.parent;
  return ts.isJsxExpression(current.parent);
}

/** Literals that are protocol values rather than copy: imports, keys, comparisons, non-display props. */
function protocolLiteral(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isLiteralTypeNode(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent)) return true;
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind)) return true;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isJsxAttribute(parent) && !displayAttributes.has(parent.name.getText())) return true;
  return false;
}

export function visibleTerminologyViolations(path: string, source: string): string[] {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const report = (node: ts.Node, value: string) => {
    if (!banned(value)) return;
    const { line } = file.getLineAndCharacterOfPosition(node.getStart());
    found.push(`${path}:${line + 1}: ${value.trim().replace(/\s+/g, " ").slice(0, 140)}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) report(node, node.text);
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !protocolLiteral(node) && (prose(node.text) || rendered(node)) && !/^[#/]/.test(node.text.trim())) report(node, node.text);
    else if (ts.isTemplateExpression(node) && !protocolLiteral(node) && !/^[#/]/.test(node.head.text)) {
      const parts = [node.head.text, ...node.templateSpans.map(span => span.literal.text)];
      // Template copy is judged on its joined text, so a word split around a placeholder is still caught.
      if (parts.some(prose) || rendered(node)) report(node, parts.join(""));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

test("internal Git terminology never reaches the interface", async () => {
  const violations: string[] = [];
  for await (const path of new Glob("src/web/**/*.{ts,tsx}").scan(".")) {
    if (path.endsWith(".worker.ts")) continue;
    violations.push(...visibleTerminologyViolations(path, await Bun.file(path).text()));
  }
  expect(violations).toEqual([]);
}, 30_000); // Scans every source file in src/web; allow for loaded CI machines.

test("the scanner flags visible copy and ignores protocol values", () => {
  const flagged = visibleTerminologyViolations("x.tsx", `const a = <p>Candidate failed</p>; const b = <Badge title="Open journal" />; const c = \`Epoch \${n} ended\`;`);
  expect(flagged).toHaveLength(3);
  const internal = visibleTerminologyViolations("x.tsx", [
    "const a = <p>{count} Compositions • {logs} CAS Logs</p>;",
    "const b = <span>Protected canonical HEAD:</span>;",
    "const c = <p>Observed full-ref tip</p>;",
    "const d = <p>{ok ? \"candidate\" : \"none\"}</p>;",
    "const e = <p>{`${n}candidates`}</p>;",
    "const f = `Run a fresh ${kind}candidate`;",
    "const g = <Badge title={`Rerun ${id} as CANDIDATE`} />;",
  ].join(" "));
  expect(internal).toHaveLength(7);
  const allowed = visibleTerminologyViolations("x.tsx", `if (kind === "candidate") call("/p/1/candidates"); const map = { candidate: 1 }; const k = "candidateId"; type T = "evidence"; const e = <X kind="candidate review" />; const f = <a href={\`/p/\${id}/candidates\`} key={\`\${candidate.id}:x\`}>Case cast</a>; const g = { status: "candidate" };`);
  expect(allowed).toEqual([]);
});
