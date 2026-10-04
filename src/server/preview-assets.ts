/** index.html is the final readiness signal; reject the whole listing first. */
export function orderedPreviewAssets(listing: string): string[] {
  const files = listing.split("\n").filter(Boolean).map((file) => file.replace(/^\.\//, ""));
  if (!files.includes("index.html") || new Set(files).size !== files.length || files.length > 1000) throw new Error("Preview asset manifest is invalid");
  if (files.some((file) => file.startsWith("/") || file.includes("\\") || /[\x00-\x1f\x7f]/.test(file) || file.split("/").some((part) => !part || part === "." || part === ".."))) throw new Error("Preview asset path is invalid");
  return [...files.filter((file) => file !== "index.html").sort(), "index.html"];
}
