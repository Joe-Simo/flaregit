import {expect,test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {RecoveryRevisionSummary} from "../src/web/components/PrivateGitRecovery";
import {recoverySelection,recoveryTargetKey,recoverySnapshotMatches,recoveryDownloadNotice,selectedRecoveryTarget,type RecoveryRevision} from "../src/web/private-recovery-target";
const legacy={commit:"a".repeat(40),tree:"b".repeat(40)} satisfies RecoveryRevision;
const primary={...legacy,journalId:"primary-journal",acceptedRef:"refs/heads/main",acceptedRootVersion:3},release={...legacy,journalId:"release-journal",acceptedRef:"refs/heads/release",acceptedRootVersion:2};
test("private recovery distinguishes same-SHA accepted refs and never substitutes primary for a missing explicit selection",()=>{
 expect(recoveryTargetKey(primary)).not.toBe(recoveryTargetKey(release));expect(selectedRecoveryTarget([primary,release],primary,recoveryTargetKey(release))).toEqual(release);expect(selectedRecoveryTarget([primary],primary,recoveryTargetKey(release))).toBeNull();expect(selectedRecoveryTarget([primary,release],legacy,null)).toEqual(legacy);expect(recoverySnapshotMatches(primary,release)).toBe(false);expect(recoverySnapshotMatches(release,{...release,acceptedRootVersion:3})).toBe(false);
});
test("preparation and retry use recorded selector metadata without retrofitting a historical UUID",()=>{
 expect(recoverySelection(release)).toEqual({journalId:"release-journal",acceptedRef:"refs/heads/release",acceptedRootVersion:2});expect(recoverySelection(legacy)).toBeUndefined();const historic={...legacy,journalId:"historic"};expect(recoverySelection(historic)).toEqual({journalId:"historic"});expect(recoverySelection({...release,journalId:"snapshot-owned-journal"})).toEqual({journalId:"snapshot-owned-journal",acceptedRef:release.acceptedRef,acceptedRootVersion:2});
});
test("recovery status and download notice show exact recorded branch/version/commit without public-sharing implication",()=>{
 const html=renderToStaticMarkup(<RecoveryRevisionSummary revision={release}/>);expect(html).toContain(release.acceptedRef);expect(html).toContain("accepted version 2");expect(html).toContain(release.commit);expect(html).toContain(release.tree);expect(html).not.toContain("refs/heads/main");expect(html).not.toContain("public");expect(recoveryDownloadNotice(release)).toContain(`${release.acceptedRef} · accepted version 2`);expect(recoveryDownloadNotice(release)).toContain(release.commit);const old=renderToStaticMarkup(<RecoveryRevisionSummary revision={legacy}/>);expect(old).toContain("Branch not recorded");expect(old).not.toContain("main");expect(recoveryDownloadNotice(legacy)).toContain("Branch not recorded");
});
