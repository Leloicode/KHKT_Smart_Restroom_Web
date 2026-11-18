# QUY TRÌNH XÂY DỰNG, LẬP TRÌNH & TRIỂN KHAI WEB ADMIN CLOUD VERCEL (TỪ A - Z)
## Dự án KHKT: Hệ Thống IoT Cảnh Báo Sớm Nguy Cơ Bạo Lực Học Đường Và Giám Sát An Toàn Nhà Vệ Sinh
**Đơn vị thực hiện:** Trường THCS Nguyễn Công Trứ (Thông tư số 84/2026/TT-BGDĐT)  
**Địa chỉ Web hoạt động chính thức:** `https://khktsmartrestroomweb.vercel.app`

---

## PHẦN 1: QUY TRÌNH 6 BƯỚC XÂY DỰNG & LẬP TRÌNH WEB ADMIN TỪ ĐẦU

Hệ thống Web Admin được xây dựng hoàn toàn bằng chuẩn **HTML5 / CSS3 / Vanilla JavaScript (ES6+)** kết hợp **Node.js Serverless Functions** trên nền tảng đám mây **Vercel**, không phụ thuộc framework nặng, giúp tốc độ tải trang dưới 0.5 giây và hoạt động ổn định 24/7.

### Bước 1: Thiết kế cấu trúc thư mục chuẩn của Web (`02_Web_Admin_Vercel/`)
Toàn bộ mã nguồn Web được tổ chức khoa học thành 3 tầng rõ ràng (Giao diện tĩnh Frontend – Logic điều khiển Client – Máy chủ API Serverless):

```text
02_Web_Admin_Vercel/
├── index.html                          # Trang đăng nhập bảo mật dành cho Ban Giám hiệu & Giám thị
├── dashboard.html                      # Giao diện Trung tâm Giám sát & Điều khiển 2 Tab (Responsive Mobile-First)
├── css/
│   └── style.css                       # Hệ thống giao diện chuẩn hiện đại, tự động co giãn Điện thoại / iPad / PC
├── js/
│   └── app.js                          # Logic đồng bộ dữ liệu thực 100% từ ESP32, điều khiển từ xa & Push-to-Talk
├── api/
│   ├── status.js                       # API Serverless trung tâm: Nhận telemetry từ ESP32 & quản lý hàng đợi lệnh FIFO
│   ├── control.js                      # API điều hướng lệnh điều khiển đồng bộ với status.js
│   └── telegram-webhook.js             # API Webhook tiếp nhận tương tác 5 nút bấm từ Telegram Bot
├── vercel.json                         # Cấu hình định tuyến API, CORS và chống lưu cache trình duyệt
├── package.json                        # Khai báo chuẩn ES Module ("type": "module") cho Node.js Serverless
└── README_Huong_Dan_Deploy_Vercel.md   # Tài liệu quy trình xây dựng & triển khai Web từ A-Z
```

---

### Bước 2: Xây dựng giao diện người dùng (`index.html`, `dashboard.html`, `css/style.css`)
1. **Trang đăng nhập (`index.html`):**
   - Kiểm tra tài khoản quản trị nhà trường (`admin` hoặc `bgh_admin` / mật khẩu `admin123`).
   - Lưu phiên đăng nhập vào `sessionStorage` và tự động mở khóa thẳng khi giáo viên bấm mở từ ứng dụng Telegram (`?tg=1`).
2. **Trang bảng điều khiển trung tâm (`dashboard.html`):**
   - **Header trạng thái thời gian thực:** Hiển thị đồng hồ sống và huy hiệu trạng thái phần cứng (`CHỜ ESP32` khi chưa bật mạch, tự động chuyển sang `🟢 TRỰC TUYẾN` ngay khi mạch ESP32 cấp nguồn).
   - **Tab 1 - 📊 Giám Sát Trực Tiếp:**
     * **4 Thẻ cảm biến thời gian thực:** Độ ồn âm thanh KY-038 (`dB`), Nồng độ khói MQ-2 (`ADC`), Thời gian ở trong WC (`phút / giới hạn`), và Số lượng học sinh / Hiện diện PIR.
     * **Bảng Điều Khiển Âm Thanh & Đàm Thoại Sa Bàn:** Tích hợp nút tròn **Push-to-Talk (Nhấn giữ để nói)** thu âm qua Web Audio API kèm sóng âm trực quan, cùng 4 nút phát lệnh khẩn cấp xuống Loa hộp 4Ω 3W (3020).
     * **Bảng Kiểm Tra Phản Hồi Phần Cứng Sa Bàn:** Chỉ cho phép bấm khi mạch ESP32 đang trực tuyến để gửi lệnh kiểm tra còi, loa, đèn LED đỏ cảnh báo cửa (GPIO 15) trực tiếp dưới sa bàn.
     * **Bảng Nhật Ký Hoạt Động & Sự Cố:** Tự động ghi vết thời gian thực cả trên giao diện bảng máy tính và thẻ card di động.
   - **Tab 2 - ⚙️ Cài Đặt & Cấu Hình:**
     * **3 Thanh trượt (Sliders) cấu hình ngưỡng logic:** Thời gian ở tối đa (`5 - 30 phút`), Thời gian giữ âm lọc bạo lực (`0.5 - 4.0 giây`), Ngưỡng khói MQ-2 (`1000 - 3000 ADC`).
     * **Quản lý kết nối WiFi thiết bị:** Hiển thị tên mạng WiFi thực tế của ESP32, tích hợp nút **🔄 Đặt Lại WiFi Thiết Bị (Reset WiFi)** và **🔁 Khởi Động Lại Thiết Bị (Reboot)**.

