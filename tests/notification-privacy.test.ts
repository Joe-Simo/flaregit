import {expect, test} from "bun:test";
import {deliveries, type Recipient} from "../src/core/notification-privacy";

const base: Recipient = {id: "a", canReadThread: true, subscribed: true, mutedThreads: []};

test("recipients without access never receive the title", () => {
  const result = deliveries({threadId: "t1", title: "Secret", kind: "comment"}, [base, {...base, id: "b", canReadThread: false}]);
  expect(result.map((delivery) => delivery.recipientId)).toEqual(["a"]);
});

test("muted threads and unsubscribed users get no ordinary events", () => {
  const event = {threadId: "t1", title: "T", kind: "comment"} as const;
  expect(deliveries(event, [{...base, mutedThreads: ["t1"]}, {...base, id: "c", subscribed: false}])).toEqual([]);
});

test("mentions reach unsubscribed readers but not muted ones", () => {
  const event = {threadId: "t1", title: "T", kind: "mention"} as const;
  const result = deliveries(event, [{...base, id: "c", subscribed: false}, {...base, id: "d", mutedThreads: ["t1"]}]);
  expect(result.map((delivery) => delivery.recipientId)).toEqual(["c"]);
});
