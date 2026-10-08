/** F18 slice: local community moderation. Reports, moderator actions, author appeals and plan allowances. Moderator capability is supplied by the caller; every decision is audited. */

export type ReportReason = "spam" | "harassment" | "other";
export type ModerationAction = "dismiss" | "hide" | "remove";
export type AppealDecision = "upheld" | "overturned";
export type AuditAction = ModerationAction | "appeal_upheld" | "appeal_overturned";

export const MAX_NOTE_LENGTH = 500;
/** An author may appeal a hide or remove for this long after the action was applied. */
export const APPEAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const REASONS: readonly ReportReason[] = ["spam", "harassment", "other"];
const ACTIONS: readonly ModerationAction[] = ["dismiss", "hide", "remove"];

export interface ContentRef {
  readonly id: string;
  readonly authorId: string;
}

/** Whether a user holds the moderator capability is decided by the caller; this module only enforces it. */
export interface Moderator {
  readonly id: string;
  readonly canModerate: boolean;
}

export interface ModerationOptions {
  /** Injected clock, in epoch milliseconds. */
  readonly now: () => number;
}

export interface Report {
  readonly id: string;
  readonly contentId: string;
  readonly authorId: string;
  readonly reporterId: string;
  readonly reason: ReportReason;
  readonly note: string;
  readonly status: "open" | "resolved";
  readonly action: ModerationAction | null;
  readonly resolvedBy: string | null;
  readonly resolvedAt: number | null;
  readonly createdAt: number;
}

export interface Appeal {
  readonly id: string;
  readonly reportId: string;
  readonly appellantId: string;
  readonly status: "pending" | AppealDecision;
  readonly decidedBy: string | null;
  readonly decidedAt: number | null;
  readonly createdAt: number;
}

export interface AuditEntry {
  readonly action: AuditAction;
  readonly moderatorId: string;
  readonly reportId: string;
  readonly at: number;
  /** Recorded so the audit trail explains the decision, not only its outcome. */
  readonly reason: string;
}

/** A refused domain action, as opposed to malformed input (RangeError). */
export class ModerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModerationError";
  }
}

function requireText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new RangeError(`${label} is required`);
}

