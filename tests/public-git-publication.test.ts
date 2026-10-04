import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
import { PUBLIC_GIT_AUTHOR_ACKNOWLEDGEMENT } from "../src/server/public-git-consent";
test("dormant public Git ledger defaults off, binds consent, and preserves concurrent decisions", async () => {
  if (await workerdChild("tests/public-git-publication.test.ts")) return;
  const built = await Bun.build({ entrypoints: ["tests/support/public-git-publication-worker.ts"], target: "browser", external: ["cloudflare:workers"] });
  if (!built.success) throw new Error(String(built.logs));
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "publication", modules: true, script: await built.outputs[0]!.text(), compatibilityDate: "2026-10-02", durableObjects: { TEST: { className: "PublicationTest", useSQLite: true } } }] }));
  const scope = { incarnation: crypto.randomUUID(), commit: "a".repeat(40), tree: "b".repeat(40), publicationVersion: 3 };
  const call = async (input: unknown) => (await mf.getWorker("publication")).fetch("http://fixture", { method: "POST", body: JSON.stringify(input) });
  const decision = { enabled: true, consent: { ...scope, confirmed: true, acknowledgement: PUBLIC_GIT_AUTHOR_ACKNOWLEDGEMENT }, mutation: { expectedVersion: 0, idempotencyKey: crypto.randomUUID() } };
  try {
    expect(await (await call({ scope })).json()).toEqual({ state: null, readable: false });
    expect((await call({ scope, decision: { ...decision, consent: undefined } })).status).toBe(409);
    expect((await call({ scope, decision: { ...decision, consent: { ...decision.consent, acknowledgement: "public" } } })).status).toBe(409);
    const saved = await (await call({ scope, decision })).json();
    expect(await (await call({ scope, decision })).json()).toEqual(saved);
    expect((await call({ scope, decision, owner: "other" })).status).toBe(409);
    expect((await call({ scope, decision: { ...decision, mutation: { ...decision.mutation, idempotencyKey: crypto.randomUUID() } } })).status).toBe(409);
    for (const changed of [{ ...scope, incarnation: crypto.randomUUID() }, { ...scope, commit: "c".repeat(40) }, { ...scope, tree: "c".repeat(40) }, { ...scope, publicationVersion: 4 }]) {
      expect((await (await call({ scope: changed })).json() as { readable: boolean }).readable).toBe(false);
    }
    const disabled = { enabled: false, mutation: { expectedVersion: 1, idempotencyKey: crypto.randomUUID() } };
    expect((await call({ scope, decision: disabled })).status).toBe(200);
    expect((await (await call({ scope })).json() as { readable: boolean }).readable).toBe(false);
  } finally { await mf.dispose(); }
}, 30000);
