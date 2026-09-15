# GBA_emulator

🎮 **GBA_K Emulator** - Trình giả lập Game Boy Advance hiện đại chạy trên Web và Android (APK).

---

## ✨ Tính Năng Nổi Bật

- 🕹️ **Chạy mượt mà mọi file ROM `.gba`**: Tự động nhận diện SRAM, Flash 64K/128K, EEPROM.
- ⚡ **Tua nhanh (Fast-Forward)**: 1.0x - 5.0x mượt mà với thanh trượt và nút chọn nhanh.
- 🕹️ **Kiểu điều khiển đa dạng**: D-Pad cổ điển, Joystick Cố định và Joystick Tự do (Floating).
- 📐 **Tùy chỉnh bố cục phím**: Tự do kéo thả vị trí, phóng to thu nhỏ nút bấm (60% - 160%).
- 💾 **Save / Load States**: 6 slot lưu trạng thái có hình chụp màn hình preview và hỗ trợ xuất/nhập file `.sav`.
- 📱 **Giao diện GBA_K Translucent**: Bộ phím cảm ứng đa điểm, Turbo A/B, L/R bumpers, rung phản hồi Haptic.
- 📺 **Bộ lọc màn hình (Shaders)**: Màn hình lưới LCD GBA SP, CRT Scanlines, Pixel-Perfect.
- 👾 **Trình quản lý Cheat Code**: Hỗ trợ GameShark, CodeBreaker, Raw RAM codes.
- 📦 **Đóng gói Android APK**: Tích hợp sẵn bản build Android standalone APK (`GBA_K.apk`).

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
