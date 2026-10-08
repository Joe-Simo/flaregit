/** F01: read-only guard for repository writes made outside the /p/:id project routes. */

export const ARCHIVED_WRITE_MESSAGE = "Repository is archived and read-only; unarchive it to change anything";

/** Returns a 409 refusal for any non-GET request while the repository is archived; otherwise null. */
export async function archivedWriteRefusal(
  project: { repositoryLifecycle(): Promise<{ readonly state: string }> },
  method: string,
): Promise<Response | null> {
  if (method === "GET" || method === "HEAD") return null;
  const lifecycle = await project.repositoryLifecycle();
  if (lifecycle.state !== "archived") return null;
  return new Response(ARCHIVED_WRITE_MESSAGE, { status: 409 });
}
