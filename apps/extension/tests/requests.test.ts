import assert from "node:assert/strict";
import { test } from "node:test";

import { reduceRequests } from "../src/background/requests.ts";

test("request records contain only domains and bounded metadata, never paths or secrets", () => {
  const records = reduceRequests([], "start", {
    requestId: "r",
    url: "https://name:password@docs.example.org/private?token=secret#fragment",
    type: "main_frame",
    timeStamp: 100,
  });
  assert.equal(records[0].host, "docs.example.org");
  assert.doesNotMatch(
    JSON.stringify(records),
    /password|private|secret|token|fragment/,
  );
  const completed = reduceRequests(records, "completed", {
    requestId: "r",
    url: "https://docs.example.org/private",
    timeStamp: 145,
  });
  assert.equal(completed[0].duration, 45);
  assert.equal(completed[0].status, "completed");
});
test("request retention is bounded and completion after clearing cannot recreate a record", () => {
  let records = reduceRequests([], "start", {
    requestId: 0,
    url: "https://example.org",
  });
  for (let i = 1; i < 550; i++)
    records = reduceRequests(records, "start", {
      requestId: i,
      url: "https://example.org",
    });
  assert.equal(records.length, 500);
  assert.equal(records[0].id, "50");
  assert.deepEqual(
    reduceRequests([], "completed", {
      requestId: 3,
      url: "https://example.org",
    }),
    [],
  );
  assert.deepEqual(
    reduceRequests([], "start", {
      requestId: 4,
      url: "https://example.org",
      initiator: "chrome-extension://own",
    }),
    [],
  );
});
