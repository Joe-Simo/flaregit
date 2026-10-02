import { expect, test } from "bun:test";
import { accountKeyFor, adoptLegacyProject } from "../src/server/projects.js";
import type { Ledger, ProjectRow } from "../src/server/durable-object.js";
import type { Env } from "../src/server/env.js";

function fixture(formerKey: string, subject: string) {
  const saved: Array<{ id: string; role: string }> = [];
  const projectId = "pabcdef123456";
  const env = { REPOSITORY_CONTROLLER: {
    idFromName: (name: string) => name,
    get: (name: string) => {
      if (name === `account:${formerKey}`) return { listProjects: async () => [{ id: projectId, name: "old metadata", role: "owner", kind: "import" }] };
      if (name === `project:${projectId}` || name === `project:${formerKey}`) return {
        roleOf: async (userId: string) => userId === subject ? "member" : null,
        getState: async () => ({ projectName: "verified repository", kind: "import" }),
        addMember: async () => { throw new Error("Migration must never grant membership"); },
      };
      return { roleOf: async () => null };
    },
  } } as unknown as Env;
  const account = { addProject: async (row: { id: string; role: string }) => { saved.push(row); }, listProjects: async () => saved as ProjectRow[] } as unknown as Ledger;
  return { env, account, saved, projectId };
}

test("mixed-case subject recovers references only with exact membership", async () => {
  const subject = "User_CASE";
  const formerKey = await accountKeyFor(subject.toLowerCase());
  const f = fixture(formerKey, subject);
  await adoptLegacyProject(f.env, f.account, await accountKeyFor(subject), subject);
  expect(f.saved.map((row) => row.id).sort()).toEqual([formerKey, f.projectId].sort());
  expect(f.saved.every((row) => row.role === "member")).toBe(true);
});

test("case-colliding identity cannot inherit references or ownership", async () => {
  const rightfulSubject = "User_CASE";
  const otherSubject = "USER_case";
  const formerKey = await accountKeyFor(rightfulSubject.toLowerCase());
  const f = fixture(formerKey, rightfulSubject);
  await adoptLegacyProject(f.env, f.account, await accountKeyFor(otherSubject), otherSubject);
  expect(f.saved).toHaveLength(0);
});
