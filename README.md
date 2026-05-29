# Flex Sensor Web Simulator

Static trainer kit untuk simulasi mapping **flex sensor + ESP32 DevKit V1** ke servo, arm gripper, dan output suara laptop.

Repository: https://github.com/triwahyu45/Flex-Sensor-Web-Simulator

## Halaman

- `index.html` - menu utama trainer kit.
- `simulator.html` - dashboard simulator utama.
- `virtual-esp32.html` - pengirim data virtual saat ESP32 belum tersedia.

## Mode Trainer

- **Servo Trainer**: Flex B mengontrol sudut servo 0-180 derajat dan bukaan gripper.
- **Arm Trainer**: Flex A menggeser gripper kiri-kanan.
- **Voice Trainer**: nilai analog memicu suara “Halo”, “Apa kabar”, dan “Semangat”.

## Cara Pakai Lokal

Web ini tidak wajib memakai npm. Bisa langsung buka `index.html` di browser.

Untuk testing lewat local server:

```bash
python -m http.server 5173
```

Lalu buka:

- `http://127.0.0.1:5173/simulator.html`
- `http://127.0.0.1:5173/virtual-esp32.html`

Buka dua tab tersebut bersamaan. Geser slider di **Virtual ESP32**, lalu simulator akan menerima data realtime melalui `BroadcastChannel` dengan fallback `localStorage`.

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

- `flexA` -> posisi arm/gripper kiri-kanan.
- `flexB` -> servo 0-180 derajat dan bukaan gripper.
- `phrase` -> output suara untuk Voice Trainer.

## Deploy GitHub Pages

Karena ini static HTML/CSS/JS, GitHub Pages bisa langsung memakai root repository atau branch `main`.
