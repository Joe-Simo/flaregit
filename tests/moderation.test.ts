import {expect, test} from "bun:test";
import {APPEAL_WINDOW_MS, type AuditEntry, ModerationError, check, createModeration} from "../src/core/moderation";

const moderator = {id: "mod-1", canModerate: true};
const otherModerator = {id: "mod-2", canModerate: true};

function clockedModeration(start = 1_000) {
  let now = start;
  return {
    moderation: createModeration({now: () => now}),
    advance(ms: number) {
      now += ms;
    },
  };
}

test("a report opens with its reason, note and reporter", () => {
  const {moderation} = clockedModeration(1_000);
  const report = moderation.report({id: "post-1", authorId: "alice"}, "bob", "spam", "buy now");
  expect(report).toMatchObject({contentId: "post-1", authorId: "alice", reporterId: "bob", reason: "spam", note: "buy now", status: "open", action: null, createdAt: 1_000});
  expect(moderation.openReports()).toEqual([report]);
});

test("a reporter cannot report the same content twice, even after it is resolved", () => {
  const {moderation} = clockedModeration();
  const report = moderation.report({id: "post-1", authorId: "alice"}, "bob", "spam", "");
  expect(() => moderation.report({id: "post-1", authorId: "alice"}, "bob", "other", "")).toThrow(ModerationError);
  moderation.resolve(report.id, "dismiss", moderator, "not spam");
  expect(() => moderation.report({id: "post-1", authorId: "alice"}, "bob", "other", "")).toThrow(ModerationError);
  expect(moderation.report({id: "post-1", authorId: "alice"}, "carol", "other", "").status).toBe("open");
});

test("an author cannot report their own content", () => {
  const {moderation} = clockedModeration();
  expect(() => moderation.report({id: "post-1", authorId: "alice"}, "alice", "spam", "")).toThrow(ModerationError);
  expect(moderation.openReports()).toEqual([]);
});

test("notes are capped at 500 characters and the reason is validated", () => {
  const {moderation} = clockedModeration();
  expect(moderation.report({id: "post-1", authorId: "alice"}, "bob", "spam", "x".repeat(500)).note.length).toBe(500);
  expect(() => moderation.report({id: "post-2", authorId: "alice"}, "bob", "spam", "x".repeat(501))).toThrow(RangeError);
  expect(() => moderation.report({id: "post-3", authorId: "alice"}, "bob", "rude" as never, "")).toThrow(RangeError);
});

test("moderators need the capability and cannot act on their own content", () => {
  const {moderation} = clockedModeration();
  const report = moderation.report({id: "post-1", authorId: "alice"}, "bob", "harassment", "");
  expect(() => moderation.resolve(report.id, "hide", {id: "mod-2", canModerate: false}, "reason")).toThrow(ModerationError);
  expect(() => moderation.resolve(report.id, "hide", {id: "alice", canModerate: true}, "reason")).toThrow(ModerationError);
  expect(moderation.auditLog()).toEqual([]);
  expect(moderation.openReports()).toHaveLength(1);
});

test("each resolution is appended to an audit log that cannot be edited", () => {
  const {moderation, advance} = clockedModeration(1_000);
  const first = moderation.report({id: "post-1", authorId: "alice"}, "bob", "harassment", "");
  moderation.resolve(first.id, "hide", moderator, "targets a person");
  advance(5);
  const second = moderation.report({id: "post-2", authorId: "alice"}, "carol", "spam", "");
  moderation.resolve(second.id, "dismiss", otherModerator, "not spam");

  const log = moderation.auditLog();
  expect(log).toEqual([
    {action: "hide", moderatorId: "mod-1", reportId: first.id, at: 1_000, reason: "targets a person"},
    {action: "dismiss", moderatorId: "mod-2", reportId: second.id, at: 1_005, reason: "not spam"},
  ]);
  expect(Object.isFrozen(log)).toBe(true);
  expect(() => (log as AuditEntry[]).push(log[0] as AuditEntry)).toThrow(TypeError);
  expect(() => {
    (log[0] as {action: string}).action = "remove";
  }).toThrow(TypeError);
  expect(moderation.auditLog()[0]?.action).toBe("hide");
});

