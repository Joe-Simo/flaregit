import { expect, test } from "bun:test";
import { Glob } from "bun";
import ts from "typescript";

const buttonTags = new Set(["button", "Button"]);
type Element = ts.JsxElement | ts.JsxSelfClosingElement;
interface Source { path: string; file: ts.SourceFile }

const tagName = (node: Element) => (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText();
const attributes = (node: Element) => (ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes).properties;
const declaresType = (node: Element) => attributes(node).some(attribute => ts.isJsxSpreadAttribute(attribute) || attribute.name.getText() === "type");

function eachElement(node: ts.Node, visit: (element: Element) => void): void {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) visit(node);
  ts.forEachChild(node, child => eachElement(child, visit));
}

/** Component name → declaration, for function components declared at the top level of a module. */
function components(sources: Source[]): Map<string, { source: Source; node: ts.Node }> {
  const found = new Map<string, { source: Source; node: ts.Node }>();
  for (const source of sources) for (const statement of source.file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && /^[A-Z]/.test(statement.name.text)) found.set(statement.name.text, { source, node: statement });
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && /^[A-Z]/.test(declaration.name.text) && declaration.initializer) found.set(declaration.name.text, { source, node: declaration.initializer });
  }
  return found;
}

/**
 * A <button> without an explicit type submits its form. Every button rendered inside a <form>,
 * directly or through a component used inside one, must declare its type.
 */
export function untypedFormButtons(sources: Source[]): string[] {
  const declared = components(sources);
  const violations = new Set<string>();
  const scanned = new Set<ts.Node>();
  const scan = (source: Source, root: ts.Node) => {
    if (scanned.has(root)) return;
    scanned.add(root);
    eachElement(root, element => {
      const name = tagName(element);
      if (buttonTags.has(name) && !declaresType(element)) {
        const { line } = source.file.getLineAndCharacterOfPosition(element.getStart());
        violations.add(`${source.path}:${line + 1}: ${element.getText().replace(/\s+/g, " ").slice(0, 120)}`);
      }
      const component = declared.get(name);
      if (component) scan(component.source, component.node);
    });
  };
  for (const source of sources) eachElement(source.file, element => { if (tagName(element) === "form") scan(source, element); });
  return [...violations].sort();
}

const parse = (path: string, text: string): Source => ({ path, file: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) });

test("buttons inside forms declare whether they submit", async () => {
  const sources: Source[] = [];
  for await (const path of new Glob("src/web/**/*.tsx").scan(".")) sources.push(parse(path, await Bun.file(path).text()));
  expect(untypedFormButtons(sources)).toEqual([]);
});

test("the scanner follows components rendered inside a form", () => {
  const flagged = untypedFormButtons([
    parse("a.tsx", `export function Page() { return <form><Picker /><Button type="submit">Save</Button></form>; }`),
    parse("b.tsx", `export function Picker() { return <div><Button onClick={pick}>Pick</Button><button type="button">Ok</button></div>; }`),
  ]);
  expect(flagged).toEqual(["b.tsx:1: <Button onClick={pick}>Pick</Button>"]);
});
