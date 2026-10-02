const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const repository = "p?[0-9a-f]{12}";
const patterns = [
  new RegExp(`^/community#repo=${repository}&topic=discussion_${uuid}&entry=discussion_${uuid}$`),
  new RegExp(`^/#/p/${repository}/discussions\\?topic=discussion_${uuid}&entry=discussion_${uuid}$`),
  new RegExp(`^/community#view=help&topic=forum_${uuid}&entry=forum_${uuid}$`),
  /^\/#\/profile\/[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/,
];
/** Only app-owned relative references, never redirect destinations or authored URLs. */
export function safeReportTarget(value: string | null): string | null {
  return value && value.length <= 300 && patterns.some(pattern => pattern.test(value)) ? value : null;
}
