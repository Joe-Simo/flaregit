/** F08 slice: notification delivery. An inaccessible issue title never leaves the platform; muted threads and unsubscribed users get nothing. */

export interface NotificationEvent {
  readonly threadId: string;
  readonly title: string;
  readonly kind: "comment" | "mention" | "state";
}

export interface Recipient {
  readonly id: string;
  readonly canReadThread: boolean;
  readonly subscribed: boolean;
  readonly mutedThreads: readonly string[];
}

export interface Delivery {
  readonly recipientId: string;
  readonly subject: string;
}

/** Mentions reach subscribed or unsubscribed readers, but never muted threads or readers without access. */
export function deliveries(event: NotificationEvent, recipients: readonly Recipient[]): Delivery[] {
  return recipients
    .filter((recipient) => recipient.canReadThread)
    .filter((recipient) => !recipient.mutedThreads.includes(event.threadId))
    .filter((recipient) => recipient.subscribed || event.kind === "mention")
    .map((recipient) => ({recipientId: recipient.id, subject: event.title}));
}