export function createModeration(options: ModerationOptions) {
  const reports = new Map<string, Report>();
  const appeals = new Map<string, Appeal>();
  const audit: AuditEntry[] = [];
  let sequence = 0;
  const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

  function requireReport(reportId: string): Report {
    const report = reports.get(reportId);
    if (!report) throw new ModerationError("Report not found");
    return report;
  }

  function requireModerator(moderator: Moderator): void {
    requireText(moderator.id, "Moderator id");
    if (moderator.canModerate !== true) throw new ModerationError("Moderator capability is required");
  }

  function record(action: AuditAction, moderatorId: string, reportId: string, at: number, reason: string): void {
    audit.push(Object.freeze({action, moderatorId, reportId, at, reason}));
  }

  return {
    report(content: ContentRef, reporterId: string, reason: ReportReason, note: string): Report {
      requireText(content.id, "Content id");
      requireText(content.authorId, "Author id");
      requireText(reporterId, "Reporter id");
      if (!REASONS.includes(reason)) throw new RangeError("Unknown report reason");
      if (typeof note !== "string" || [...note].length > MAX_NOTE_LENGTH) throw new RangeError(`Report note must be at most ${MAX_NOTE_LENGTH} characters`);
      if (reporterId === content.authorId) throw new ModerationError("Authors cannot report their own content");
      if ([...reports.values()].some((existing) => existing.contentId === content.id && existing.reporterId === reporterId)) {
        throw new ModerationError("This reporter has already reported this content");
      }
      const created = Object.freeze<Report>({
        id: nextId("report"),
        contentId: content.id,
        authorId: content.authorId,
        reporterId,
        reason,
        note,
        status: "open",
        action: null,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: options.now(),
      });
      reports.set(created.id, created);
      return created;
    },

    resolve(reportId: string, action: ModerationAction, moderator: Moderator, reason: string): Report {
      const report = requireReport(reportId);
      requireModerator(moderator);
      if (!ACTIONS.includes(action)) throw new RangeError("Unknown moderation action");
      requireText(reason, "Moderation reason");
      if (moderator.id === report.authorId) throw new ModerationError("Moderators cannot act on content they authored");
      if (moderator.id === report.reporterId) throw new ModerationError("Reporters cannot resolve their own reports");
      if (report.status !== "open") throw new ModerationError("Report is already resolved");
      const at = options.now();
      const resolved = Object.freeze<Report>({...report, status: "resolved", action, resolvedBy: moderator.id, resolvedAt: at});
      reports.set(report.id, resolved);
      record(action, moderator.id, report.id, at, reason);
      return resolved;
    },

    /** Only the content author may appeal, once, for a hide or remove, within the window measured from the action. */
    appeal(reportId: string, appellantId: string): Appeal {
      requireText(appellantId, "Appellant id");
      const report = requireReport(reportId);
      if (appellantId !== report.authorId) throw new ModerationError("Only the content author can appeal");
      if (report.status !== "resolved" || (report.action !== "hide" && report.action !== "remove") || report.resolvedAt === null) {
        throw new ModerationError("Only a hide or remove can be appealed");
      }
      const now = options.now();
      if (now - report.resolvedAt > APPEAL_WINDOW_MS) throw new ModerationError("The 14-day appeal window has closed");
      if ([...appeals.values()].some((existing) => existing.reportId === report.id)) throw new ModerationError("This action has already been appealed");
      const opened = Object.freeze<Appeal>({
        id: nextId("appeal"),
        reportId: report.id,
        appellantId,
        status: "pending",
        decidedBy: null,
        decidedAt: null,
        createdAt: now,
      });
      appeals.set(opened.id, opened);
      return opened;
    },

    /** A moderator other than the one who acted, and not the content author, decides the appeal. */
    decideAppeal(appealId: string, decision: AppealDecision, moderator: Moderator, reason: string): Appeal {
      const appeal = appeals.get(appealId);
      if (!appeal) throw new ModerationError("Appeal not found");
      requireModerator(moderator);
      if (decision !== "upheld" && decision !== "overturned") throw new RangeError("Unknown appeal decision");
      requireText(reason, "Appeal reason");
      if (appeal.status !== "pending") throw new ModerationError("Appeal is already decided");
      const report = requireReport(appeal.reportId);
      if (moderator.id === report.resolvedBy) throw new ModerationError("A different moderator must decide the appeal");
      if (moderator.id === report.authorId) throw new ModerationError("Moderators cannot act on content they authored");
      if (moderator.id === report.reporterId) throw new ModerationError("Reporters cannot decide appeals for their own reports");
      const at = options.now();
      const decided = Object.freeze<Appeal>({...appeal, status: decision, decidedBy: moderator.id, decidedAt: at});
      appeals.set(appeal.id, decided);
      record(decision === "upheld" ? "appeal_upheld" : "appeal_overturned", moderator.id, report.id, at, reason);
      return decided;
    },

    /** Effective restrictions, preserving original decisions in the report and audit trail. */
    contentState(contentId: string): "visible" | "hidden" | "removed" {
      const overturned = new Set([...appeals.values()].filter((appeal) => appeal.status === "overturned").map((appeal) => appeal.reportId));
      const active = [...reports.values()].filter((report) => report.contentId === contentId && report.status === "resolved" && !overturned.has(report.id));
      if (active.some((report) => report.action === "remove")) return "removed";
      if (active.some((report) => report.action === "hide")) return "hidden";
      return "visible";
    },

    openReports(): readonly Report[] {
      return [...reports.values()].filter((report) => report.status === "open");
    },

    getAppeal(appealId: string): Appeal | undefined {
      return appeals.get(appealId);
    },

    auditLog(): readonly AuditEntry[] {
      return Object.freeze([...audit]);
    },
  };
}

/** Checks usage against a limit supplied by the caller. The module holds no plan policy; limits come from configuration. */
export type LimitCheck = {readonly allowed: true} | {readonly allowed: false; readonly message: string};

/** `current` is the usage after the proposed change; it is allowed when it does not exceed `limit`. */
export function check(limit: number, unit: string, current: number): LimitCheck {
  if (!Number.isFinite(limit) || limit < 0) throw new RangeError("Limit must be a non-negative number");
  if (!Number.isFinite(current) || current < 0) throw new RangeError("Current usage must be a non-negative number");
  if (current <= limit) return {allowed: true};
  return {allowed: false, message: `Allows up to ${limit} ${unit}; ${current} exceeds it.`};
}
