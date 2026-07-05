import { TOOL_DEFINITIONS, executeTool } from "./tools";
import type { Env } from "./env";

export type { Env };

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * Durable Object yang berperan sebagai pengganti `mcp_pipe.py`:
 * - Membuka koneksi WebSocket keluar (outbound) ke MCP_ENDPOINT milik XiaoZhi
 * - Menerjemahkan pesan JSON-RPC (initialize, tools/list, tools/call) langsung
 *   di JavaScript, tanpa subprocess Python
 * - Reconnect otomatis dengan exponential backoff kalau koneksi terputus
 *
 * CATATAN PENTING (baca README.md bagian "Asumsi Teknis yang Perlu Diverifikasi"):
 * Implementasi ini mengasumsikan setiap pesan JSON-RPC dikirim sebagai satu frame
 * WebSocket utuh (tanpa newline-delimited framing seperti pada stdio Python).
 * Ini adalah asumsi yang paling masuk akal berdasarkan cara kerja `mcp_pipe.py`
 * yang murni membridging byte, namun belum diverifikasi dari source code aslinya.
 * WAJIB DITES setelah deploy (lihat langkah verifikasi di README.md).
 */
export class McpBridge implements DurableObject {
  private ws: WebSocket | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {
    this.state.blockConcurrencyWhile(async () => {
      await this.connectToXiaoZhi();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ping") {
      if (!this.ws || this.ws.readyState !== WebSocket.READY_STATE_OPEN) {
        await this.connectToXiaoZhi();
      }
      return new Response(
        JSON.stringify({ status: this.ws?.readyState === WebSocket.READY_STATE_OPEN ? "connected" : "disconnected" }),
        { headers: { "content-type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        status: this.ws?.readyState === WebSocket.READY_STATE_OPEN ? "connected" : "disconnected",
        tools: TOOL_DEFINITIONS.map((t) => t.name),
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  async alarm(): Promise<void> {
    await this.connectToXiaoZhi();
  }

  private async connectToXiaoZhi(): Promise<void> {
    if (!this.env.MCP_ENDPOINT) {
      console.error("MCP_ENDPOINT belum diset. Jalankan: wrangler secret put MCP_ENDPOINT");
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.READY_STATE_OPEN) {
      return; // sudah terhubung
    }

    try {
      const ws = new WebSocket(this.env.MCP_ENDPOINT);
      this.ws = ws;

      ws.addEventListener("open", () => {
        this.reconnectDelay = RECONNECT_MIN_MS;
        console.log("Terhubung ke XiaoZhi MCP endpoint.");
      });

      ws.addEventListener("message", (event: MessageEvent) => {
        this.handleMessage(event.data).catch((err) => console.error("Gagal memproses pesan:", err));
      });

      ws.addEventListener("close", () => {
        console.log("Koneksi ke XiaoZhi terputus, menjadwalkan reconnect.");
        this.ws = null;
        this.scheduleReconnect();
      });

      ws.addEventListener("error", (event: Event) => {
        console.error("Error pada koneksi WebSocket:", event);
      });
    } catch (err) {
      console.error("Gagal membuka koneksi WebSocket:", err);
      this.scheduleReconnect();
    }
  }

  private async scheduleReconnect(): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.READY_STATE_OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private async handleMessage(data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== "string") return;

    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(data);
    } catch {
      console.error("Pesan bukan JSON valid, diabaikan:", data);
      return;
    }

    // Log diagnostik sementara: lihat SETIAP method yang masuk dari XiaoZhi,
    // termasuk yang tidak ditangani. Hapus/kecilkan setelah debugging selesai.
    console.log(`[MCP] method masuk: ${msg.method}`, msg.params ?? "");

    switch (msg.method) {
      case "initialize":
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "tk-islam-terpadu-tools", version: "1.0.0" },
          },
        });
        break;

      case "notifications/initialized":
        // Notifikasi, tidak perlu response.
        break;

      case "tools/list":
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          result: { tools: TOOL_DEFINITIONS },
        });
        break;

      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
        const result = await executeTool(name, args, {
          tavilyApiKey: this.env.TAVILY_API_KEY,
        });
        this.send({ jsonrpc: "2.0", id: msg.id, result });
        break;
      }

      default:
        console.log("Method tidak ditangani:", msg.method);
    }
  }
}
