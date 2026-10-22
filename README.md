# GBA_emulator

## Độ an toàn của cheat và dữ liệu lưu

- Radical Red 4.1 có CRC `FBA55DD8` được áp dụng bản vá tương thích trong bộ nhớ khi mở ROM: tránh chờ vô hạn tín hiệu âm thanh ở bước 12 của tiến hoá. File ROM trên máy và trong thư viện không bị ghi đè. State cũ được nhận diện và chuyển riêng trường CRC sang `4085AE7B` khi nạp; dữ liệu CPU/RAM/tiến trình giữ nguyên. ROM khác không nhận bản vá này.
- Load state giữ chế độ tua nhanh và hệ số đang chọn. Nút tua nhanh bật/tắt cố định độc lập với giữ Tab tạm thời; vẫn có preset 1x–5x và thanh chỉnh từng 0,25x.
- Tua nhanh chỉ dùng bỏ khung hình ở frontend; không ép lõi mGBA bỏ thêm 1–3 khung hình theo hệ số. Khi game khởi động hoặc nạp state, cấu hình tốc độ và đồng bộ âm thanh được áp dụng lại. 5x là tốc độ yêu cầu, tốc độ thực tế còn phụ thuộc thiết bị và cảnh game.
- Cheat và đóng băng RAM dùng lõi mGBA; không ghi đồng thời bằng vòng lặp riêng.
- Địa chỉ RAM WASM chỉ được dùng sau khi đối chiếu đủ EWRAM và IWRAM với state. Không tìm được địa chỉ đáng tin cậy thì từ chối ghi.
- Giữ nguyên độ rộng u8/u16/u32 khi sửa RAM. Giá trị vượt giới hạn hoặc ghi vượt vùng nhớ sẽ bị từ chối.
- Mở đúng ROM trước khi nhập SAV hoặc backup. State được kiểm tra CRC để tránh nạp nhầm phiên bản ROM có cùng tên, ví dụ Radical Red 4.0 và 4.1.
- Cheat cũ chưa có dấu nhận diện ROM được giữ lại nhưng tắt khi mở game. Kiểm tra mã đúng phiên bản rồi bật lại; danh sách đóng băng cũ chưa xác minh không tự áp dụng.
- Backup bao gồm cả slot lưu dự phòng bằng localStorage. Nhập backup kiểm tra dữ liệu trước khi ghi; các slot IndexedDB được nhập trong cùng một giao dịch.
- Xuất backup định kỳ và Save trong game trước khi thử cheat. Các kiểm tra này không bảo đảm mã cheat của ROM khác sẽ dùng được, cũng không tự sửa mọi state đã hỏng.


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
