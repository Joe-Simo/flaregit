import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
import type { DiscussionEntry } from "../src/server/repository-discussions";
test("repository discussions keep private conversations separate and preserve resolution, lock, CAS and retry decisions", async () => {
    if (await workerdChild("tests/repository-discussions.test.ts"))
        return;
    const file = `/tmp/discussion-${crypto.randomUUID()}.js`, build = Bun.spawn([process.execPath, "build", "tests/support/repository-discussions-worker.ts", "--target=browser", "--external=cloudflare:workers", `--outfile=${file}`], { stdout: "ignore", stderr: "pipe" });
    if (await build.exited)
        throw new Error(await new Response(build.stderr).text());
    const script = await Bun.file(file).text();
    await Bun.file(file).delete();
    const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "forum", modules: true, script, compatibilityDate: "2026-10-02", durableObjects: { TEST: { className: "DiscussionFixture", useSQLite: true } } }] }));
    const call = async (path: string, input?: unknown) => (await mf.getWorker("forum")).fetch(`http://fixture${path}`, input ? { method: "POST", body: JSON.stringify(input) } : undefined);
    const input = { category: "question", title: "Overlapping changes", body: "How do we review both contributions?", idempotencyKey: "stable-retry-123", confirmed: true };
    try {
        expect((await call("/create", { ...input, confirmed: false })).status).toBe(409);
        expect((await call("/create", { ...input, author: "Operator" })).status).toBe(409);
        expect((await call("/create", { ...input, body: "https://example.com/?%61pi_key=secret" })).status).toBe(409);
        const entry = await (await call("/create", input)).json() as DiscussionEntry;
        expect(entry.author).toBe("Human");
        const privateEntry=await (await call("/create?private=true", {...input,title:"Private context",idempotencyKey:"private-topic-123"})).json() as DiscussionEntry;
        expect((await call(`/poll?id=${entry.id}&actor=intruder`,{operation:"create",options:["Review","Rebase"],expectedVersion:1,confirmed:true})).status).toBe(409);
        expect((await call(`/poll?id=${entry.id}`,{operation:"create",options:["Review","Rebase"],expectedVersion:1,confirmed:true})).status).toBe(200);
        expect((await call(`/poll?id=${entry.id}&actor=intruder`,{operation:"vote",option:"Review"})).status).toBe(200);
        const vote=await(await call(`/poll?id=${entry.id}&actor=intruder`,{operation:"vote",option:"Rebase"})).json() as {counts:Record<string,number>};
        expect(vote.counts).toEqual({Review:0,Rebase:1});
        expect((await call(`/poll?id=${entry.id}&private=true`,{operation:"vote",option:"Rebase"})).status).toBe(409);
        expect((await call(`/poll?id=${entry.id}&actor=intruder`,{operation:"close",expectedVersion:1})).status).toBe(409);
        expect((await call(`/poll?id=${entry.id}`,{operation:"close",expectedVersion:1})).status).toBe(200);
        expect((await call(`/poll?id=${entry.id}`,{operation:"close",expectedVersion:1})).status).toBe(200);
        expect((await call(`/poll?id=${entry.id}`,{operation:"vote",option:"Review"})).status).toBe(409);
        expect((await call(`/subscribe?id=${entry.id}`,{subscribed:true})).status).toBe(200);
        expect(await(await call(`/permissions?id=${entry.id}`)).json()).toMatchObject({subscribed:true});
        expect(await(await call(`/permissions?id=${entry.id}&actor=intruder`)).json()).toMatchObject({subscribed:false,selectedOption:"Rebase"});
        expect(await(await call('/subscriptions?private=true')).json()).toEqual({topics:[]});
        expect(await(await call(`/topic?id=${privateEntry.id}`)).json()).toBeNull();
        expect((await call(`/control?id=${entry.id}`,{expectedVersion:1,locked:true})).status).toBe(409);
        expect((await call(`/control?id=${entry.id}&owner=true`,{expectedVersion:1,locked:true})).status).toBe(200);
        expect((await call(`/create?id=${entry.id}`,{body:"Blocked by lock",idempotencyKey:"locked-reply-123",confirmed:true})).status).toBe(409);
        expect((await call(`/control?id=${entry.id}&owner=true`,{expectedVersion:2,locked:false,resolved:true})).status).toBe(200);
        expect((await(await call(`/topic?id=${entry.id}`)).json() as {topic:DiscussionEntry}).topic.resolved).toBe(true);

        expect((await (await call("/create", input)).json() as DiscussionEntry).id).toBe(entry.id);
        expect((await call("/create", { ...input, body: "Changed" })).status).toBe(409);
        expect(await (await call(`/topic?id=${entry.id}&namespace=other`)).json()).toBeNull();
        const projection = await (await call("/list")).text();
        expect(projection).not.toContain("human-subject");
        expect(projection).not.toContain("private-account-key");
        expect((await call(`/edit?id=${entry.id}&actor=intruder`, { body: "Hijack", expectedVersion: 3, confirmed: true })).status).toBe(409);
        expect((await call(`/edit?id=${entry.id}`, { body: "Revised explanation", expectedVersion: 3, confirmed: true })).status).toBe(200);
        expect((await call(`/edit?id=${entry.id}`, { body: "Stale overwrite", expectedVersion: 3, confirmed: true })).status).toBe(409);
        expect((await call(`/subscribe?id=${entry.id}&actor=intruder`,{subscribed:true})).status).toBe(200);
        const replyInput={ body: "Review the conflict together", idempotencyKey: "reply-event-123", confirmed: true };
        const reply = await (await call(`/create?id=${entry.id}`, replyInput)).json() as DiscussionEntry;
        expect(reply.topicId).toBe(entry.id);
        expect(await(await call('/pending')).json()).toEqual([{event_id:reply.id,actor_id:'intruder',topic_id:entry.id,entry_id:reply.id}]);
        expect(await(await call(`/notification-available?id=${entry.id}&entry=${reply.id}&actor=intruder`)).json()).toBe(true);
        expect(await(await call(`/notification-available?id=${entry.id}&entry=${entry.id}&actor=intruder`)).json()).toBe(false);
        expect(await(await call('/pending?private=true')).json()).toEqual([]);
        await call(`/acknowledge?event=${reply.id}&actor=intruder`,{});
        await call(`/create?id=${entry.id}`,replyInput);
        expect(await(await call('/pending')).json()).toEqual([]);
        await call(`/subscribe?id=${entry.id}&actor=intruder`,{subscribed:false});
        expect(await(await call(`/notification-available?id=${entry.id}&entry=${reply.id}&actor=intruder`)).json()).toBe(false);
        const separate=await(await call("/create",{...input,idempotencyKey:"second-topic-123"})).json() as DiscussionEntry;
        const conversion={expectedVersion:1,idempotencyKey:'linked-issue-123',confirmed:true};
        const converted=await(await call(`/convert?id=${separate.id}`,conversion)).json() as {issueNumber:number};
        expect(converted.issueNumber).toBe(1);
        expect(await(await call(`/convert?id=${separate.id}`,conversion)).json()).toEqual(converted);
        expect((await call(`/convert?id=${separate.id}`,{...conversion,idempotencyKey:'different-issue-123'})).status).toBe(409);
        expect(await(await call('/origin?number=1')).json()).toMatchObject({discussionId:separate.id,scope:'public',author:'Human'});
        expect(await(await call('/origin?number=1&private=true')).json()).toBeNull();
        const retryInput={body:"Durably saved before locking",idempotencyKey:"durable-reply-123",confirmed:true};
        const first=await(await call(`/create?id=${separate.id}`,retryInput)).json() as DiscussionEntry;
        expect((await call(`/control?id=${separate.id}&owner=true`,{expectedVersion:2,locked:true})).status).toBe(200);
        expect((await(await call(`/create?id=${separate.id}`,retryInput)).json() as DiscussionEntry).id).toBe(first.id);
        expect((await call(`/create?id=${separate.id}`,{...retryInput,idempotencyKey:"new-locked-reply-123"})).status).toBe(409);

        expect((await call(`/remove?id=${entry.id}&actor=operator&moderator=true`, { expectedVersion: 4 })).status).toBe(409);
        expect((await call(`/remove?id=${entry.id}&actor=operator&moderator=true`, { expectedVersion: 4, reason: "Reported abusive content" })).status).toBe(200);
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
