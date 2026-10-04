import {test,expect} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {DeploymentTargetSummary} from "../src/web/components/DeploymentCard";
import {deploymentTargetRefLabel,deploymentTargetOptionLabel} from "../src/web/deployment-target-display";
import type {AcceptedDeploymentTarget} from "../src/server/deployments";
const legacy:AcceptedDeploymentTarget={journalId:"journal",candidateId:"candidate",commit:"a".repeat(40),tree:"b".repeat(40),acceptedAt:"2026-10-04T00:00:00.000Z",recoverableRef:"refs/flaregit/deployments/journal"};
test("deployment target displays explicit nonprimary accepted ref/version and exact committed recovery state",()=>{
 const target={...legacy,acceptedRef:"refs/heads/release/production",acceptedRootVersion:3};expect(deploymentTargetRefLabel(target)).toBe("refs/heads/release/production · accepted version 3");expect(deploymentTargetOptionLabel(target)).toContain("refs/heads/release/production");const html=renderToStaticMarkup(<DeploymentTargetSummary target={target}/>);expect(html).toContain(target.acceptedRef);expect(html).toContain(target.commit);expect(html).toContain(target.recoverableRef);expect(html).not.toContain("refs/heads/main");
});
test("legacy accepted revisions remain selectable without inventing primary branch metadata",()=>{
 expect(deploymentTargetRefLabel(legacy)).toBe("Branch not recorded");expect(deploymentTargetOptionLabel(legacy)).toContain(legacy.commit.slice(0,12));const html=renderToStaticMarkup(<DeploymentTargetSummary target={legacy}/>);expect(html).toContain("Branch not recorded");expect(html).toContain(legacy.commit);expect(html).toContain(legacy.recoverableRef);expect(html).not.toContain("main");expect(deploymentTargetRefLabel({...legacy,acceptedRef:"refs/tags/release"})).toBe("Branch not recorded");
});
