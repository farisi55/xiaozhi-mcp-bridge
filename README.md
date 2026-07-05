# XiaoZhi MCP Bridge (Cloudflare Workers + Durable Objects)

Bridge MCP custom untuk agent XiaoZhi AI (robot TK Islam Terpadu), di-deploy ke Cloudflare, tanpa perlu VM/server terpisah untuk menjaga koneksi tetap hidup.

## Kenapa Ini "Worker + Durable Objects", Bukan "Pages" Murni

Permintaan awal adalah project Cloudflare Pages. Setelah dicek ke dokumentasi resmi Cloudflare, ada dua fakta yang mengubah pendekatannya:

1. Pola resmi XiaoZhi (`mcp_pipe.py`) butuh **koneksi WebSocket yang hidup terus-menerus** ke `wss://api.xiaozhi.me/mcp/?token=...`, dengan reconnect otomatis. Ini butuh compute yang stateful/persisten, bukan model request-response biasa.
2. Cloudflare Pages **tidak bisa mendefinisikan Durable Object di dalam project Pages itu sendiri** — dokumentasi resminya eksplisit menyebut "You cannot create and deploy a Durable Object within a Pages project." Durable Object wajib didefinisikan di project Workers, baru di-bind ke Pages kalau mau dipakai dari sana.

Karena kebutuhan intinya murni tentang menjaga koneksi tetap hidup (bukan menyajikan halaman statis), project ini dibuat sebagai **Cloudflare Worker** langsung — masih pakai `wrangler.toml`, masih `wrangler deploy`, masih env variable/secret dari dashboard yang sama, cuma bukan dengan `wrangler pages deploy`. Secara praktis, workflow-nya identik dengan yang biasa kamu pakai untuk Cloudflare Pages.

Kabar baiknya: Durable Objects dengan SQLite storage backend (yang dipakai project ini) tersedia di **Workers Free plan** — tidak wajib upgrade ke Paid plan.

## Struktur Project

```
xiaozhi-mcp-bridge/
├── wrangler.toml           # Konfigurasi Worker, Durable Object binding, cron trigger
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            # Entry point: fetch handler + cron scheduled handler
│   ├── mcp-bridge.ts        # Durable Object: koneksi WebSocket + protokol JSON-RPC MCP
│   └── tools/
│       └── index.ts        # Definisi & implementasi tools (cari_informasi_terkini)
├── .github/workflows/
│   └── deploy.yml           # Auto-deploy ke Cloudflare saat push ke main
├── .dev.vars.example        # Contoh env var untuk development lokal
└── .gitignore
```

## Asumsi Teknis yang Perlu Diverifikasi

Implementasi `mcp-bridge.ts` menerjemahkan protokol MCP (`initialize`, `tools/list`, `tools/call`) langsung dalam JavaScript, menggantikan peran `mcp_pipe.py` + subprocess Python.

Asumsi yang saya pakai: setiap pesan JSON-RPC dikirim sebagai **satu frame WebSocket utuh** (karena WebSocket sudah punya framing bawaan, beda dengan stdio yang butuh newline-delimited). Ini asumsi paling masuk akal berdasarkan cara kerja `mcp_pipe.py` yang murni membridging byte antara WebSocket dan stdio subprocess — tapi saya tidak punya akses ke source code `mcp_pipe.py` untuk memverifikasi ini byte-per-byte.

**Wajib ditest setelah deploy** — lihat bagian Verifikasi di bawah. Kalau ternyata tidak jalan karena masalah framing, opsi cadangannya adalah menjalankan `mcp_pipe.py` + tool Python asli di dalam Cloudflare Containers (fitur yang lebih baru, butuh Workers Paid plan) alih-alih reimplementasi ulang di JavaScript — beri tahu saya kalau perlu dibuatkan versi itu.

## Setup

```bash
npm install
npm install -g wrangler   # kalau belum ada
wrangler login
```

## Development Lokal

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars, isi MCP_ENDPOINT dengan token asli
npm run dev
```

## Deploy

```bash
npm run deploy
```

Setelah deploy pertama kali, isi secret `MCP_ENDPOINT` (pilih salah satu):

```bash
# Opsi 1: CLI
wrangler secret put MCP_ENDPOINT
# lalu paste: wss://api.xiaozhi.me/mcp/?token=xxxxx

