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
    name: "cek_jawaban_angka",
    description:
      "Gunakan tool ini setiap kali anak menjawab pertanyaan kuis tentang angka. " +
      "Panggil tool ini untuk mengecek apakah jawaban anak benar, jangan menilai sendiri dari ingatan.",
    inputSchema: {
      type: "object",
      properties: {
        jawaban_anak: {
          type: "string",
          description: "Teks jawaban yang diucapkan anak, misalnya '5' atau 'lima'.",
        },
        angka_target: {
          type: "number",
          description: "Angka yang seharusnya dijawab oleh anak.",
        },
      },
      required: ["jawaban_anak", "angka_target"],
    },
  },
  {
    name: "catat_ringkasan_sesi",
    description:
      "Panggil tool ini di akhir sesi belajar, atau saat terjadi momen penting " +
      "(anak berhasil hafal sesuatu, menunjukkan emosi tertentu, atau bertanya hal yang perlu diketahui orang tua). " +
      "Ringkasan ini akan bisa dilihat oleh Papa Banu dan Mama Rini.",
    inputSchema: {
      type: "object",
      properties: {
        ringkasan: {
          type: "string",
          description: "Ringkasan singkat, maksimal sekitar 200 karakter.",
        },
      },
      required: ["ringkasan"],
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

/**
 * Menjalankan satu tool call. `storage` adalah storage bawaan Durable Object
 * (this.state.storage), dipakai untuk tool yang butuh menyimpan data (mis. catat_ringkasan_sesi).
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  storage: DurableObjectStorage
): Promise<ToolResult> {
  switch (name) {
    case "cek_jawaban_angka": {
      const jawabanAnak = String(args.jawaban_anak ?? "").trim();
      const angkaTarget = Number(args.angka_target);
      const benar = String(angkaTarget) === jawabanAnak;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, benar, target: angkaTarget }),
          },
        ],
      };
    }

    case "catat_ringkasan_sesi": {
      const ringkasan = String(args.ringkasan ?? "").slice(0, 500);
      const timestamp = new Date().toISOString();
      await storage.put(`sesi:${timestamp}`, ringkasan);
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, status: "tersimpan" }) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: `Tool tidak dikenal: ${name}` }) }],
        isError: true,
      };
  }
}
