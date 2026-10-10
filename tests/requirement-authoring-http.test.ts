import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { workerdChild } from "./support/workerd-child";
import { buildAgentPrompt } from "../src/agents/prompt";
import type { ProductDecision, Requirement, Task } from "../src/core/types";

const FILE = "tests/requirement-authoring-http.test.ts";
const NAME = "requirements written when starting changes are saved, replayed exactly and reach the contradiction proof";

const example = (expected: number) => ({ module: "src/pricing.ts", export: "calculateQuote", input: { ticketCount: 4, basePrice: 40 }, expectedOutput: { total: expected } });
const discount = { taskId: "group-discount", goal: "Give groups a discount", requirements: [{ title: "Group discount", statement: "Orders of 4 or more tickets get 15% off.", example: example(136) }] };
const fixed = { taskId: "fixed-price", goal: "Keep prices predictable", requirements: [{ title: "Price never changes", statement: "Every ticket costs the base price, whatever the order size.", example: example(160) }, { title: "Receipts list each ticket", statement: "A receipt shows one line per ticket." }] };

test(NAME, async () => {
  if (await workerdChild(FILE, NAME)) return;
  const keys = await generateKeyPair("RS256"), jwk = { ...(await exportJWK(keys.publicKey)), kid: "requirements", alg: "RS256", use: "sig" };
  const issuer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ keys: [jwk] }) });
  const file = `/tmp/flaregit-requirements-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, "build", "tests/support/requirement-authoring-http-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:*", `--outfile=${file}`], { stdout: "ignore", stderr: "pipe" });
  const [error, code] = await Promise.all([new Response(build.stderr).text(), build.exited]);
  if (code) { issuer.stop(); throw Error(error); }
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "requirements", modules: true, script: await Bun.file(file).text(), compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], bindings: { FIXTURE_ISSUER: issuer.url.origin, CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS: "2500000", CORE_GIT_GLOBAL_MONTHLY_USD_MICROS: "5000000", REPOSITORY_READ_ACCOUNT_MONTHLY_USD_MICROS: "1000000", REPOSITORY_READ_GLOBAL_MONTHLY_USD_MICROS: "2000000" }, durableObjects: { REPOSITORY_CONTROLLER: { className: "RequirementAuthoringFixture", useSQLite: true } } }] }));
  const call = async (path: string, token?: string, body?: unknown) => (await mf.getWorker("requirements")).fetch(`http://fixture${path}`, { method: body === undefined ? "GET" : "POST", headers: { "CF-Connecting-IP": "198.51.100.80", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async <T>(path: string, body?: unknown): Promise<T> => { const response = await call(path, undefined, body); const text = await response.text(); if (!response.ok) throw Error(`${path} ${response.status}: ${text}`); return JSON.parse(text) as T; };
  const route = "/api/p/p123456789abc/tasks";
  try {
    expect((await call("/fixture/seed")).status).toBe(200);
    const token = await new SignJWT({ azp: "https://fixture.example" }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer(issuer.url.origin).setSubject("contributor").setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);

    // Validation happens before any workspace is allocated.
    const invalid = [
      { title: "", statement: "x" },
      { title: "T", statement: "S", example: { ...example(1), module: "../outside.ts" } },
      { title: "T", statement: "S", example: { ...example(1), module: "lib/pricing.ts" } },
      { title: "T", statement: "S", example: { ...example(1), export: "not a name" } },
      { title: "T", statement: "S", example: { ...example(1), input: [4, 40] } },
      { title: "T", statement: "S", example: { ...example(1), input: { blob: "x".repeat(5000) } } },
    ];
    for (const requirement of invalid) expect((await call(route, token, { taskId: "invalid-change", goal: "Rejected", requirements: [requirement] })).status).toBe(400);
    expect((await call(route, token, { taskId: "invalid-change", goal: "Rejected", requirements: Array.from({ length: 9 }, (_, index) => ({ title: `R${index}`, statement: "S" })) })).status).toBe(400);
    expect((await json<{ intents: unknown[] }>("/fixture/snapshot")).intents).toEqual([]);

    for (const input of [discount, fixed]) {
      const created = await call(route, token, input);
      if (created.status !== 201) throw Error(`Creation ${created.status}: ${await created.text()}`);
    }
    let snapshot = await json<{ tasks: Record<string, Task>; intents: Array<{ taskId: string; input: { requirements?: unknown } }> }>("/fixture/snapshot");
    const saved = snapshot.tasks["group-discount"]!;
    expect(saved.requirements).toEqual([{ id: "REQ-group-discount-1", title: "Group discount", description: "Orders of 4 or more tickets get 15% off.", version: 1, status: "approved", originTaskId: "group-discount", approvedAt: saved.createdAt, assertions: [{ id: "REQ-group-discount-1-example", description: "Orders of 4 or more tickets get 15% off.", input: { ticketCount: 4, basePrice: 40 }, expectedOutput: { total: 136 }, probe: { module: "src/pricing.ts", export: "calculateQuote" } }] } satisfies Requirement]);
    expect(snapshot.tasks["fixed-price"]!.requirements.map((requirement) => [requirement.id, requirement.assertions.length])).toEqual([["REQ-fixed-price-1", 1], ["REQ-fixed-price-2", 0]]);
    expect(snapshot.intents.find((intent) => intent.taskId === "fixed-price")?.input.requirements).toEqual(fixed.requirements);

    // The same request replays the saved change; different requirements are a different request.
    const replay = await call(route, token, discount);
    expect(replay.status).toBe(200);
    expect((await replay.json() as { replayed: boolean }).replayed).toBe(true);
    expect((await call(route, token, { ...discount, requirements: [{ ...discount.requirements[0]!, example: example(140) }] })).status).toBe(409);
    expect((await call(route, token, { taskId: discount.taskId, goal: discount.goal })).status).toBe(409);
    expect((await json<{ tasks: Record<string, Task> }>("/fixture/snapshot")).tasks["group-discount"]).toEqual(saved);

    // An agent working on the change is told the requirement and the example it must satisfy.
    const prompt = buildAgentPrompt(saved, "FlareGit agent", {});
    expect(prompt).toContain("Group discount: Orders of 4 or more tickets get 15% off.");
    expect(prompt).toContain('calculateQuote({"ticketCount":4,"basePrice":40}) from src/pricing.ts must return {"total":136}');

    // Combining both changes stops for a decision, and running each side proves the contradiction.
    await json("/fixture/ready", [{ id: "group-discount", commit: "b".repeat(40) }, { id: "fixed-price", commit: "c".repeat(40) }]);
    const { decision } = await json<{ decision?: ProductDecision }>("/fixture/combine", ["group-discount", "fixed-price"]);
    expect(decision?.status).toBe("pending");
    expect(decision?.conflictingRequirementIds).toEqual(["REQ-group-discount-1", "REQ-fixed-price-1"]);
    snapshot = await json("/fixture/snapshot");
    expect([snapshot.tasks["group-discount"]!.status, snapshot.tasks["fixed-price"]!.status]).toEqual(["needs_decision", "needs_decision"]);
    const proved = await json<{ result: { verdict: string; summary: string }; probes: number }>("/fixture/prove", { decisionId: decision!.id });
    expect(proved.probes).toBe(2);
    expect(proved.result.verdict).toBe("proven");
    expect(proved.result.summary).toContain("returns total 136");
    expect(proved.result.summary).toContain("returns total 160");
  } finally {
    await mf.dispose();
    issuer.stop();
    await Bun.file(file).delete();
  }
}, 60_000);
