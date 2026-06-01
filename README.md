# Flex Sensor Web Simulator

Static trainer kit untuk simulasi mapping **flex sensor + ESP32 DevKit V1** ke servo, arm gripper, dan output suara laptop.

Repository: https://github.com/triwahyu45/Flex-Sensor-Web-Simulator

## Halaman

- `index.html` - menu utama trainer kit.
- `simulator.html` - halaman utama trainer kit satu page.
- `virtual-esp32.html` - hidden/dev sender saat ESP32 belum tersedia.

## Mode Trainer

- **Servo**: Flex A mengontrol sudut servo 0-180 derajat jika bagan Servo ON.
- **Arm Gripper**: Flex A menggeser arm, Flex B membuka/menutup gripper jika bagan Gripper ON.
- **Grafik + Audio**: grafik realtime flex sensor berjalan dan threshold Flex A + Flex B memicu suara jika bagan Grafik + Audio ON.

Setiap modul punya kalibrasi sendiri. Min/max input bisa disesuaikan karena nilai analog flex sensor tiap hardware bisa berbeda. Contoh: jika sensor hanya bergerak dari 900 sampai 2600, isi input min/max modul dengan rentang tersebut agar visual tetap full-scale.

Modul Grafik + Audio mendukung custom rules untuk dua sensor sekaligus. Atur range dan teks untuk **Flex A** dan **Flex B**; jika dua-duanya cocok, teks digabung. Contoh: Flex A menghasilkan `Halo` dan Flex B menghasilkan `Aulia`, maka laptop mengucapkan `Halo Aulia`. Rules disimpan di browser dengan `localStorage`.

## Cara Pakai Lokal

Web ini tidak wajib memakai npm. Bisa langsung buka `index.html` di browser.

Untuk testing lewat local server:

```bash
python -m http.server 5173
```

Lalu buka:

- `http://127.0.0.1:5173/simulator.html`
- `http://127.0.0.1:5173/virtual-esp32.html` untuk testing tersembunyi tanpa ESP32.

Buka dua tab tersebut bersamaan saat belum ada hardware. Geser slider di **Virtual ESP32**, lalu trainer kit menerima data realtime melalui `BroadcastChannel` dengan fallback `localStorage`.

## Mapping Data

```json
{
  "flexA": 2048,
  "flexB": 0,
  "pan": 0,
  "servo": 0,
  "grip": 0,
  "phrase": "Halo"
}
```

- `flexA` -> servo 0-180 derajat dan posisi arm kiri-kanan.
- `flexB` -> bukaan gripper dan threshold audio.

## Koneksi ESP32 mDNS

Setiap kelompok sebaiknya memakai mDNS unik, misalnya:

- `flex-kelompok1.local`
- `flex-kelompok2.local`
- `flex-aulia.local`

Di halaman trainer, isi box **ESP32 mDNS** dengan nama device tanpa `http://`, misalnya `flex-kelompok1`. Web akan membaca data dari:

```text
http://flex-kelompok1.local/data
```

Endpoint ESP32 perlu mengembalikan JSON:

```json
{
  "flexA": 2048,
  "flexB": 0
}
```

Jika web dibuka dari GitHub Pages, firmware ESP32 perlu mengizinkan CORS:

```text
Access-Control-Allow-Origin: *
```

`virtual-esp32.html` tetap ada sebagai hidden/dev sender saat hardware belum tersedia. Isi mDNS yang sama di trainer dan Virtual ESP32 agar data virtual hanya diterima oleh trainer yang cocok. Jika mDNS berbeda, Simulator menampilkan status merah `Disconnected - mDNS mismatch`.

Halaman Virtual ESP32 juga menyediakan contoh sketch Arduino ESP32 yang bisa dicopy. Sketch contoh memakai `WiFi`, `WebServer`, `ESPmDNS`, endpoint `/data`, pin Flex A GPIO 34, dan Flex B GPIO 35. Pembacaan setiap flex sensor dirata-rata dari 10 sampel tanpa delay. Nilai diperbarui non-blocking setiap 20 ms memakai `millis()` agar stabil dan tetap responsif.

Untuk mengurangi noise ADC dari hardware, pasang kapasitor keramik 100 nF dari masing-masing pin ADC ke GND. GPIO 34 dan 35 tetap dipakai karena keduanya berasal dari ADC1 dan aman digunakan saat Wi-Fi ESP32 aktif.
- `phrase` -> output suara gabungan dari rule Flex A dan Flex B.

## Deploy GitHub Pages

Karena ini static HTML/CSS/JS, GitHub Pages bisa langsung memakai root repository atau branch `main`.
