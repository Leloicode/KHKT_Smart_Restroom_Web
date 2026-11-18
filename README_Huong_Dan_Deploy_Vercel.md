# HƯỚNG DẪN TRIỂN KHAI CLOUD VERCEL (ONLINE 24/7)
## Dự án KHKT: Hệ Thống IoT Giám Sát An Toàn & Cảnh Báo Sớm Bạo Lực Nhà Vệ Sinh Học Đường
**Đơn vị thực hiện:** Trường THCS Nguyễn Công Trứ (Thông tư số 84/2026/TT-BGDĐT)

---

### 1. Giới Thiệu Kiến Trúc Cloud Serverless
Hệ thống Web Admin Dashboard được thiết kế theo kiến trúc **Serverless** trên nền tảng **Vercel** (miễn phí 100%, uptime 99.99%), tối ưu hiển thị 100% trên điện thoại di động (Responsive Mobile First):
- **Phân tách 2 Tab chuyên biệt:**
  * **Tab 1 - 📊 Giám Sát Trực Tiếp:** Theo dõi 4 chỉ số cảm biến cốt lõi theo thời gian thực (Độ ồn KY-038, Khói MQ-2, Thời gian ở trong WC, Hiện diện & Người PIR), đàm thoại Push-to-Talk tới Loa hộp 4Ω 3W (3020), nút kích hoạt còi hú răn đe, cảnh báo cấm thuốc, bảng nhật ký sự cố dạng thẻ card di động.
  * **Tab 2 - ⚙️ Cài Đặt & Cấu Hình:** Tinh chỉnh các mốc thời gian (ở tối đa 5 - 30 phút), lọc âm bạo lực (0.5 - 4.0s), ngưỡng khói MQ-2. Đặc biệt tích hợp **Nút Đặt Lại WiFi (Reset WiFi ESP32)** chỉ với 1-click.
- **Tài khoản đăng nhập mặc định:**
  * Tên đăng nhập: **`admin`** (hoặc **`bgh_admin`**)
  * Mật khẩu: **`admin123`**
- **Hiển thị dữ liệu phần cứng 100% (Real-time Telemetry):** Khi chưa cắm nguồn sa bàn ESP32, website giữ trạng thái chờ tĩnh (`CHỜ ESP32`, các chỉ số hiển thị `--`), tuyệt đối không dùng số liệu giả lập. Ngay khi ESP32 bật nguồn và gửi heartbeat lên `/api/status`, giao diện lập tức nhận diện trực tuyến (`🟢 Trực tuyến`) với số liệu cảm biến thực tế.

---

### 2. Các Bước Triển Khai Lên Vercel (1-Click Deploy)

