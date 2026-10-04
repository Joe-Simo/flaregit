import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Conversation } from "../src/web/components/Conversation";

test("line comment editor describes its exact anchor with an existing unique element", () => {
  const html = renderToStaticMarkup(createElement(Conversation, {
    projectId: "p1", subject: "candidate:c1",
    anchor: { path: "src/pricing.ts", line: 3, commit: "a".repeat(40) },
  }));
  const description = html.match(/<textarea[^>]*aria-describedby="([^"]+)"/)?.[1];
  expect(description).toBeDefined();
  expect(html).toContain(`<p id="${description}"`);
  expect(html).toContain("src/pricing.ts:3");
  expect(html).toContain(`title="${"a".repeat(40)}"`);
  expect(html.match(/<label[^>]*for="([^"]+)"/)?.[1]).toBe(html.match(/<textarea[^>]*id="([^"]+)"/)?.[1]);
});

test("unanchored comments have no dangling anchor description", () => {
  const html = renderToStaticMarkup(createElement(Conversation, { projectId: "p1", subject: "candidate:c1" }));
  expect(html).not.toContain("aria-describedby=");
});
