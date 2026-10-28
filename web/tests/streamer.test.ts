import assert from "node:assert/strict";
import { test } from "node:test";

import { StreamReader } from "../src/lib/streamer.ts";

class Socket {
  static instances: Socket[] = [];
  events = new Map<string, ((event?: unknown) => void)[]>();
  url: string;
  constructor(url: string) {
    this.url = url;
    Socket.instances.push(this);
  }
  addEventListener(name: string, callback: (event?: unknown) => void) {
    this.events.set(name, [...(this.events.get(name) ?? []), callback]);
  }
  emit(name: string, event?: unknown) {
    for (const callback of this.events.get(name) ?? []) callback(event);
  }
  close() {
    this.emit("close");
  }
}
test("streams reconnect on close, ignore obsolete sockets, tolerate invalid JSON and cancel pending retries", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = globalThis.WebSocket;
  Object.defineProperty(globalThis, "WebSocket", {
    value: Socket,
    configurable: true,
  });
  t.after(() =>
    Object.defineProperty(globalThis, "WebSocket", {
      value: original,
      configurable: true,
    }),
  );
  const reader = new StreamReader<{ value: number }>({
    bufferLength: 2,
    retryInterval: 100,
  });
  const received: number[] = [];
  reader.subscribe("data", (items) => received.push(items[0].value));
  reader.connect("ws://127.0.0.1:9090/logs");
  const first = Socket.instances[0];
  first.emit("open");
  first.emit("close");
  t.mock.timers.tick(100);
  assert.equal(Socket.instances.length, 2);
  const second = Socket.instances[1];
  second.emit("open");
  first.emit("message", { data: '{"value":999}' });
  second.emit("message", { data: "invalid JSON" });
  for (const value of [1, 2, 3])
    second.emit("message", { data: JSON.stringify({ value }) });
  assert.deepEqual(received, [1, 2, 3]);
  assert.deepEqual(reader.buffer(), [{ value: 2 }, { value: 3 }]);
  second.emit("error");
  reader.disconnect();
  t.mock.timers.tick(60000);
  assert.equal(Socket.instances.length, 2);
  reader.connect("ws://127.0.0.1:9091/logs");
  assert.equal(Socket.instances.length, 3);
  second.emit("message", { data: '{"value":999}' });
  assert.deepEqual(received, [1, 2, 3]);
  reader.destroy();
  assert.deepEqual(reader.buffer(), []);
});
