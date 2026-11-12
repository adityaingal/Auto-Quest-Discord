# 🤖 Discord Quest Selfbot

> **Disclaimer:** Selfbots are against Discord ToS. Use this at your own risk. I am not responsible for any bans.

Automated bot for completing Discord Missions with a clean CLI interface, live countdown feature, and automatic reward detection.
## ✨ Features
> 🖥️ **Tampilan CLI Keren:** Menggunakan tabel rapi dan ASCII art.
> ⏱️ **Live Countdown:** Menampilkan sisa waktu quest secara real-time.
> 🎁 **Auto Reward:** Mengklaim hadiah (Orbs/Decoration) secara otomatis setelah quest selesai.
> ⚡ **Ringan & Cepat:** Dibangun menggunakan TypeScript & Node.js terbaru.

## 📦 Installation & Setup

> [!NOTE]
> **[Node.js](https://nodejs.org/) 24.0.0 or newer is required**
> **[Git](https://git-scm.com/)**

## 🚀 Cara Install & Menjalankan
Ikuti langkah-langkah berikut di terminal (CMD/PowerShell/Termux):

### 1. Clone Repositori
```
git clone https://github.com/lfathh/Auto-Quest-Discord.git
cd Auto-Quest-Discord
```
### 2. Install Modules
```
npm install
```
### 3. Setup Token
Buat file baru bernama `.env` di dalam folder bot, lalu isi token Discord kamu:
```
TOKEN=TOKEN DISCORD ANDA
```

### Run Script
```
npm start
```

> [!TIP]
> `npm run dev` menjalankan bot dengan auto-reload, `npm run typecheck` untuk cek error TypeScript.
> `npm run check-token` untuk memverifikasi token, `npm run list-quests` untuk melihat status quest.
> Jika `TOKEN` kosong atau tidak valid, bot akan menampilkan pesan error yang jelas lalu berhenti.

## 👥 Multi Account

Satu program bisa menjalankan banyak akun **secara paralel**, masing-masing dengan token user sendiri,
satu bot notifikasi bisa melaporkan semua akun ke channel yang berbeda.

### Cara 1 — file `accounts.json` (rekomendasi)

```bash
copy accounts.example.json accounts.json
notepad accounts.json
```

```json
[
  { "name": "main", "token": "USER_TOKEN_1", "channelId": "CHANNEL_ID_1" },
  { "name": "alt",  "token": "USER_TOKEN_2", "channelId": "CHANNEL_ID_2" }
]
```

- `name` → label di log (`[main]`, `[alt]`) dan di pesan Discord.
- `token` → token **user** akun tersebut.
- `channelId` → opsional, channel tujuan notifikasi akun ini (kalau kosong pakai `NOTIFY_CHANNEL_ID`).
- `botToken` → opsional, bot notifikasi khusus akun ini (kalau kosong pakai `BOT_TOKEN`).

> `accounts.json` sudah masuk `.gitignore` + `.dockerignore`, jadi tidak ikut ter-upload.

### Cara 2 — environment variable

```
TOKENS=TOKEN_1,TOKEN_2,TOKEN_3
```

### Perilaku multi akun

| Aspek | Nilai |
| --- | --- |
| Jalur akun | Semua akun jalan **paralel**, tiap akun punya gateway sendiri |
| Output | Otomatis mode **plain log** (ada `[main]`, `[alt]` di depan baris) |
| Delay connect | `ACCOUNT_STAGGER_SECONDS` (default 8, Discord membatasi rate identify) |
| Retry connect | 2x percobaan, jeda 10 detik |
| Akun mati | Akun lain tetap jalan, akun gagal hanya di-log + dinotifikasi |
| Notifikasi | Prefix nama akun, jadi jelas pesan itu dari akun mana |

Verifikasi semua token sekaligus:
```
npm run check-token
npm run list-quests
```

---

## ☁️ Hosting (VPS / Railway / Render / Fly.io)

> [!IMPORTANT]
> Yang dimasukkan ke environment variable hosting adalah **user token** (dari browser), **bukan** bot token.
> Quest adalah fitur akun user: `/quests/@me` balas `401` untuk bot, dan reward (Orbs) milik akun user.

### Cara cepat dengan Docker

```bash
docker build -t auto-quest .
docker run -d --name auto-quest --restart unless-stopped \
  -e TOKEN="USER_TOKEN_ANDA" \
  -e LOOP_MINUTES=30 \
  auto-quest
```

Dengan notifikasi bot:
```bash
docker run -d --name auto-quest --restart unless-stopped \
  -e TOKEN="USER_TOKEN_ANDA" \
  -e LOOP_MINUTES=30 \
  -e BOT_TOKEN="BOT_TOKEN_ANDA" \
  -e NOTIFY_CHANNEL_ID="CHANNEL_ID" \
  auto-quest
```

### Environment variables

| Variable | Wajib | Default | Keterangan |
| --- | --- | --- | --- |
| `TOKEN` | ya | - | Discord **user** token |
| `LOOP_MINUTES` | tidak | `0` | Menit antar run. `0` = sekali lalu exit, `30` = loop |
| `PLAIN_OUTPUT` | tidak | auto | `1` = log tanpa tabel (otomatis jika tanpa TTY) |
| `CAPTCHA_SERVICE` | tidak | - | `2captcha` atau `anti-captcha` |
| `CAPTCHA_API_KEY` | tidak | - | API key untuk solving captcha claim |
| `BOT_TOKEN` | tidak | - | Token bot Discord **hanya untuk notifikasi** |
| `NOTIFY_CHANNEL_ID` | tidak | - | Channel id tujuan notifikasi |
| `BOT_COMMAND_CHANNEL_ID` | tidak | - | Channel tempat bot menerima perintah |
| `BOT_ADMIN_USER_IDS` | tidak | - | User id yang boleh memakai `!run` / `!stop` |
| `ACCOUNT_STAGGER_SECONDS` | tidak | `8` | Jeda antar akun saat connect |

### 🎮 Bot sebagai control panel

> [!IMPORTANT]
> **Bot Discord tidak bisa menyelesaikan quest sendiri.** Quest adalah fitur akun
> *user*: `/quests/@me` balas `401` untuk bot, dan reward (Orbs) milik akun user.
> Yang dilakukan bot adalah **mengendalikan worker** yang memakai user token.

Kalau `BOT_TOKEN` + `BOT_COMMAND_CHANNEL_ID` di-set, bot akan connect ke gateway dan
mendengarkan perintah di channel tersebut:

| Perintah | Fungsi | Syarat |
| --- | --- | --- |
| `!help` | daftar perintah | - |
| `!status` | status tiap akun (idle / running / offline, hasil run terakhir) | - |
| `!quests` | quest yang sedang jalan + sisa waktu + reward | - |
| `!run` | jalankan quest sekarang untuk semua akun | admin |
| `!run <nama>` | jalankan hanya untuk satu akun | admin |
| `!stop` | matikan program | admin |

Contoh:
```
> !status
**main** (Br0ken) - 🟢 idle | last run 2/3
**alt** (Br0ken) - 🟡 running

> !quests
**main**
`Godzilla Minus Zero` - 700 Orbs - Running (2m 5s left)
```

Pengaturan yang diperlukan:
```
BOT_TOKEN=MTI...bot.token
BOT_COMMAND_CHANNEL_ID=123456789012345678
BOT_ADMIN_USER_IDS=1543822946328514683
```

Bot butuh izin **View Channel** + **Send Messages** + **Read Message History** di channel tersebut.
Prefix perintah bisa diubah lewat `BOT_PREFIX` (default `!`).

### 🤖 Notifikasi lewat Discord bot (opsional)

Kalau mau status dikirim ke channel Discord, buat bot di
[Developer Portal](https://discord.com/developers/applications) → **Bot** → **Reset Token**,
lalu invite ke server dengan izin **Send Messages** dan **View Channel**.

```
BOT_TOKEN=MTI...bot.token
NOTIFY_CHANNEL_ID=123456789012345678
```

Bot hanya **melapor** apa yang terjadi, quest tetap diselesaikan dengan user token:

| Pesan | Kapan |
| --- | --- |
| `🟢 Auto Quest online` | bot connect ke gateway |
| `✅ Quest completed` | quest selesai, tampilkan reward + status claim |
| `🎁 Reward claimed` | hadiah berhasil di-claim |
| `⚠️ Reward not claimed` | butuh captcha / gagal claim |
| `❌ Quest failed` | quest gagal (mis. task type tidak didukung) |
| `🏁 Cycle finished` | rekap jumlah quest selesai per siklus |

### Railway / Render / Fly.io

1. Upload repo (atau `railway init` / render dari GitHub).
2. Build command: `npm ci && npm run build`
3. Start command: `npm run start:prod`
4. Variables: `TOKEN` + `LOOP_MINUTES=30`
5. Railway/Render tanpa support Docker akan otomatis memakai `package.json` scripts.

### Catatan penting

- **Reward claim butuh captcha.** Discord memproteksi `POST /quests/{id}/claim-reward` dengan hCaptcha.
  - Tanpa `CAPTCHA_API_KEY`: quest tetap selesai, tapi reward harus diklaim manual (klik "Claim" di Discord, 1 klik).
  - Dengan `CAPTCHA_API_KEY`: bot solving captcha otomatis lalu纲要 reward.
- **Jangan jalanin 2 instance bersamaan** (mis. lokal + hosting) pada token yang sama.
- Quest `WATCH_VIDEO` mengikuti aturan waktu server, jadi butuh ~15 menit per quest video.
- Quest `PLAY_ON_XBOX` / `PLAY_ON_PLAYSTATION` hanya bisa diselesaikan di console.

## 📤 Example Output

After completion, your output may look like this:

![Imgur](https://i.imgur.com/UHDsY6g.png)

## 📘 Dokumentasi

Specifikasi protocol lengkap (endpoint, header, payload, timing rule, captcha, error code)
ada di [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — bisa dipakai untuk menulis bot lain
dengan fitur yang sama.

## 🙏 Credits
> [discord.js](https://github.com/discordjs/discord.js)
