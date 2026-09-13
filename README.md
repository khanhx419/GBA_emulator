# GBA_emulator

🎮 **My Boy! GBA Emulator** - Trình giả lập Game Boy Advance hiện đại chạy trên Web và Android (APK).

---

## ✨ Tính Năng Nổi Bật

- 🕹️ **Chạy mượt mà mọi file ROM `.gba`**: Tự động nhận diện SRAM, Flash 64K/128K, EEPROM.
- ⚡ **Tua nhanh (Fast-Forward)**: 1.5x, 2x, 4x, 8x tăng tốc cày cấp game.
- 💾 **Save / Load States**: 6 slot lưu trạng thái có hình chụp màn hình preview và hỗ trợ xuất/nhập file `.sav`.
- 📱 **Giao diện My Boy! Translucent**: Bộ phím cảm ứng đa điểm D-pad 8 hướng, Turbo A/B, L/R bumpers, rung phản hồi Haptic.
- 📺 **Bộ lọc màn hình (Shaders)**: Màn hình lưới LCD GBA SP, CRT Scanlines, Pixel-Perfect.
- 👾 **Trình quản lý Cheat Code**: Hỗ trợ GameShark, CodeBreaker, Raw RAM codes.
- 📦 **Đóng gói Android APK**: Tích hợp sẵn bản build Android standalone APK.

---

## 🚀 Cài Đặt & Khởi Chạy

### 1. Cài đặt dependencies
```bash
npm install
```

### 2. Chạy trên trình duyệt Web (Dev Server)
```bash
npm run dev
```
Truy cập: `http://localhost:3000`

### 3. Đóng gói file cài đặt Android (.apk)
```bash
npm run build:apk
```
hoặc nhấp đúp vào file `build-apk.bat` trên Windows.

---

## ⌨️ Phím Tắt Bàn Phím
- **Di chuyển (D-Pad)**: `↑ ↓ ← →` hoặc `W A S D`
- **Nút A / B**: `Z` / `X` (hoặc `J` / `K`)
- **Nút L / R**: `A` / `S` (hoặc `Q` / `E`)
- **Start / Select**: `Enter` / `Space`
- **Tua nhanh (Fast-Forward)**: Phím `Tab`
- **Quick Save / Load**: `F1` / `F3`