---

### Bước 3: Lập trình logic Frontend đồng bộ 100% phần cứng thật (`js/app.js`)
- **Không dùng dữ liệu giả lập:** Khi chưa bật mạch ESP32, hàm `renderStaticIdleState()` giữ giao diện ở trạng thái chờ sạch sẽ (`-- dB`, `-- ADC`, `00:00`, `Chờ kết nối ESP32`) và khóa các nút thử nghiệm phần cứng để tránh bấm nhầm.
- **Cơ chế Polling thông minh mỗi 2 giây (`fetchDeviceStatus`):**
  - Liên tục gọi `GET /api/status?_t=...` với cờ `cache: 'no-store'`.
  - Sử dụng bộ đếm `fetchSequence` để loại bỏ các gói tin mạng đến trễ, đảm bảo dữ liệu hiển thị luôn là mới nhất.
  - Ngay khi nhận `data.isOnline === true` từ ESP32, hệ thống lập tức mở khóa toàn bộ bảng điều khiển, hiển thị 100% thông số cảm biến thực (kể cả khi giá trị đo bằng `0`) và tự động đồng bộ 3 thanh trượt theo đúng thông số lưu trong bộ nhớ Flash NVS của ESP32.
- **Bảo toàn trạng thái khi chỉnh thanh trượt (`pendingLogicSettings`):** Khi giáo viên vừa bấm *"Áp dụng cài đặt xuống ESP32"*, giao diện giữ nguyên vị trí thanh trượt mới trong lúc chờ ESP32 kéo lệnh `SET_LOGIC` về xử lý, không bị giật ngược về số cũ.

---

### Bước 4: Lập trình Backend Serverless API & Hàng đợi lệnh FIFO (`api/status.js`)
Tệp `api/status.js` đóng vai trò là "trạm trung chuyển đám mây" giữa mạch ESP32, Web Dashboard và Telegram Bot:
1. **Nhận gói tin nhịp tim (Heartbeat Telemetry) từ ESP32 (`POST /api/status`):**
   - Cứ mỗi 2.5 giây, ESP32 gửi gói JSON gồm 13 trường dữ liệu thực (`deviceId`, `deviceName`, `currentWifi`, `alertLevel`, `soundNoise`, `smokeRaw`, `presence`, `stayMinutes`, `stayTimeoutSetting`, `soundHoldSetting`, `smokeThresholdSetting`, `occupancy`, `uptimeSeconds`).
   - Máy chủ lọc bỏ các khóa hệ thống bảo mật (`RESERVED_TELEMETRY_KEYS`), cập nhật dấu thời gian `lastUpdated` và rút lệnh đầu tiên trong hàng đợi FIFO `commandQueue` trả về ngay trong phản hồi HTTP 200 cho ESP32 thực thi.
2. **Nhận lệnh điều khiển từ Web hoặc Telegram (`POST /api/status` có trường `command`):**
   - Đưa lệnh (`SIREN`, `SMOKE`, `OVERTIME`, `CHIME`, `RESET`, `SET_LOGIC`, `RESET_WIFI`, `REBOOT`) vào hàng đợi FIFO `commandQueue` (tối đa 20 lệnh, tự động gộp lệnh `SET_LOGIC` trùng lặp).
   - Hỗ trợ lưu trữ đa tầng (Bộ nhớ đệm Serverless + Tệp tạm `os.tmpdir()` + Upstash KV Redis nếu cấu hình), đảm bảo không bao giờ mất lệnh.