# Opsi 2: Dashboard
# Workers & Pages -> xiaozhi-mcp-bridge -> Settings -> Variables and Secrets
# -> Add -> Type: Secret -> Name: MCP_ENDPOINT -> Value: wss://api.xiaozhi.me/mcp/?token=xxxxx
```

Setelah secret diisi, redeploy sekali lagi (`npm run deploy`) supaya cron trigger langsung mencoba koneksi.

## Verifikasi

1. Cek status koneksi:
   ```bash
   curl https://xiaozhi-mcp-bridge.<subdomain-kamu>.workers.dev/status
   ```
   Harus muncul `"status": "connected"` dalam 1-2 menit setelah deploy (menunggu cron trigger pertama).

2. Cek log real-time:
   ```bash
   npm run tail
   ```
   Cari baris `"Terhubung ke XiaoZhi MCP endpoint."`

3. Cek status di panel XiaoZhi (Configure Role -> MCP Settings -> Custom Services -> Get MCP Endpoint) — status harus berubah dari **Not Connected** menjadi **Connected**.

4. Uji tool call: tanyakan sesuatu ke robot yang memicu `cari_informasi_terkini` (misalnya "kenapa langit biru"), lalu cek log (`npm run tail`) apakah baris `tools/call` muncul dan tidak error.

Kalau langkah 1-3 berhasil tapi langkah 4 gagal atau error, kemungkinan besar asumsi framing di atas perlu direvisi — laporkan isi log-nya untuk didiagnosis lebih lanjut.

## Integrasi Tavily (Web Search)

Tool `cari_informasi_terkini` sudah ditambahkan di `src/tools/index.ts`, memanggil REST API Tavily (`https://api.tavily.com/search`) langsung — bukan lewat MCP server Tavily — supaya tidak ada dua lapis translasi protokol MCP yang tidak perlu.

**Kenapa harus dibungkus di sini, tidak bisa ditambahkan langsung di XiaoZhi**: agent XiaoZhi hanya punya satu slot "Custom Services / Get MCP Endpoint" per agent. Tidak ada UI untuk menambahkan MCP server pihak ketiga kedua secara langsung — semua tool custom, termasuk Tavily, harus lewat bridge WebSocket tunggal yang sama.

Setup:
```bash
wrangler secret put TAVILY_API_KEY
# ambil API key gratis di https://app.tavily.com (1000 kredit/bulan, tanpa kartu kredit)
npm run deploy
```

**Catatan desain untuk konteks anak 5 tahun**: description tool ini sudah dibatasi eksplisit ("HANYA untuk fakta umum", "JANGAN untuk topik sensitif/menakutkan/dewasa") supaya model tidak memanggil web search untuk pertanyaan yang harusnya diarahkan ke orang tua. Ini pembatasan di level instruksi (description tool), bukan filter konten di level jaringan — kalau kamu mau lapisan pengaman tambahan, pertimbangkan menambah keyword-filter sederhana di `executeTool` sebelum request dikirim ke Tavily, atau cek apakah Tavily API punya parameter domain-whitelist yang bisa dipakai untuk membatasi sumber ke situs yang ramah anak.

## Menambah Tool Baru

Edit `src/tools/index.ts`:
1. Tambah entri ke `TOOL_DEFINITIONS` (name, description yang jelas kapan dipakai, inputSchema)
2. Tambah `case` baru di `executeTool()`

Tidak perlu ubah `mcp-bridge.ts` — dispatch tool sudah generik.

## GitHub Actions (Opsional)

Kalau mau auto-deploy setiap push ke `main`, isi 2 secret di GitHub repo (Settings -> Secrets and variables -> Actions):
- `CLOUDFLARE_API_TOKEN` — buat di dash.cloudflare.com/profile/api-tokens (scope: Edit Cloudflare Workers)
- `CLOUDFLARE_ACCOUNT_ID` — terlihat di sidebar kanan dashboard Cloudflare

`MCP_ENDPOINT` tetap di-set terpisah lewat `wrangler secret put`, tidak lewat GitHub Actions — supaya token tidak pernah lewat CI logs.
