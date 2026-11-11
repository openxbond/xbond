import type { Connections } from "./request";

export type Connection = Connections & {
  completed?: boolean;
  closedAt?: number;
  uploadSpeed: number;
  downloadSpeed: number;
};
export class ConnectionStore {
  private connections = new Map<string, Connection>();
  private save = false;
  private sampledAt: number | undefined;
  appendToSet(connections: Connections[] | null, now = Date.now()) {
    const mapping = new Map((connections ?? []).map((c) => [c.id, c]));
    const seconds =
      this.sampledAt === undefined ? 0 : (now - this.sampledAt) / 1000;
    this.sampledAt = now;
    for (const [id, previous] of this.connections) {
      if (mapping.has(id)) continue;
      if (!this.save) this.connections.delete(id);
      else if (!previous.completed)
        this.connections.set(id, {
          ...previous,
          completed: true,
          closedAt: now,
          uploadSpeed: 0,
          downloadSpeed: 0,
        });
    }
    for (const [id, next] of mapping) {
      const previous = this.connections.get(id);
      const comparable =
        previous &&
        !previous.completed &&
        previous.start === next.start &&
        seconds > 0;
      this.connections.set(id, {
        ...next,
        completed: false,
        uploadSpeed: comparable
          ? Math.max(0, next.upload - previous.upload) / seconds
          : 0,
        downloadSpeed: comparable
          ? Math.max(0, next.download - previous.download) / seconds
          : 0,
      });
    }
    const closed = [...this.connections.values()]
      .filter((c) => c.completed)
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
    closed.forEach((c, index) => {
      if (index >= 1000 || now - (c.closedAt ?? 0) >= 30 * 60 * 1000)
        this.connections.delete(c.id);
    });
  }
  resetRate() {
    this.sampledAt = undefined;
  }
  clearClosed() {
    for (const [id, c] of this.connections)
      if (c.completed) this.connections.delete(id);
  }
  toggleSave() {
    this.save = !this.save;
    if (!this.save) this.clearClosed();
    return this.save;
  }
  getConnections() {
    return [...this.connections.values()];
  }
}
