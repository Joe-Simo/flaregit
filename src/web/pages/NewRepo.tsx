import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiFetch, apiJson } from "../api";
import { navigate, timeAgo } from "../router";

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface ImportJob {
  id: string; name: string; source: string; branch: string; canonicalRepoName: string;
  status: "requested" | "pending" | "ready" | "failed"; createdAt: string; updatedAt: string; detail: string;
  verificationPolicy: { install?: string; build?: string; test?: string };
}
interface CreationResponse { id: string; status?: "ready" | "pending" | "failed"; kind?: "demo" | "import"; import?: ImportJob }

export function NewRepo() {
  const [mode, setMode] = useState("import");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [install, setInstall] = useState("");
  const [build, setBuild] = useState("");
  const [test, setTest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imports, setImports] = useState<ImportJob[] | null>(null);
  const [importsError, setImportsError] = useState<string | null>(null);
  const [activeImport, setActiveImport] = useState<ImportJob | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const loadImports = useCallback(async () => {
    try { const response = await apiJson<{ imports: ImportJob[] }>("/imports"); setImports(response.imports); setActiveImport((previous) => previous ? response.imports.find((job) => job.id === previous.id) ?? previous : previous); setImportsError(null); }
    catch (cause) { setImportsError(cause instanceof Error ? cause.message : "Could not load saved imports"); }
  }, []);
  useEffect(() => { void loadImports(); }, [loadImports]);
  const remember = (job: ImportJob) => { setActiveImport(job); setImports((previous) => [job, ...(previous ?? []).filter((item) => item.id !== job.id)]); };
  const restore = (job: ImportJob) => {
    setMode("import"); setName(job.name); setUrl(job.source); setBranch(job.branch); setInstall(job.verificationPolicy.install ?? ""); setBuild(job.verificationPolicy.build ?? ""); setTest(job.verificationPolicy.test ?? ""); setError(null); setActiveImport(job);
  };
  const resume = async (job: ImportJob) => {
    setBusy(true); setCheckingId(job.id); setError(null);
    try {
      const result = await apiJson<CreationResponse>(`/imports/${job.id}/resume`, { method: "POST" });
      if (result.status === "ready") { navigate(`/p/${result.id}`); return; }
      if (result.status === "pending" && result.import) { restore(result.import); remember(result.import); }
      else throw new Error("Import readiness was not confirmed. Check saved imports before starting another import.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not check this saved import"); }
    finally { setBusy(false); setCheckingId(null); }
  };

  const disabled = busy || activeImport !== null || (mode === "import" && (!url || !test || !name));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = mode === "import" ? { kind: "import", name, url, branch, install, build, test } : { kind: "demo", name: name || "Ticket checkout" };
      const response = await apiFetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const raw = await response.text();
      let created: CreationResponse;
      try { created = JSON.parse(raw) as CreationResponse; } catch { throw new Error(raw || "Could not read the creation result"); }
      if (created.status === "failed" && created.import) { remember(created.import); setError(created.import.detail || "The provider refused this import."); setBusy(false); return; }
      if (!response.ok) throw new Error(raw || "Import request failed");
      if (created.status === "ready" || (mode === "demo" && created.kind === "demo")) navigate(`/p/${created.id}`);
      else if (created.status === "pending" && created.import) remember(created.import);
      else throw new Error("Repository readiness was not confirmed. Check saved imports before retrying creation.");
      setBusy(false);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Could not create the repository"}${mode === "import" ? " Check saved imports before submitting this import again." : ""}`);
      setBusy(false);
      void loadImports();
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 min-w-0">
      <h1 className="text-xl font-bold mb-1">New repository</h1>
      <p className="text-sm text-muted-foreground mb-6">Each contribution has an isolated Git workspace. Verified candidates wait for your review before acceptance.</p>
      {activeImport && <section className="mb-5 border border-border rounded-md p-4 space-y-3" aria-label="Saved import status">
        <div><h2 className="text-sm font-medium">{activeImport.status === "ready" ? "Import ready" : activeImport.status === "failed" ? "Import refused by provider" : "Import saved · waiting for repository availability"}</h2><p role="status" className="mt-1 text-sm text-muted-foreground">{activeImport.detail || "The provider has not confirmed that repository refs are ready."}</p></div>
        <p className="text-xs text-muted-foreground">{activeImport.status === "failed" ? "The saved source and protected checks remain below. Correcting the source creates a new import; this refused request is retained." : "The source and protected checks below are saved. Checking status inspects this existing import and does not request another provider import."}</p>
        <div className="flex flex-wrap gap-2">{activeImport.status !== "failed" && <Button size="sm" variant="outline" disabled={busy} onClick={() => activeImport.status === "ready" ? navigate(`/p/${activeImport.id}`) : void resume(activeImport)}>{checkingId === activeImport.id ? "Checking…" : activeImport.status === "ready" ? "Open repository" : "Check import status"}</Button>}{activeImport.status === "failed" && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setActiveImport(null); setError(null); }}>Correct source and create a new import</Button>}<Button size="sm" variant="ghost" disabled={busy} onClick={() => { setActiveImport(null); setName(""); setUrl(""); setBranch(""); setError(null); }}>Start another repository</Button></div>
      </section>}
      <Card>
        <CardHeader className="pb-2">
          <Tabs value={mode} onValueChange={(value) => { if (!busy && !activeImport) setMode(value); }}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="import">Import Git repository</TabsTrigger>
              <TabsTrigger value="demo">Demo repository</TabsTrigger>
            </TabsList>
            <TabsContent value="import">{null}</TabsContent>
            <TabsContent value="demo">{null}</TabsContent>
          </Tabs>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!disabled) void submit(); }}>
          <label className="block text-sm">
            <span className="font-medium">Repository name</span>
            <input disabled={busy || activeImport !== null} className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === "import" ? "my-project" : "Ticket checkout"} maxLength={60} />
          </label>
          {mode === "import" ? (
            <>
              <label className="block text-sm">
                <span className="font-medium">Repository URL</span>
                <input disabled={busy || activeImport !== null} className={field} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" />
                <span className="text-xs text-muted-foreground">Public repositories only for now.</span>
              </label>
              <label className="block text-sm">
                <span className="font-medium">Branch (optional)</span>
                <input disabled={busy || activeImport !== null} className={field} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="default branch" />
              </label>
              <div className="rounded-md border border-border p-3 space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">Protected checks</h2>
                  <p className="text-xs text-muted-foreground">Commands FlareGit runs on every candidate. Contributors cannot change them, and tests and dependency files are protected from edits.</p>
                </div>
                <label className="block text-sm">
                  <span className="font-medium">Test command (required)</span>
                  <input disabled={busy || activeImport !== null} className={field} value={test} onChange={(e) => setTest(e.target.value)} placeholder="bun test   ·   npm test   ·   pytest" />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Install command (optional)</span>
                  <input disabled={busy || activeImport !== null} className={field} value={install} onChange={(e) => setInstall(e.target.value)} placeholder="bun install   ·   npm ci" />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Build command (optional)</span>
                  <input disabled={busy || activeImport !== null} className={field} value={build} onChange={(e) => setBuild(e.target.value)} placeholder="npm run build" />
                </label>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">A ready-made ticket-checkout app with protected checks, for trying out parallel agents, conflicts and decisions.</p>
          )}
          {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          {busy && <p role="status" className="text-sm text-muted-foreground">{mode === "import" ? "Submitting the import request. Repository availability is checked before opening it." : "Creating the demo repository…"}</p>}
          <div className="flex flex-wrap gap-2">
            {!activeImport && <Button type="submit" variant="orange" disabled={disabled}>
              {busy ? "Creating…" : mode === "import" ? "Import repository" : "Create demo repository"}
            </Button>}
            <Button type="button" variant="outline" onClick={() => navigate("/")} disabled={busy}>{activeImport ? "Back to repositories" : "Cancel"}</Button>
          </div>
          </form>
        </CardContent>
      </Card>
      <section className="mt-8" aria-labelledby="saved-imports-title"><div className="flex flex-wrap gap-2 items-center justify-between border-b border-border pb-3"><h2 id="saved-imports-title" className="text-sm font-semibold">Saved imports</h2><Button size="sm" variant="ghost" disabled={busy} onClick={() => void loadImports()}>Refresh imports</Button></div>
        {importsError && <p role="alert" className="py-3 text-sm text-destructive">{importsError}{imports ? " · showing previously loaded imports" : ""}</p>}
        {!imports && !importsError && <p role="status" className="py-3 text-sm text-muted-foreground">Loading saved imports…</p>}
        {imports?.length === 0 && !importsError && <p className="py-3 text-sm text-muted-foreground">No saved imports.</p>}
        <ul className="divide-y divide-border">{imports?.map((job) => <li key={job.id} className="py-4 flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h3 className="text-sm font-medium break-words">{job.name}</h3><p className="mt-1 text-xs text-muted-foreground break-all">{job.source}</p><p className="mt-1 text-xs text-muted-foreground">{job.status === "ready" ? "Ready" : job.status === "failed" ? "Provider refused import" : job.status === "requested" ? "Request saved · readiness unconfirmed" : "Waiting for provider"} · updated {timeAgo(job.updatedAt)}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => job.status === "ready" ? navigate(`/p/${job.id}`) : restore(job)}>{job.status === "ready" ? "Open repository" : job.status === "failed" ? "Read failure" : "Continue import"}</Button></li>)}</ul>
      </section>
    </div>
  );
}
