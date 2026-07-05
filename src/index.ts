import { McpBridge, type Env } from "./mcp-bridge";

export { McpBridge };

function getBridgeStub(env: Env) {
  const id = env.MCP_BRIDGE.idFromName("singleton");
  return env.MCP_BRIDGE.get(id);
}

export default {
  /**
   * HTTP entrypoint. Dipakai untuk:
   *  - GET /        -> status singkat
   *  - GET /status   -> status koneksi + daftar tools terdaftar
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const stub = getBridgeStub(env);

    if (url.pathname === "/status" || url.pathname === "/ping") {
      return stub.fetch(request);
    }

    return new Response(
      "XiaoZhi MCP Bridge aktif. Endpoint: /status, /ping",
      { status: 200 }
    );
  },

  /**
   * Cron trigger (lihat wrangler.toml, default tiap 1 menit).
   * Fungsinya memastikan Durable Object tetap hidup dan otomatis
   * reconnect kalau koneksi WebSocket ke XiaoZhi sempat putus.
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const stub = getBridgeStub(env);
    ctx.waitUntil(stub.fetch(new Request("https://internal.local/ping")));
  },
};
