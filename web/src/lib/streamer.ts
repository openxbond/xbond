import EventEmitter from "eventemitter3";

export type StreamState = "connecting" | "open" | "reconnecting" | "closed";
export interface Config {
  bufferLength?: number;
  retryInterval?: number;
}
export class StreamReader<T> {
  private EE = new EventEmitter();
  private innerBuffer: T[] = [];
  private url = "";
  private connection: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private generation = 0;
  private state: StreamState = "closed";
  private config: Required<Config>;
  constructor(config: Config = {}) {
    this.config = { bufferLength: 0, retryInterval: 1000, ...config };
  }
  private setState(state: StreamState) {
    this.state = state;
    this.EE.emit("state", state);
  }
  private open(generation: number) {
    if (!this.url || generation !== this.generation) return;
    this.setState(this.attempts ? "reconnecting" : "connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.retry(generation);
      return;
    }
    this.connection = socket;
    socket.addEventListener("open", () => {
      if (generation !== this.generation) return;
      this.attempts = 0;
      this.setState("open");
    });
    socket.addEventListener("message", (msg) => {
      if (generation !== this.generation) return;
      try {
        const data = JSON.parse(msg.data) as T;
        if (this.config.bufferLength > 0)
          this.innerBuffer = [...this.innerBuffer, data].slice(
            -this.config.bufferLength,
          );
        this.EE.emit("data", [data]);
      } catch (err) {
        this.EE.emit("parse-error", err);
      }
    });
    socket.addEventListener("error", () => {
      if (generation !== this.generation) return;
      socket.close();
      this.retry(generation);
    });
    socket.addEventListener("close", () => {
      if (generation !== this.generation) return;
      this.connection = null;
      this.retry(generation);
    });
  }
  private retry(generation: number) {
    if (!this.url || generation !== this.generation || this.timer !== undefined)
      return;
    this.setState("reconnecting");
    const delay = Math.min(
      30000,
      this.config.retryInterval * 2 ** this.attempts++,
    );
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.open(++this.generation);
    }, delay);
  }
  connect(url: string) {
    if (this.url === url && (this.connection || this.timer !== undefined))
      return;
    this.disconnect();
    this.url = url;
    this.open(this.generation);
  }
  subscribe(event: string, callback: (data: T[]) => void) {
    this.EE.on(event, callback);
  }
  unsubscribe(event: string, callback: (data: T[]) => void) {
    this.EE.off(event, callback);
  }
  subscribeState(callback: (state: StreamState) => void) {
    this.EE.on("state", callback);
    callback(this.state);
    return () => {
      this.EE.off("state", callback);
    };
  }
  buffer() {
    return this.innerBuffer.slice();
  }
  clear() {
    this.innerBuffer = [];
  }
  disconnect() {
    this.generation++;
    this.url = "";
    clearTimeout(this.timer);
    this.timer = undefined;
    this.connection?.close();
    this.connection = null;
    this.attempts = 0;
    this.setState("closed");
  }
  destroy() {
    this.disconnect();
    this.clear();
    this.EE.removeAllListeners();
  }
}
