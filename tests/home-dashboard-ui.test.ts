import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Home } from "../src/web/pages/Home";
test("initial dashboard distinguishes current work, repository browsing and historical activity",()=>{
 const html=renderToStaticMarkup(createElement(Home));
 expect(html).toContain('id="home-attention"');
 expect(html).toContain('id="home-repositories"');
 expect(html).toContain('id="home-activity"');
 expect(html).toContain("Needs your attention");
 expect(html).toContain("Recent activity");
});
test("unloaded dashboard does not claim no actionable work or invented repository counts",()=>{
 const html=renderToStaticMarkup(createElement(Home));
 expect(html).toContain("Checking current contributions…");
 expect(html).toContain("Loading repositories…");
 expect(html).not.toContain("No work needs your attention");
 expect(html).not.toContain('class="home-count"');
});
test("home retains one prominent creation action and an accessible repository search",()=>{
 const html=renderToStaticMarkup(createElement(Home));
 const controls=[...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(match=>match[1]);
 expect(controls.filter(label=>label?.includes("New repository"))).toHaveLength(1);
 expect(html).toContain('aria-label="Search repositories"');
 expect(controls.filter(label=>label?.includes("View inbox history"))).toHaveLength(1);
});
