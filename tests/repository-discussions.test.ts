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
        // Canonical private records are retained for an independent appeal, while
        // every normal descendant projection follows the moderation restriction.
        const moderated=await(await call("/create?private=true",{...input,title:"Private moderation original",body:"Private body for reversible review",idempotencyKey:"private-moderation-original"})).json() as DiscussionEntry;
        const moderatedReply=await(await call(`/create?private=true&id=${moderated.id}&actor=reply-author`,{body:"Private descendant reply",confirmed:true,idempotencyKey:"private-moderation-reply"})).json() as DiscussionEntry;
        await call(`/poll?private=true&id=${moderated.id}`,{operation:"create",options:["Private first option","Private second option"],expectedVersion:1,confirmed:true});
        await call(`/subscribe?private=true&id=${moderated.id}&actor=subscriber`,{subscribed:true});
        const report=await(await call(`/report?private=true&id=${moderated.id}&actor=reporter`,{reason:"spam",note:"Reporter-only private context"})).json() as {id:string};
        expect(await(await call("/moderation-inbox?actor=operator&moderator=true")).json()).toEqual([]);
        expect(await(await call("/moderation-inbox?private=true&actor=unrelated")).json()).toEqual([]);
        expect((await call(`/moderation-resolve?private=true&id=${report.id}&actor=reporter&moderator=true`,{action:"hide",reason:"Initial review",expectedVersion:1})).status).toBe(409);
        expect((await call(`/moderation-resolve?private=true&id=${report.id}&actor=moderator-one&moderator=true`,{action:"hide",reason:"Initial review",expectedVersion:1})).status).toBe(200);
        const authorInbox=await(await call("/moderation-inbox?private=true")).text();expect(authorInbox).not.toContain("Reporter-only private context");expect(authorInbox).not.toContain('"reporterId"');
        const hidden=await(await call(`/topic?private=true&id=${moderated.id}`)).text();expect(hidden).not.toContain("Private body for reversible review");expect(hidden).not.toContain("Private descendant reply");expect(hidden).not.toContain("Private first option");
        expect(await(await call("/list?private=true&q=Private%20moderation%20original")).text()).not.toContain(moderated.id);
        expect(await(await call("/activity?private=true&q=Private%20moderation%20original")).json()).toEqual([]);
        expect(await(await call("/subscriptions?private=true&actor=subscriber")).text()).not.toContain(moderated.id);
        expect(await(await call(`/notification-available?private=true&id=${moderated.id}&entry=${moderatedReply.id}&actor=subscriber`)).json()).toBe(false);
        expect((await call(`/poll?private=true&id=${moderated.id}&actor=subscriber`,{operation:"vote",option:"Private first option"})).status).toBe(409);
        expect((await call(`/convert?private=true&id=${moderated.id}`,{expectedVersion:2,idempotencyKey:"suppressed-convert",confirmed:true})).status).toBe(409);
        expect((await call(`/edit?private=true&id=${moderated.id}`,{body:"Bypass restriction",expectedVersion:2,confirmed:true})).status).toBe(409);
        expect((await call(`/edit?private=true&id=${moderatedReply.id}&actor=reply-author`,{body:"Expose hidden descendant",expectedVersion:1,confirmed:true})).status).toBe(409);
        expect((await call(`/report?private=true&id=${moderatedReply.id}&actor=another-reporter`,{reason:"spam",note:"Known hidden reply"})).status).toBe(409);
        const hiddenRights=await(await call(`/permissions?private=true&id=${moderated.id}&actor=reply-author`)).json() as {entries:Array<{id:string;canEdit:boolean;canRemove:boolean}>};expect(hiddenRights.entries.find(row=>row.id===moderatedReply.id)).toMatchObject({canEdit:false,canRemove:false});

        expect((await call(`/moderation-appeal?private=true&id=${report.id}&actor=unrelated`,{reason:"Reconsider"})).status).toBe(409);
        expect((await call(`/moderation-appeal?private=true&id=${report.id}`,{reason:"Legitimate conversation"})).status).toBe(200);
        expect((await call(`/moderation-decide?private=true&id=${report.id}&actor=moderator-one&moderator=true`,{decision:"overturned",reason:"Reconsidered",expectedVersion:3})).status).toBe(409);
        expect((await call(`/moderation-decide?private=true&id=${report.id}&actor=moderator-two&moderator=true`,{decision:"overturned",reason:"Independent review",expectedVersion:3})).status).toBe(200);
        const restored=await(await call(`/topic?private=true&id=${moderated.id}`)).json() as {topic:DiscussionEntry;replies:DiscussionEntry[];poll:unknown};expect(restored.topic.body).toBe("Private body for reversible review");expect(restored.topic.author).toBe("Human");expect(restored.topic.removed).toBe(false);expect(restored.replies[0]?.body).toBe("Private descendant reply");expect(restored.poll).not.toBeNull();
        expect(await(await call(`/notification-available?private=true&id=${moderated.id}&entry=${moderatedReply.id}&actor=subscriber`)).json()).toBe(true);
        expect((await call("/moderation-audit?private=true&actor=unrelated")).status).toBe(409);
        expect((await(await call("/moderation-audit?private=true&actor=moderator-two&moderator=true")).json() as unknown[]).length).toBe(2);

    }
    finally {
        await mf.dispose();
    }
}, 30000);
