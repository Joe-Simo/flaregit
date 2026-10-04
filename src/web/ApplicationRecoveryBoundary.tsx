import React from "react";
import { Button } from "@/components/ui/button";

/** Catch lazy-module/render failures without logging private component props or retrying automatically. */
export class ApplicationRecoveryBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() {
    if (!this.state.failed) return this.props.children;
    return <main className="mx-auto max-w-lg space-y-4 px-6 py-20" role="alert">
      <h1 className="text-2xl font-semibold">FlareGit could not open this page</h1>
      <p className="text-sm text-muted-foreground">Reload to get the current application. Saved repository history remains available. Drafts saved in this browser session can be recovered after reload.</p>
      <Button variant="outline" onClick={() => window.location.reload()}>Reload FlareGit</Button>
    </main>;
  }
}
