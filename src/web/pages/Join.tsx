import React, { useEffect, useState } from "react";
import { apiJson } from "../api";
import { navigate } from "../router";

export function Join({ projectId, token }: { projectId: string; token: string }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiJson<{ id: string }>("/join", { method: "POST", json: { projectId, token } })
      .then((r) => navigate(`/p/${r.id}`))
      .catch((e: Error) => setError(e.message));
  }, [projectId, token]);
  return (
    <div className="min-h-[50vh] flex items-center justify-center text-sm text-muted-foreground px-6 text-center">
      {error ?? "Joining repository…"}
    </div>
  );
}
