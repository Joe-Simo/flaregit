import type { EventItem } from "./types.js";

export const EVENT_CATALOG: EventItem[] = [
  {
    id: "cf-connect-2026",
    name: "Cloudflare Connect 2026",
    venue: "Moscone West, San Francisco",
    date: "October 21, 2026",
    price: 40, // Base ticket price in dollars
  },
  {
    id: "edge-agent-summit",
    name: "Agentic Systems Summit",
    venue: "Austin Convention Center",
    date: "November 14, 2026",
    price: 50,
  },
];

export function getEvent(id: string): EventItem {
  const event = EVENT_CATALOG.find((e) => e.id === id);
  if (!event) throw new Error(`Event not found: ${id}`);
  return event;
}
