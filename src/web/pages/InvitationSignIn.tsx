import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cancelInvitationSignIn, prepareInvitationSignIn } from "../invitation-return";
export function InvitationSignIn({ projectId, token, onPrepared, onCancel }: { projectId: string; token: string; onPrepared: (destination: string) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const nonce = useRef(crypto.randomUUID());
  useEffect(() => { generation.current++; nonce.current = crypto.randomUUID(); lock.current = false; setBusy(false); setError(""); return () => { generation.current++; controller.current?.abort(); }; }, [projectId, token]);
  const start = async () => {
    if (lock.current) return;
    lock.current = true;
    const current = generation.current, abort = new AbortController(); controller.current = abort;
    setBusy(true); setError("");
    try { const destination = await prepareInvitationSignIn(projectId, token, AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]), nonce.current); if (current === generation.current) onPrepared(destination); }
    catch { if (current === generation.current) setError("Invitation recovery could not be saved. Keep this invitation link and allow cookies, then retry. No repository was joined."); }
    finally { if (current === generation.current) { lock.current = false; setBusy(false); } }
  };
  const cancel = async () => { if (lock.current) return; lock.current = true; const current = generation.current; setBusy(true); setError(""); try { await cancelInvitationSignIn(nonce.current, AbortSignal.timeout(15_000)); if (current === generation.current) onCancel(); } catch { if (current === generation.current) setError("Invitation cancellation was not confirmed. Retry cancel; no repository was joined."); } finally { if (current === generation.current) {lock.current = false; setBusy(false);} } };
  return <div className="space-y-4 text-sm"><h1 className="text-2xl font-semibold">Sign in to review your invitation</h1><p className="text-muted-foreground">Your invitation stays on FlareGit. After signing in, choose whether to join the repository.</p>{error && <p role="alert" className="text-destructive">{error}</p>}<Button disabled={busy} onClick={() => void start()}>Continue to sign in</Button><Button variant="ghost" disabled={busy} onClick={() => void cancel()}>Cancel</Button>{busy && <p role="status">Confirming invitation recovery…</p>}</div>;
}
