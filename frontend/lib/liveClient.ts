// Live transport client: REST for the static network + commands, WebSocket for
// the streaming twin snapshots. Auto-reconnects. If the backend is unreachable
// the caller falls back to the in-browser simulation engine.
import type { NetworkDTO, TwinSnapshotDTO } from "./contract";

const HTTP_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";
const WS_BASE = HTTP_BASE.replace(/^http/, "ws");

export type Command =
  | { action: "control"; playing?: boolean; time_scale?: number; seek_sec?: number }
  | { action: "apply"; conflict_id: string }
  | { action: "autonomous"; enabled: boolean }
  | { action: "inject"; kind: string; train?: string; section?: string }
  | { action: "whatif"; command: string };

export class LiveClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  onSnapshot: (s: TwinSnapshotDTO) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};

  async fetchNetwork(signal?: AbortSignal): Promise<NetworkDTO> {
    const res = await fetch(`${HTTP_BASE}/network`, { signal });
    if (!res.ok) throw new Error(`network ${res.status}`);
    return res.json();
  }

  async health(timeoutMs = 1500): Promise<boolean> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${HTTP_BASE}/health`, { signal: ctrl.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  connect() {
    this.closed = false;
    this.open();
  }

  private open() {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(`${WS_BASE}/stream`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => this.onStatus(true);
    this.ws.onmessage = (ev) => {
      try {
        this.onSnapshot(JSON.parse(ev.data));
      } catch {
        /* ignore malformed frame */
      }
    };
    this.ws.onclose = () => {
      this.onStatus(false);
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, 1500);
  }

  send(cmd: Command) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    } else {
      // fall back to REST for commands if the socket isn't open yet
      this.sendRest(cmd);
    }
  }

  private async sendRest(cmd: Command) {
    try {
      if (cmd.action === "control")
        await post("/control", cmd);
      else if (cmd.action === "apply")
        await post("/apply", { conflict_id: cmd.conflict_id });
      else if (cmd.action === "autonomous")
        await post("/autonomous", { enabled: cmd.enabled });
      else if (cmd.action === "inject")
        await fetch(
          `${HTTP_BASE}/inject/${cmd.kind}` +
            (cmd.train ? `?train=${cmd.train}` : cmd.section ? `?section=${cmd.section}` : ""),
          { method: "POST" }
        );
      else if (cmd.action === "whatif") await post("/whatif", { command: cmd.command });
    } catch {
      /* ignore */
    }
  }

  async whatif(command: string): Promise<{ explanation: string } | null> {
    try {
      const res = await post("/whatif", { command });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  disconnect() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

function post(path: string, body: unknown) {
  return fetch(`${HTTP_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export const BACKEND_HTTP = HTTP_BASE;
