import {isSafeRef} from "../core/sanitize";
import type {AcceptedDeploymentTarget} from "../server/deployments";
/** Missing historical metadata never implies the current default branch. */
export function deploymentTargetRefLabel(target:AcceptedDeploymentTarget):string{
 const ref=target.acceptedRef;
 if(!ref||!ref.startsWith("refs/heads/")||!isSafeRef(ref))return "Branch not recorded";
 const version=target.acceptedRootVersion;
 return typeof version==="number"&&Number.isSafeInteger(version)&&version>0?`${ref} · accepted version ${version}`:ref;
}
export function deploymentTargetOptionLabel(target:AcceptedDeploymentTarget):string{return`${deploymentTargetRefLabel(target)} · ${target.commit.slice(0,12)} · ${new Date(target.acceptedAt).toLocaleString()}`;}