3. **Cung cấp trạng thái cho Web Dashboard (`GET /api/status`):**
   - Tự động tính toán khoảng cách thời gian từ lần cuối ESP32 gửi nhịp tim: nếu `< 15 giây` thì trả về `isOnline: true`; nếu `>= 15 giây` (mạch tắt nguồn hoặc mất mạng) thì trả về `isOnline: false`.

---

### Bước 5: Lập trình Webhook Telegram Bot tương tác 2 chiều (`api/telegram-webhook.js`)
1. **Phản hồi nút bấm tức thì trong 0.1 giây (`answerCallbackQuery`):**
   - Khi giáo viên bấm một trong 5 nút dưới tin nhắn cảnh báo Telegram (`[🔊 Hú Còi Răn Đe]`, `[⚠️ Nhắc Cấm Thuốc]`, `[👮 Bảo Vệ Đang Tới]`, `[✅ Hủy Báo Động]`, `[🎙️ Mở Mic Đàm Thoại Trực Tiếp]`), Webhook gọi ngay API `answerCallbackQuery` của Telegram **trước khi** chuyển tiếp lệnh, giúp tắt ngay biểu tượng xoay tròn loading trên điện thoại.
2. **Xác thực bảo mật Chat ID:**
   - Chỉ chấp nhận lệnh từ Chat ID được cấp quyền (`1461012398` hoặc danh sách trong biến môi trường `TELEGRAM_CHAT_ID`), chặn mọi truy cập trái phép.
3. **Đẩy lệnh xuống ESP32 & Cập nhật lịch sử tin nhắn:**
   - Tự động xếp lệnh tương ứng (`SIREN`, `SMOKE`, `CHIME`, `RESET`) vào hàng đợi `/api/status` và nối thêm dòng xác nhận thời gian xử lý (múi giờ `Asia/Ho_Chi_Minh`) ngay bên dưới tin nhắn cảnh báo Telegram.
   - Hỗ trợ đầy đủ cả tin nhắn thoại (Voice Message -> phát chuông `CHIME`) và các lệnh gõ nhanh (`/status`, `/siren`, `/smoke`, `/overtime`, `/guard`, `/reset`).

---

### Bước 6: Cấu hình định tuyến và chống lưu Cache (`vercel.json`)
- Định tuyến mọi yêu cầu `/api/status`, `/api/control`, `/api/telegram-webhook` vào đúng hàm Serverless tương ứng.
- Gắn header `Cache-Control: no-cache, no-store, must-revalidate` cho toàn bộ tệp `.html`, `.js`, `.css` và API để mỗi lần cập nhật code lên GitHub/Vercel, điện thoại và máy tính đều tải ngay bản mới nhất mà không bị dính cache cũ.

---

## PHẦN 2: QUY TRÌNH TRIỂN KHAI LÊN ĐÁM MÂY VERCEL (DEPLOY ONLINE 24/7)

### Cách 1: Triển khai tự động qua GitHub & Vercel (Khuyên dùng)
1. Đẩy mã nguồn thư mục `02_Web_Admin_Vercel/` lên kho lưu trữ GitHub (`https://github.com/Leloicode/KHKT_Smart_Restroom_Web.git`):
   ```bash
   cd "d:\test\Du_An_KHKT_Nha_Ve_Sinh_Thong_Minh\02_Web_Admin_Vercel"
   git add -A
   git commit -m "Cập nhật hệ thống Web Admin KHKT"
   git push origin main
   ```
