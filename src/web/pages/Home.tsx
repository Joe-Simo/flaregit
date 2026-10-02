import React, { useEffect, useState } from "react";
import { GitBranch, Plus, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { apiJson } from "../api";
import { navigate, timeAgo } from "../router";

interface Account {
  projects: Array<{ id: string; name: string; role: "owner" | "member"; kind: string; created_at: string }>;
}

export function Home() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<Account>("/account").then(setAccount).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Your repositories</h1>
        <Button variant="orange" onClick={() => navigate("/new")}>
          <Plus className="h-4 w-4 mr-1.5" /> New repository
        </Button>
      </div>
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive mb-4">{error}</div>}
      {!account && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {account && account.projects.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <GitBranch className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No repositories yet</p>
            <p className="text-sm text-muted-foreground mt-1">Import a project from GitHub or start with the demo repository.</p>
            <Button className="mt-4" variant="orange" onClick={() => navigate("/new")}>Create your first repository</Button>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3">
        {account?.projects.map((p) => (
          <button key={p.id} onClick={() => navigate(`/p/${p.id}`)} className="text-left">
            <Card className="hover:border-primary/60 transition-colors">
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">Created {timeAgo(p.created_at)}</div>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Badge variant="secondary">{p.kind === "import" ? "Imported" : "Demo"}</Badge>
                  <Badge variant={p.role === "owner" ? "success" : "outline"}>{p.role}</Badge>
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}
