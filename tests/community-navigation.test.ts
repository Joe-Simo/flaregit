import { expect, test } from "bun:test";
import { parseHash } from "../src/web/router";

test("community discovery and help remain distinct workspace destinations", () => {
  expect(parseHash("#/community").name).toBe("community");
  const help = parseHash("#/community?view=help&topic=forum_12345678-1234-4234-8234-123456789012");
  expect(help.name).toBe("community");
  if (help.name !== "community") throw new Error("Expected community route");
  expect(help.params.get("view")).toBe("help");
  expect(help.params.get("topic")).toBe("forum_12345678-1234-4234-8234-123456789012");
});

test("repository discussion links retain their repository and thread in workspace", () => {
  const thread = parseHash("#/community?repo=p123456789012&topic=discussion_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  expect(thread.name).toBe("community");
  if (thread.name !== "community") throw new Error("Expected community route");
  expect(thread.params.get("repo")).toBe("p123456789012");
  expect(thread.params.get("topic")).toBe("discussion_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
});

test("public contribution composer and private member discussion routes stay separate", () => {
  expect(parseHash("#/community-post?repo=p123456789012&topic=discussion_12345678-1234-4234-8234-123456789012").name).toBe("community-post");
  const member = parseHash("#/p/p123456789012/discussions?topic=discussion_12345678-1234-4234-8234-123456789012");
  expect(member.name).toBe("repo");
  if (member.name !== "repo") throw new Error("Expected member repository route");
  expect(member.tab).toBe("discussions");
  expect(member.params.get("topic")).toBe("discussion_12345678-1234-4234-8234-123456789012");
});