2. Truy cập [vercel.com](https://vercel.com), đăng nhập bằng tài khoản GitHub.
3. Bấm **Add New...** -> **Project**, chọn repository `KHKT_Smart_Restroom_Web`.
4. Bấm **Deploy**. Sau 20–30 giây, hệ thống phát hành trực tuyến tại:
   `https://khktsmartrestroomweb.vercel.app`
5. Từ các lần sau, mỗi khi sửa code và gõ `git push origin main`, Vercel sẽ tự động cập nhật website sau 15 giây.

### Cách 2: Triển khai trực tiếp từ máy tính bằng Vercel CLI
1. Cài đặt Node.js từ [nodejs.org](https://nodejs.org).
2. Mở PowerShell tại thư mục `02_Web_Admin_Vercel/`:
   ```bash
   cd "d:\test\Du_An_KHKT_Nha_Ve_Sinh_Thong_Minh\02_Web_Admin_Vercel"
   npm install -g vercel
   vercel --prod
   ```

---

## PHẦN 3: CẤU HÌNH BIẾN MÔI TRƯỜNG & KÍCH HOẠT TELEGRAM WEBHOOK

### 1. Cấu hình Environment Variables trên Vercel
1. Vào trang quản trị dự án trên Vercel -> tab **Settings** -> **Environment Variables**.
2. Kiểm tra hoặc thêm 2 biến:
   - `TELEGRAM_BOT_TOKEN`: `8881401798:AAGC-KPh_-abcGM20BYZqaHBMFT-Wvsuuk8`
   - `TELEGRAM_CHAT_ID`: `1461012398`
3. Bấm **Save** và **Redeploy**.

### 2. Kích hoạt liên kết Telegram Webhook với Vercel
Khi Giáo viên/Bảo vệ nhấn vào 5 nút trên Telegram (`[🔊 Hú Còi Răn Đe]`, `[⚠️ Nhắc Cấm Thuốc]`, `[👮 Bảo Vệ Đang Tới]`, `[✅ Hủy Báo Động]`, `[🎙️ Mở Mic Đàm Thoại Trực Tiếp]`), để Telegram báo ngay về máy chủ Vercel, mở trình duyệt chạy đường dẫn sau:

```text
https://api.telegram.org/bot8881401798:AAGC-KPh_-abcGM20BYZqaHBMFT-Wvsuuk8/setWebhook?url=https://khktsmartrestroomweb.vercel.app/api/telegram-webhook
```

Khi màn hình trả về:
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```
là Webhook đã thông suốt 100%.

---

## PHẦN 4: QUY TRÌNH VẬN HÀNH & KIỂM TRA ĐỒNG BỘ VỚI MẠCH ESP32

1. **Bước 1 - Mở Web khi chưa bật nguồn mạch ESP32:**
   - Truy cập `https://khktsmartrestroomweb.vercel.app`, đăng nhập với tài khoản **`admin`** / mật khẩu **`admin123`**.
   - Kiểm tra: Huy hiệu góc trên hiển thị `CHỜ ESP32`, các chỉ số cảm biến hiển thị `-- dB`, `-- ADC`, `00:00`, tuyệt đối không có dữ liệu rác hay mô phỏng.
2. **Bước 2 - Cấp nguồn cho mạch ESP32:**
   - Bật công tắc nguồn sa bàn. ESP32 kết nối WiFi và gọi ngay `sendHeartbeatToCloud()` trong `setup()`.
   - Kiểm tra: Trong vòng 1–2 giây, Web tự động chuyển sang `🟢 TRỰC TUYẾN`, hiển thị đúng tên mạng WiFi của mạch và số liệu thực từ cảm biến KY-038, MQ-2, PIR, IR.
3. **Bước 3 - Kiểm tra điều khiển 2 chiều (Web / Telegram -> ESP32):**
   - Trên Web: Bấm nút **🚨 Hú Còi Răn Đe Bạo Lực** hoặc nhấn giữ nút tròn **NHẤN GIỮ ĐỂ NÓI** -> Loa hộp 4Ω 3W (3020) và đèn LED đỏ cảnh báo cửa (GPIO 15) trên sa bàn phản hồi ngay trong 1–2 giây.
   - Trên Telegram: Khi có tin nhắn báo động gửi về điện thoại, bấm thử các nút `[🔊 Hú Còi Răn Đe]`, `[⚠️ Nhắc Cấm Thuốc]`, `[👮 Bảo Vệ Đang Tới]`, `[✅ Hủy Báo Động]` -> Nút phản hồi tức thì không xoay loading, mạch ESP32 thực thi lệnh và đồng bộ trạng thái lên Web.
4. **Bước 4 - Kiểm tra đổi ngưỡng logic & Reset WiFi khi mang đi thi:**
   - Sang **Tab 2 (Cài Đặt & Cấu Hình)**, kéo thanh trượt chỉnh ngưỡng và bấm **Áp dụng cài đặt xuống ESP32** -> ESP32 phát tiếng chuông xác nhận và lưu vĩnh viễn vào bộ nhớ Flash NVS.
   - Khi mang sa bàn sang phòng thi mới cần đổi mạng WiFi: Bấm nút **🔄 ĐẶT LẠI WIFI THIẾT BỊ (RESET WIFI)** trên Web (hoặc nhấn giữ nút BOOT trên mạch 3 giây) -> ESP32 phát WiFi `KHKT-SmartRestroom-Setup` (mật khẩu `12345678`) để chọn mạng WiFi phòng thi ngay trên điện thoại.
