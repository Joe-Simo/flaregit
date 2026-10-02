import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { navigate } from "../router";

export function Join({ projectId, token }: { projectId: string; token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(true);

  const join = useCallback(async () => {
    setJoining(true);
    setError(null);
    try {
      const r = await apiJson<{ id: string }>("/join", { method: "POST", json: { projectId, token } });
      navigate(`/p/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join the repository");
      setJoining(false);
    }
  }, [projectId, token]);
  useEffect(() => {
    void join();
  }, [join]);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3 text-sm px-4 text-center">
      <h1 className="text-lg font-semibold">Join repository</h1>
      {error ? (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive max-w-md break-words space-y-2">
          <p>{error}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" variant="outline" disabled={joining} onClick={() => void join()}>Try again</Button>
            <Button size="sm" variant="ghost" onClick={() => navigate("/")}>Go to your repositories</Button>
          </div>
        </div>
      ) : (
        <p role="status" className="text-muted-foreground">Joining repository…</p>
      )}
    </div>
  );
}
