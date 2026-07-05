/**
 * Definisi tools MCP untuk robot AI TK Islam Terpadu.
 *
 * Tambahkan tool baru dengan cara:
 *  1. Tambahkan entri baru ke TOOL_DEFINITIONS (nama, description, inputSchema)
 *  2. Tambahkan case baru di executeTool()
 *
 * Ikuti aturan resmi XiaoZhi (lihat README.md):
 *  - Nama tool & parameter harus deskriptif, jangan disingkat
 *  - Description harus menjelaskan KAPAN tool ini dipanggil, bukan cuma APA fungsinya
 *  - Return value diusahakan ringkas (idealnya di bawah ~1024 byte)
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "cari_informasi_terkini",
    description:
      "Gunakan tool ini HANYA saat anak bertanya fakta umum atau hal yang butuh informasi terkini yang tidak ada " +
      "di pengetahuan dasarmu (misalnya 'kenapa langit biru', 'hewan terbesar di dunia', 'apa itu pelangi'). " +
      "JANGAN gunakan untuk topik sensitif, menakutkan, kekerasan, atau dewasa -- untuk itu tetap arahkan anak " +
      "bertanya ke Papa Banu atau Mama Rini, jangan panggil tool ini.",
    inputSchema: {
      type: "object",
      properties: {
        pertanyaan: {
          type: "string",
          description: "Pertanyaan anak, ditulis ulang dalam bahasa yang jelas dan sederhana.",
        },
      },
      required: ["pertanyaan"],
    },
  },
];

export interface ToolContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface ToolContext {
  tavilyApiKey?: string;
}

/**
 * Menjalankan satu tool call. `ctx.tavilyApiKey` dipakai untuk tool yang
 * memanggil layanan eksternal (mis. cari_informasi_terkini).
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  switch (name) {
    case "cari_informasi_terkini": {
      const pertanyaan = String(args.pertanyaan ?? "").trim();

      if (!ctx.tavilyApiKey) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: "TAVILY_API_KEY belum diset di server" }) }],
          isError: true,
        };
      }
      if (!pertanyaan) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: "Pertanyaan kosong" }) }],
          isError: true,
        };
      }

      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ctx.tavilyApiKey}`,
          },
          body: JSON.stringify({
            query: pertanyaan,
            search_depth: "basic",
            max_results: 3,
            include_answer: true,
          }),
        });

        if (!res.ok) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, error: `Tavily error ${res.status}` }) }],
            isError: true,
          };
        }

        const data = (await res.json()) as { answer?: string; results?: Array<{ title: string; url: string }> };
        const jawaban = data.answer ?? "Tidak ditemukan jawaban singkat untuk pertanyaan ini.";
        const sumber = (data.results ?? []).slice(0, 2).map((r) => r.title);

        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, jawaban, sumber }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(err) }) }],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: `Tool tidak dikenal: ${name}` }) }],
        isError: true,
      };
  }
}
