import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
import type { CommunityEntry } from "../src/server/platform-community";
test("platform forum persists explicitly public author-bound conversations with CAS and replay protection", async () => {
    if (await workerdChild("tests/platform-community.test.ts"))
        return;
    const file = `/tmp/forum-${crypto.randomUUID()}.js`, build = Bun.spawn([process.execPath, "build", "tests/support/platform-community-worker.ts", "--target=browser", "--external=cloudflare:workers", `--outfile=${file}`], { stdout: "ignore", stderr: "pipe" });
    if (await build.exited)
        throw new Error(await new Response(build.stderr).text());
    const script = await Bun.file(file).text();
    await Bun.file(file).delete();
    const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "forum", modules: true, script, compatibilityDate: "2026-10-02", durableObjects: { TEST: { className: "ForumFixture", useSQLite: true } } }] }));
    const call = async (path: string, input?: unknown) => (await mf.getWorker("forum")).fetch(`http://fixture${path}`, input ? { method: "POST", body: JSON.stringify(input) } : undefined);
    const input = { category: "concurrency", title: "Overlapping changes", body: "How do we review both contributions?", idempotencyKey: "stable-retry-123", confirmed: true };
    try {
        expect((await call("/create", { ...input, confirmed: false })).status).toBe(409);
        expect((await call("/create", { ...input, author: "Operator" })).status).toBe(409);
        expect((await call("/create", { ...input, body: "https://example.com/?%61pi_key=secret" })).status).toBe(409);
        const entry = await (await call("/create", input)).json() as CommunityEntry;
        expect(entry.author).toBe("Human");
        expect((await (await call("/create", input)).json() as CommunityEntry).id).toBe(entry.id);
        expect((await call("/create", { ...input, body: "Changed" })).status).toBe(409);
        expect(await (await call(`/topic?id=${entry.id}&namespace=other`)).json()).toBeNull();
        const projection = await (await call("/list")).text();
        expect(projection).not.toContain("human-subject");
        expect(projection).not.toContain("private-account-key");
        expect((await call(`/edit?id=${entry.id}&actor=intruder`, { body: "Hijack", expectedVersion: 1, confirmed: true })).status).toBe(409);
        expect((await call(`/edit?id=${entry.id}`, { body: "Revised explanation", expectedVersion: 1, confirmed: true })).status).toBe(200);
        expect((await call(`/edit?id=${entry.id}`, { body: "Stale overwrite", expectedVersion: 1, confirmed: true })).status).toBe(409);
        const reply = await (await call(`/create?id=${entry.id}`, { body: "Review the conflict together", idempotencyKey: "reply-event-123", confirmed: true })).json() as CommunityEntry;
        expect(reply.topicId).toBe(entry.id);
        expect((await call(`/remove?id=${entry.id}&actor=operator&moderator=true`, { expectedVersion: 2 })).status).toBe(409);
        expect((await call(`/remove?id=${entry.id}&actor=operator&moderator=true`, { expectedVersion: 2, reason: "Reported abusive content" })).status).toBe(200);
        expect((await call("/create", input)).status).toBe(409);
        expect((await call(`/create?id=${entry.id}`, { body: "Late reply", idempotencyKey: "late-reply-123", confirmed: true })).status).toBe(409);
        expect(await (await call("/list?q=%27%20OR%201%3D1--")).json()).toMatchObject({ topics: [] });
        const tombstone = await (await call(`/topic?id=${entry.id}`)).text();
        expect(tombstone).not.toContain("Revised explanation");
        expect(tombstone).toContain("Reported abusive content");
    }
    finally {
        await mf.dispose();
    }
}, 30000);
