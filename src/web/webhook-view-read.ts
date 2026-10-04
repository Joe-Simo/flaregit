export async function readWebhookView<H, D>(isOwner: boolean, hooks: () => Promise<H[]>, deliveries: () => Promise<D[]>) {
  const [settings, history] = await Promise.allSettled([isOwner ? hooks() : Promise.resolve(null), deliveries()]);
  return {
    hooks: settings.status === 'fulfilled' ? settings.value : null,
    deliveries: history.status === 'fulfilled' ? history.value : null,
    failures: [settings.status === 'rejected' ? `Webhook settings: ${message(settings.reason)}` : null, history.status === 'rejected' ? `Delivery log: ${message(history.reason)}` : null].filter((value): value is string => value !== null),
  };
}
function message(value: unknown) { return value instanceof Error ? value.message : 'Unavailable'; }