test("a resolved report cannot be resolved again", () => {
  const {moderation} = clockedModeration();
  const report = moderation.report({id: "post-1", authorId: "alice"}, "bob", "spam", "");
  moderation.resolve(report.id, "remove", moderator, "spam");
  expect(() => moderation.resolve(report.id, "dismiss", otherModerator, "changed mind")).toThrow(ModerationError);
  expect(moderation.auditLog()).toHaveLength(1);
});

test("the author can appeal a hide once, and the window includes exactly 14 days", () => {
  const {moderation, advance} = clockedModeration(0);
  const report = moderation.report({id: "post-1", authorId: "alice"}, "bob", "spam", "");
  moderation.resolve(report.id, "hide", moderator, "spam");
  advance(APPEAL_WINDOW_MS);
  const appeal = moderation.appeal(report.id, "alice");
  expect(appeal).toMatchObject({reportId: report.id, appellantId: "alice", status: "pending", decidedBy: null});
  expect(moderation.getAppeal(appeal.id)).toEqual(appeal);
  expect(() => moderation.appeal(report.id, "alice")).toThrow(ModerationError);
});

test("appeals close after 14 days from the action", () => {
  const {moderation, advance} = clockedModeration(0);
  const report = moderation.report({id: "post-1", authorId: "alice"}, "bob", "spam", "");
  moderation.resolve(report.id, "remove", moderator, "spam");
  advance(APPEAL_WINDOW_MS + 1);
  expect(() => moderation.appeal(report.id, "alice")).toThrow(ModerationError);
});

test("only the author can appeal, and only a hide or remove is appealable", () => {
  const {moderation} = clockedModeration();
  const hidden = moderation.report({id: "post-1", authorId: "alice"}, "bob", "spam", "");
  moderation.resolve(hidden.id, "hide", moderator, "spam");
  expect(() => moderation.appeal(hidden.id, "bob")).toThrow(ModerationError);

  const dismissed = moderation.report({id: "post-2", authorId: "alice"}, "bob", "spam", "");
  moderation.resolve(dismissed.id, "dismiss", moderator, "fine");
  expect(() => moderation.appeal(dismissed.id, "alice")).toThrow(ModerationError);

  const open = moderation.report({id: "post-3", authorId: "alice"}, "bob", "spam", "");
  expect(() => moderation.appeal(open.id, "alice")).toThrow(ModerationError);
});

test("a different moderator decides an appeal, and the decision is audited", () => {
  const {moderation} = clockedModeration(0);
  const report = moderation.report({id: "post-1", authorId: "alice"}, "bob", "harassment", "");
  moderation.resolve(report.id, "hide", moderator, "targets a person");
  const appeal = moderation.appeal(report.id, "alice");

  expect(() => moderation.decideAppeal(appeal.id, "upheld", moderator, "same moderator")).toThrow(ModerationError);
  expect(() => moderation.decideAppeal(appeal.id, "upheld", {id: "alice", canModerate: true}, "author")).toThrow(ModerationError);
  expect(() => moderation.decideAppeal(appeal.id, "upheld", {id: "mod-3", canModerate: false}, "no capability")).toThrow(ModerationError);

  const decided = moderation.decideAppeal(appeal.id, "overturned", otherModerator, "context shows a quotation");
  expect(decided).toMatchObject({status: "overturned", decidedBy: "mod-2"});
  expect(moderation.auditLog().at(-1)).toMatchObject({action: "appeal_overturned", moderatorId: "mod-2", reportId: report.id, reason: "context shows a quotation"});
  expect(() => moderation.decideAppeal(appeal.id, "upheld", {id: "mod-3", canModerate: true}, "again")).toThrow(ModerationError);
});

test("check allows usage up to the caller's limit and refuses beyond it with a message", () => {
  expect(check(10, "repositories", 0)).toEqual({allowed: true});
  expect(check(10, "repositories", 10)).toEqual({allowed: true});
  expect(check(10, "repositories", 11)).toEqual({allowed: false, message: "Allows up to 10 repositories; 11 exceeds it."});
});

test("check refuses invalid limits and usage", () => {
  expect(() => check(10, "members", -1)).toThrow(RangeError);
  expect(() => check(10, "members", Number.NaN)).toThrow(RangeError);
  expect(() => check(-1, "members", 0)).toThrow(RangeError);
});
