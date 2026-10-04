import {expect,test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {ContributionTargetChoices} from "../src/web/components/ContributionTargetChoices";
import type {ContributionTarget} from "../src/web/contribution-target-selection";
const target={ref:"refs/heads/release/production",branch:"release/production",acceptedCommit:"a".repeat(40),acceptedVersion:3,policyVersion:2} satisfies ContributionTarget;
const render=(search="",error:string|null=null)=>renderToStaticMarkup(<ContributionTargetChoices targets={[target]} search={search} error={error} truncated={false} disabled={false} onRefresh={()=>{}} onDefault={()=>{}} onSelect={()=>{}}/>);
test("accepted branch picker shows exact tuple and searches real returned choices without synthesizing primary",()=>{const html=render();expect(html).toContain(target.ref);expect(html).toContain(target.acceptedCommit);expect(html).toContain("Accepted 3");expect(html).toContain("policy 2");expect(html).not.toContain("refs/heads/main");expect(render("different")).not.toContain(target.ref);expect(render("release")).toContain(target.ref);});
test("unavailable target list offers explicit refresh while keeping default an explicit user action",()=>{const html=render("", "Accepted branch choices unavailable");expect(html).toContain('role="alert"');expect(html).toContain("Refresh accepted branches");expect(html).toContain("Default accepted branch");expect(html).not.toContain("automatically");});