#### Cách 1: Triển khai qua Vercel CLI (Nhanh nhất)
1. Cài đặt NodeJS (nếu máy tính chưa có) từ [nodejs.org](https://nodejs.org).
2. Mở Terminal (PowerShell hoặc CMD) tại thư mục `02_Web_Admin_Vercel/`:
   ```bash
   cd "d:\test\Du_An_KHKT_Nha_Ve_Sinh_Thong_Minh\02_Web_Admin_Vercel"
   ```
3. Cài đặt Vercel CLI toàn cục (chỉ làm lần đầu):
   ```bash
   npm install -g vercel
   ```
4. Đăng nhập và triển khai:
   ```bash
   vercel
   ```
   - Làm theo các hướng dẫn trên màn hình (Bấm `Y`, chọn scope cá nhân, nhấn `Enter` để chọn thiết lập mặc định).
5. Khi hoàn tất, hệ thống sẽ cấp một đường link truy cập dạng:
   `https://khktsmartrestroomweb.vercel.app`

#### Cách 2: Triển khai qua GitHub (Tự động cập nhật)
1. Đẩy mã nguồn thư mục `02_Web_Admin_Vercel/` lên một repository mới trên GitHub (ví dụ: `khkt-smart-restroom`).
2. Truy cập [vercel.com](https://vercel.com) và đăng nhập bằng tài khoản GitHub.
3. Bấm **Add New...** -> **Project**, chọn repository vừa tạo.
4. Bấm **Deploy**. Sau khoảng 30 giây, website sẽ được phát hành online toàn cầu.

---

### 3. Cấu Hình Biến Môi Trường (Environment Variables) Trên Vercel

Để tính năng gửi tin nhắn và nút tương tác Telegram hoạt động thông suốt:
1. Trên trang quản trị Vercel Dashboard của dự án, vào tab **Settings** -> **Environment Variables**.
2. Thêm 2 biến sau:
   - `TELEGRAM_BOT_TOKEN`: Điền chuỗi Token nhận từ `@BotFather` (ví dụ: `7891234567:AAHxyz...`).
   - `TELEGRAM_CHAT_ID`: Điền ID của nhóm chat giáo viên/bảo vệ (ví dụ: `-1001234567890`).
3. Bấm **Save** và bấm **Redeploy** phiên bản mới nhất.

---

### 4. Kích Hoạt Telegram Webhook

Để khi Giáo viên/Bảo vệ nhấn vào các nút trên Telegram (`[🔊 Hú Còi Răn Đe]`, `[⚠️ Nhắc Cấm Thuốc]`, `[👮 Bảo Vệ Đang Tới]`, `[✅ Hủy Báo Động]`, `[🎙️ Mở Mic Đàm Thoại Trực Tiếp]`), Telegram sẽ gửi tín hiệu ngay về Vercel:
Mở trình duyệt web bất kỳ và dán đường link sau (thay thế token và domain Vercel của bạn):
```
https://api.telegram.org/bot<TOKEN_CỦA_BẠN>/setWebhook?url=https://<DOMAIN_VERCEL_CỦA_BẠN>/api/telegram-webhook
```

Ví dụ thực tế:
```
https://api.telegram.org/bot7891234567:AAHxyz_Example/setWebhook?url=https://khktsmartrestroomweb.vercel.app/api/telegram-webhook
```
Nếu màn hình hiện:
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```
nghĩa là hệ thống đã liên kết thành công 100%!

---

### 5. Hướng Dẫn Sử Dụng & Kiểm Tra Hoạt Động (Testing)
1. **Đăng nhập quản trị**:
   - Truy cập trang chủ (`index.html` hoặc link Vercel).
   - Nhập tài khoản: **`admin`** (hoặc **`bgh_admin`**) | Mật khẩu: **`admin123`** và bấm **ĐĂNG NHẬP HỆ THỐNG**.
2. **Tab Giám Sát Trực Tiếp**:
   - Khi cắm nguồn sa bàn ESP32 và có dữ liệu gửi lên `/api/status`, trạng thái lập tức chuyển sang `🟢 Trực tuyến`.
   - Khi chưa cắm phần cứng, giao diện hiển thị trạng thái chờ tĩnh `CHỜ ESP32` (các chỉ số hiển thị `--`), không phát sinh số liệu mô phỏng.
   - Thử nghiệm **Push-to-Talk**: Nhấn giữ nút tròn **NHẤN GIỮ ĐỂ NÓI**, giọng nói truyền thẳng tới Loa hộp 3W (3020).
   - Bấm nút **🚨 Hú Còi Răn Đe Bạo Lực** hoặc **🚬 Cảnh Báo Cấm Thuốc** để phát âm thanh qua Loa hộp 3W (3020).
3. **Tab Cài Đặt & Đổi WiFi (Reset WiFi ESP32)**:
   - Kéo các thanh trượt thời gian ở tối đa (10 phút), lọc âm bạo lực (1.5s), ngưỡng khói (1800 ADC) và bấm *Áp dụng*.
   - Khi cần đổi sang mạng WiFi khác (WiFi phòng thi, 4G điện thoại): Nhấn nút **🔄 ĐẶT LẠI WIFI THIẾT BỊ (RESET WIFI)**. ESP32 sẽ xóa cấu hình cũ và tự phát mạng WiFi `KHKT-SmartRestroom-Setup` để cài đặt lại bằng điện thoại trong 30 giây.
