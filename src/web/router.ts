import { useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "new" }
  | { name: "account" }
  | { name: "inbox" }
  | { name: "join"; projectId: string; token: string }
  | { name: "repo"; projectId: string; tab: string; params: URLSearchParams };

export function parseHash(hash: string): Route {
  const [pathPart, query = ""] = hash.replace(/^#/, "").split("?");
  const parts = (pathPart ?? "").split("/").filter(Boolean);
  if (parts[0] === "new") return { name: "new" };
  if (parts[0] === "account") return { name: "account" };
  if (parts[0] === "inbox") return { name: "inbox" };
  if (parts[0] === "join" && parts[1] && parts[2]) return { name: "join", projectId: parts[1], token: parts[2] };
  if (parts[0] === "p" && parts[1]) return { name: "repo", projectId: parts[1], tab: parts[2] ?? "code", params: new URLSearchParams(query) };
  return { name: "home" };
}

export function navigate(to: string): void {
  window.location.hash = to;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function timeAgo(seconds: number | string): string {
  const t = typeof seconds === "number" ? seconds * 1000 : Date.parse(seconds);
  const diff = Math.max(0, Date.now() - t) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 60) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}
