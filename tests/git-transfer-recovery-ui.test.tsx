import {expect,test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {GitTransferRecoverySurface} from "../src/web/components/GitTransferRecovery";
import {parseGitTransferRecovery,needsGitTransferRecovery,gitTransferLabel} from "../src/web/git-transfer-recovery";
import type {GitGatewayRecoveryReport} from "../src/server/git-gateway-recovery";
const unknown:GitGatewayRecoveryReport={coverage:"unknown",pendingCount:null,quiescent:false,attempts:[],nextCursor:null,complete:false,source:"recorded-ledger",providerVerified:false};
const pending:GitGatewayRecoveryReport={...unknown,coverage:"recorded",pendingCount:1,complete:true,attempts:[{id:"11111111-1111-4111-8111-111111111111",credential:"cleanup_pending",transfer:"completed"}]};
const render=(report:GitGatewayRecoveryReport|null,error="")=>renderToStaticMarkup(<GitTransferRecoverySurface report={report} error={error} busy={false} onRefresh={()=>{}} onMore={()=>{}} defaultOpen/>);
test("unknown Git transport coverage never becomes a zero or successful push claim",()=>{
 expect(parseGitTransferRecovery(unknown).pendingCount).toBeNull();expect(needsGitTransferRecovery(unknown)).toBe(true);const html=render(unknown);expect(html).toContain("status unconfirmed");expect(html).toContain("missing record does not establish");expect(html).not.toContain("0 unresolved");expect(()=>parseGitTransferRecovery({...unknown,quiescent:true})).toThrow();expect(()=>parseGitTransferRecovery({...unknown,pendingCount:0})).toThrow();
});
test("completed transport still shows unresolved credential cleanup and no Git acceptance inference",()=>{
 expect(needsGitTransferRecovery(pending)).toBe(true);const html=render(pending);expect(html).toContain("1 unresolved");expect(html).toContain("HTTP transfer completed");expect(html).toContain("Credential cleanup pending");expect(html).toContain("do not confirm that a push landed");expect(html).toContain("Inspect the remote refs");expect(html).not.toContain("Retry push");expect(html).not.toContain("Delete");expect(gitTransferLabel("open_unverified")).toBe("Transfer closure unconfirmed");
});
test("clear recorded state stays unobtrusive while cursor and failures retain explicit read-only recovery",()=>{
 const clear={...pending,pendingCount:0,quiescent:true,attempts:[]};expect(needsGitTransferRecovery(clear)).toBe(false);expect(render(clear)).toBe("");expect(render({...pending,nextCursor:"20",complete:false})).toContain("Next recorded transfers");const failed=render(null,"Transport status is unavailable. Saved work is preserved.");expect(failed).toContain('role="alert"');expect(failed).toContain("Refresh status");expect(failed).not.toContain("0 unresolved");expect(()=>parseGitTransferRecovery({...pending,token:"private"})).toThrow();expect(()=>parseGitTransferRecovery({...pending,providerVerified:true})).toThrow();
});
