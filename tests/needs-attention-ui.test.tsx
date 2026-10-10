import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NeedsAttention } from "../src/web/components/NeedsAttention";

test("healthy recovery panels render inline without an alert", () => {
  const html = renderToStaticMarkup(<NeedsAttention label="Agent run needs attention"><p>Agent run · Running</p></NeedsAttention>);
  expect(html).not.toContain('role="alert"');
  expect(html).not.toContain("Agent run needs attention");
  expect(html).not.toContain("hidden");
  expect(html).toContain("Agent run · Running");
});

test("a confirmed problem gathers the panels behind one collapsed alert", () => {
  const html = renderToStaticMarkup(<NeedsAttention attention label="Agent run needs attention" description="The agent stopped before finishing."><p>Saved agent work</p></NeedsAttention>);
  expect(html).toContain('role="alert"');
  expect(html).toContain("Agent run needs attention");
  expect(html).toContain("The agent stopped before finishing.");
  expect(html).toMatch(/<button type="button" aria-expanded="false"/);
  expect(html).toMatch(/hidden=""[^>]*>.*Saved agent work/);
});
