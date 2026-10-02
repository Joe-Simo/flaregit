import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiJson } from "../api";
import { navigate } from "../router";

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

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

  const disabled = busy || (mode === "import" && (!url || !test || !name));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = mode === "import" ? { kind: "import", name, url, branch, install, build, test } : { kind: "demo", name: name || "Ticket checkout" };
      const created = await apiJson<{ id: string }>("/projects", { method: "POST", json: body });
      navigate(`/p/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the repository");
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 min-w-0">
      <h1 className="text-xl font-bold mb-1">New repository</h1>
      <p className="text-sm text-muted-foreground mb-6">Each contribution has an isolated Git workspace. Verified candidates wait for your review before acceptance.</p>
      <Card>
        <CardHeader className="pb-2">
          <Tabs value={mode} onValueChange={setMode}>
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
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === "import" ? "my-project" : "Ticket checkout"} maxLength={60} />
          </label>
          {mode === "import" ? (
            <>
              <label className="block text-sm">
                <span className="font-medium">Repository URL</span>
                <input className={field} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" />
                <span className="text-xs text-muted-foreground">Public repositories only for now.</span>
              </label>
              <label className="block text-sm">
                <span className="font-medium">Branch (optional)</span>
                <input className={field} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="default branch" />
              </label>
              <div className="rounded-md border border-border p-3 space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">Protected checks</h2>
                  <p className="text-xs text-muted-foreground">Commands FlareGit runs on every candidate. Contributors cannot change them, and tests and dependency files are protected from edits.</p>
                </div>
                <label className="block text-sm">
                  <span className="font-medium">Test command (required)</span>
                  <input className={field} value={test} onChange={(e) => setTest(e.target.value)} placeholder="bun test   ·   npm test   ·   pytest" />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Install command (optional)</span>
                  <input className={field} value={install} onChange={(e) => setInstall(e.target.value)} placeholder="bun install   ·   npm ci" />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">Build command (optional)</span>
                  <input className={field} value={build} onChange={(e) => setBuild(e.target.value)} placeholder="npm run build" />
                </label>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">A ready-made ticket-checkout app with protected checks, for trying out parallel agents, conflicts and decisions.</p>
          )}
          {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          {busy && <p role="status" className="text-sm text-muted-foreground">{mode === "import" ? "Importing the repository. Large repositories can take a minute…" : "Creating the demo repository…"}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="orange" disabled={disabled}>
              {busy ? "Creating…" : mode === "import" ? "Import repository" : "Create demo repository"}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate("/")} disabled={busy}>Cancel</Button>
          </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
