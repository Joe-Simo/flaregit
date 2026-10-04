import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { Join } from "./Join";
import { navigate } from "../router";
import { invitationClearReceipt } from "../invitation-return";
const contextSchema = z.object({ nonce: z.uuid(), projectId: z.string().regex(/^[a-z0-9]{12,16}$/), token: z.string().regex(/^[a-f0-9]{48}$/) }).strict();
export function JoinResume({ nonce }: { nonce: string }) {
  const [context, setContext] = useState<z.infer<typeof contextSchema> | null>(null), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const [cleanupError, setCleanupError] = useState(""), [cleanupBusy, setCleanupBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const generation = useRef(0);
  useEffect(() => { const current = ++generation.current, controller = new AbortController(); setContext(null); setError(""); void apiJson<unknown>("/join-return/resume", { method: "POST", json: { nonce }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }).then(value => { const saved = contextSchema.parse(value); if (saved.nonce !== nonce) throw Error("Invitation context changed"); if (current === generation.current) setContext(saved); }).catch(() => { if (current === generation.current) setError("Your invitation recovery expired, was replaced, or could not be loaded. Reopen the original invitation, or retry if the connection failed."); }); return () => { generation.current++; controller.abort(); }; }, [nonce, revision]);
  const clear = async (reason: "joined" | "cancel") => { const saved = invitationClearReceipt.parse(await apiJson<unknown>("/join-return/clear", { method: "POST", json: { nonce, reason, ...(reason === "joined" ? { projectId: context?.projectId } : {}) }, signal: AbortSignal.timeout(15_000) })); if (saved.nonce !== nonce) throw Error("Invitation clearing acknowledgement differs"); };
  const finishCleanup = async () => { const current = generation.current; setCleanupBusy(true); try { await clear("joined"); if (current === generation.current) setCleanupError(""); return true; } catch { if (current === generation.current) setCleanupError("Repository access is confirmed. Invitation recovery cleanup is unconfirmed; retry cleanup or open the repository."); return false; } finally { if (current === generation.current) setCleanupBusy(false); } };
  if (context) return <><Join projectId={context.projectId} token={context.token} onJoined={finishCleanup} onBusyChange={setJoining} />{cleanupError && <div className="space-y-2 text-sm"><p role="alert">{cleanupError}</p><Button variant="outline" disabled={cleanupBusy} onClick={() => void finishCleanup()}>{cleanupBusy ? "Clearing invitation recovery…" : "Retry invitation cleanup"}</Button></div>}<Button variant="ghost" disabled={cleanupBusy || joining} onClick={() => { const current = generation.current; void clear("cancel").then(() => {if (current === generation.current) navigate("/");}).catch(() => {if (current === generation.current) setError("Invitation recovery was not cleared. Retry cancel.");}); }}>Close invitation recovery</Button>{error && <p role="alert">{error}</p>}</>;
  return <div className="mx-auto max-w-lg space-y-4 py-16 text-sm">{error ? <><p role="alert">{error}</p><Button onClick={() => setRevision(value => value + 1)}>Retry invitation recovery</Button></> : <p role="status">Loading your invitation…</p>}<Button variant="ghost" onClick={() => navigate("/")}>Go to your repositories</Button></div>;
}
