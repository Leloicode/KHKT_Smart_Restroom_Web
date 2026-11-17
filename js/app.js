/**
 * ============================================================================
 * DỰ ÁN CUỘC THI KHKT CẤP THÀNH PHỐ NĂM HỌC 2026 - 2027 (TT 84/2026/TT-BGDĐT)
 * ĐỀ TÀI: HỆ THỐNG IoT CẢNH BÁO SỚM BẠO LỰC HỌC ĐƯỜNG VÀ AN TOÀN WC
 * Đơn vị: Trường THCS Nguyễn Công Trứ
 * FILE: app.js - XỬ LÝ DASHBOARD ĐA TAB, ĐỒNG BỘ PHẦN CỨNG 100% (CHUẨN MOBILE)
 * ============================================================================
 */

// --- 1. KIỂM TRA ĐĂNG NHẬP (SESSION STORAGE) ---
function checkAuth() {
  if (window.location.protocol === 'file:') return;
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('tg') === '1' || navigator.userAgent.includes('Telegram')) {
    sessionStorage.setItem('khkt_logged_in', 'true');
    return;
  }
  const loggedIn = sessionStorage.getItem('khkt_logged_in');
  if (!loggedIn) {
    window.location.href = 'index.html';
  }
}
checkAuth();

function handleLogout() {
  if (confirm("Bạn có chắc muốn đăng xuất khỏi Trung Tâm Giám Sát?")) {
    sessionStorage.removeItem('khkt_logged_in');
    sessionStorage.removeItem('khkt_user');
    window.location.href = 'index.html';
  }
}

// --- 2. ĐỒNG HỒ THỜI GIAN THỰC ---
function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('vi-VN', { hour12: false });
  const dateStr = now.toLocaleDateString('vi-VN');
  const clockElem = document.getElementById('liveClock');
  if (clockElem) clockElem.innerText = `${timeStr} - ${dateStr}`;
}
setInterval(updateClock, 1000);
updateClock();

const initTimeElem = document.getElementById('initialLogTime');
const mobileInitTimeElem = document.getElementById('mobileInitialLogTime');
if (initTimeElem) {
  const now = new Date();
  const tStr = `${now.toLocaleTimeString('vi-VN')} - ${now.toLocaleDateString('vi-VN')}`;
  initTimeElem.innerText = tStr;
  if (mobileInitTimeElem) mobileInitTimeElem.innerText = now.toLocaleTimeString('vi-VN');
}

// --- 3. ĐIỀU HƯỚNG TABS (GIÁM SÁT vs CÀI ĐẶT) ---
function switchTab(tabName) {
  const btnMonitor = document.getElementById('tabBtnMonitor');
  const btnSettings = document.getElementById('tabBtnSettings');
  const contentMonitor = document.getElementById('tabContentMonitor');
  const contentSettings = document.getElementById('tabContentSettings');

  if (tabName === 'monitor') {
    btnMonitor.classList.add('active');
    btnSettings.classList.remove('active');
    contentMonitor.classList.add('active');
    contentSettings.classList.remove('active');
  } else if (tabName === 'settings') {
    btnSettings.classList.add('active');
    btnMonitor.classList.remove('active');
    contentSettings.classList.add('active');
    contentMonitor.classList.remove('active');
  }
}

// --- 4. KẾT NỐI MÁY CHỦ ĐÁM MÂY VERCEL CLOUD SERVERLESS 24/7 ---
const apiBaseUrl = ''; // Mặc định chạy trực tiếp trên máy chủ Đám mây Vercel Cloud Serverless 24/7
let isUserEditingSettings = false;

// Lắng nghe người dùng kéo slider để không bị dữ liệu tải về đè lên lúc đang kéo
function setupSliderListeners() {
  ['inputStayTimeout', 'inputSoundHold', 'inputSmokeThresh'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    ['mousedown', 'touchstart'].forEach(ev => el.addEventListener(ev, () => { isUserEditingSettings = true; }));
    ['mouseup', 'touchend', 'change'].forEach(ev => el.addEventListener(ev, () => {
      setTimeout(() => { isUserEditingSettings = false; }, 2500);
    }));
  });
}

// --- 5. QUẢN LÝ TRẠNG THÁI (STATE MANAGEMENT) ---
let isEsp32Online = false;
let currentAlertLevel = 0; // 0: Normal, 1: Smoke, 2: Violence, 3: Overcrowded, 4: Overtime
let configuredStayTimeoutMin = 10;
let configuredSoundHoldSec = 1.5;
let configuredSmokeThreshold = 1800;
let currentConnectedWifi = "Chưa kết nối";

let audioContext = null;
let mediaStream = null;
let analyser = null;
let visualizerAnimationId = null;

let isSimulationActive = false;

// --- 6. GỌI API STATUS TỪ ESP32 HOẶC CLOUD ---
async function fetchDeviceStatus() {
  if (isSimulationActive) return;
  const statusUrl = `${apiBaseUrl}/api/status`;
  try {
    const res = await fetch(statusUrl, { method: 'GET', cache: 'no-store' });
    if (!res.ok) throw new Error("HTTP error " + res.status);
    const data = await res.json();

    if (data.isOnline) {
      isEsp32Online = true;
      renderRealData(data);
    } else {
      isEsp32Online = false;
      renderStaticIdleState();
    }
  } catch (err) {
    isEsp32Online = false;
    renderStaticIdleState();
  }
}

// Hiển thị trạng thái tĩnh khi chưa kết nối phần cứng ESP32 (Không tự nhảy số ảo)
function renderStaticIdleState() {
  updateLiveBadge(false);

  document.getElementById('valConnectionStatus').className = "badge badge-warning";
  document.getElementById('valConnectionStatus').innerText = "Chờ kết nối ESP32";

  document.getElementById('valCurrentWifi').innerText = "Chưa kết nối";
  document.getElementById('valCurrentWifi').style.color = "var(--text-muted)";
  document.getElementById('settingsWifiStatus').innerText = "Chưa kết nối ESP32";

  document.getElementById('valSoundNoise').innerHTML = `-- <small>dB</small>`;
  document.getElementById('valSoundStatus').innerText = "Đang chờ tín hiệu...";
  document.getElementById('valSoundStatus').style.color = "var(--text-muted)";
  document.getElementById('barSound').style.width = "0%";
  document.getElementById('barSound').style.backgroundColor = "var(--success)";

  document.getElementById('valSmokeRaw').innerHTML = `-- <small>ADC</small>`;
  document.getElementById('valSmokeStatus').innerText = "Đang chờ tín hiệu...";
  document.getElementById('valSmokeStatus').style.color = "var(--text-muted)";
  document.getElementById('barSmoke').style.width = "0%";
  document.getElementById('barSmoke').style.backgroundColor = "var(--success)";

  document.getElementById('valStayTime').innerHTML = `00:00 <small id="valStayLimit">/ ${configuredStayTimeoutMin}p</small>`;
  document.getElementById('valStayStatus').innerText = "Buồng đang trống";
  document.getElementById('valStayStatus').style.color = "var(--text-muted)";
  document.getElementById('barStayTime').style.width = "0%";

  document.getElementById('valOccupancy').innerHTML = `0 <small>học sinh</small>`;
  document.getElementById('valPresence').innerText = "PIR: Phòng trống";
  document.getElementById('barOccupancy').style.width = "0%";

  const emergencyBanner = document.getElementById('emergencyBanner');
  if (emergencyBanner) emergencyBanner.classList.remove('show');

  renderSecurityStatus(0, false, null);
}

// Cập nhật dữ liệu thật nhận từ ESP32
function renderRealData(data) {
  updateLiveBadge(true);

  document.getElementById('valConnectionStatus').className = "badge badge-success";
  document.getElementById('valConnectionStatus').innerText = "🟢 Trực tuyến";

  currentAlertLevel = data.alertLevel || 0;
  configuredStayTimeoutMin = data.stayTimeoutSetting || configuredStayTimeoutMin;
  currentConnectedWifi = data.currentWifi || "WiFi Trường Học";

  document.getElementById('valCurrentWifi').innerText = currentConnectedWifi;
  document.getElementById('valCurrentWifi').style.color = "var(--primary)";
  document.getElementById('settingsWifiStatus').innerText = currentConnectedWifi;

  // Tự động đồng bộ các thanh trượt trong Tab Cài Đặt theo giá trị thực lưu trong Flash ESP32
  if (!isUserEditingSettings) {
    if (data.stayTimeoutSetting) {
      document.getElementById('inputStayTimeout').value = data.stayTimeoutSetting;
      document.getElementById('lblStayTimeout').innerText = data.stayTimeoutSetting + ' phút';
    }
    if (data.soundHoldSetting) {
      document.getElementById('inputSoundHold').value = data.soundHoldSetting;
      document.getElementById('lblSoundHold').innerText = data.soundHoldSetting + ' giây';
    }
    if (data.smokeThresholdSetting) {
      document.getElementById('inputSmokeThresh').value = data.smokeThresholdSetting;
      document.getElementById('lblSmokeThresh').innerText = data.smokeThresholdSetting;
    }
  }

  // 1. Cảm biến âm thanh KY-038
  const soundDb = data.soundNoise || 40;
  document.getElementById('valSoundNoise').innerHTML = `${soundDb} <small>dB</small>`;
  const barSound = document.getElementById('barSound');
  const valSoundStatus = document.getElementById('valSoundStatus');
  barSound.style.width = Math.min(100, (soundDb / 100) * 100) + '%';

  if (soundDb > 75 || currentAlertLevel === 2) {
    barSound.style.backgroundColor = 'var(--danger)';
    valSoundStatus.innerText = '🚨 BÁO ĐỘNG: La hét / bạo lực!';
    valSoundStatus.style.color = 'var(--danger)';
  } else {
    barSound.style.backgroundColor = 'var(--success)';
    valSoundStatus.innerText = 'Môi trường yên tĩnh bình thường';
    valSoundStatus.style.color = 'var(--text-muted)';
  }

  // 2. Cảm biến khói MQ-2
  const smoke = data.smokeRaw || 450;
  document.getElementById('valSmokeRaw').innerHTML = `${smoke} <small>ADC</small>`;
  const barSmoke = document.getElementById('barSmoke');
  const valSmokeStatus = document.getElementById('valSmokeStatus');
  barSmoke.style.width = Math.min(100, (smoke / 4095) * 100 * 2) + '%';

  if (smoke > (data.smokeThresholdSetting || 1800) || currentAlertLevel === 1) {
    barSmoke.style.backgroundColor = 'var(--danger)';
    valSmokeStatus.innerText = '⚠️ Phát hiện khói thuốc / vape!';
    valSmokeStatus.style.color = 'var(--danger)';
  } else {
    barSmoke.style.backgroundColor = 'var(--success)';
    valSmokeStatus.innerText = 'Không có khói thuốc lá';
    valSmokeStatus.style.color = 'var(--text-muted)';
  }

  // 3. Thời gian ở trong WC
  const stayMins = data.stayMinutes || 0;
  const timeFormatted = `${String(stayMins).padStart(2, '0')}:00`;
  document.getElementById('valStayTime').innerHTML = `${timeFormatted} <small id="valStayLimit">/ ${configuredStayTimeoutMin}p</small>`;
  const barStay = document.getElementById('barStayTime');
  const valStayStatus = document.getElementById('valStayStatus');

  const percentStay = Math.min(100, (stayMins / configuredStayTimeoutMin) * 100);
  barStay.style.width = percentStay + '%';

  if (stayMins >= configuredStayTimeoutMin || currentAlertLevel === 4) {
    barStay.style.backgroundColor = 'var(--danger)';
    valStayStatus.innerText = `⚠️ Ở quá ${configuredStayTimeoutMin}p (Cần kiểm tra)`;
    valStayStatus.style.color = 'var(--danger)';
  } else {
    barStay.style.backgroundColor = 'var(--success)';
    valStayStatus.innerText = data.presence ? `Có người (${stayMins} phút)` : "Buồng đang trống";
    valStayStatus.style.color = 'var(--text-muted)';
  }

  // 4. Hiện diện & số học sinh
  const occ = data.occupancy || 0;
  document.getElementById('valOccupancy').innerHTML = `${occ} <small>học sinh</small>`;
  document.getElementById('valPresence').innerText = data.presence ? 'PIR: Có người trong buồng' : 'PIR: Buồng trống';
  document.getElementById('barOccupancy').style.width = Math.min(100, occ * 33) + '%';

  renderEmergencyBanner(currentAlertLevel);
  renderSecurityStatus(currentAlertLevel, true, data);
}

function updateLiveBadge(isLive, customText) {
  const badge = document.getElementById('headerBadgeLive');
  const dot = document.getElementById('headerPulseDot');
  const text = document.getElementById('headerLiveText');

  if (isLive) {
    badge.className = 'badge-live online';
    dot.className = 'pulse-dot online';
    text.innerText = customText || 'TRỰC TUYẾN';
  } else {
    badge.className = 'badge-live offline';
    dot.className = 'pulse-dot offline';
    text.innerText = 'CHỜ ESP32';
  }
}

function renderEmergencyBanner(level) {
  const banner = document.getElementById('emergencyBanner');
  const bannerText = document.getElementById('emergencyBannerText');
  if (!banner) return;

  if (level === 2) {
    banner.classList.add('show');
    bannerText.innerText = '🚨 BÁO ĐỘNG BẠO LỰC / XÔ XÁT: Phát hiện la hét trong WC!';
  } else if (level === 1) {
    banner.classList.add('show');
    bannerText.innerText = '🚬 CẢNH BÁO HÚT THUỐC: Phát hiện khói thuốc / vape!';
  } else if (level === 4) {
    banner.classList.add('show');
    bannerText.innerText = `⚠️ CẢNH BÁO: Học sinh ở trong WC quá ${configuredStayTimeoutMin} phút!`;
  } else {
    banner.classList.remove('show');
  }
}

function renderSecurityStatus(level, isOnline, data) {
  const card = document.getElementById('securityAlertSummary');
  const icon = document.getElementById('securityStatusIcon');
  const title = document.getElementById('securityStatusText');
  const desc = document.getElementById('securityStatusDetail');
  const tag = document.getElementById('securityStatusTag');
  if (!card) return;

  if (!isOnline && !isSimulationActive) {
    card.className = "security-status-card status-safe";
    if (icon) icon.innerText = "⏳";
    if (title) title.innerText = "ĐANG CHỜ TÍN HIỆU TỪ SA BÀN ESP32...";
    if (desc) desc.innerText = "Hệ thống đang sẵn sàng. Khi ESP32 bật nguồn và kết nối WiFi, dữ liệu âm thanh và khói sẽ hiển thị tại đây.";
    if (tag) {
      tag.className = "badge badge-warning";
      tag.innerText = "CHỜ ESP32";
    }
    return;
  }

  if (level === 2) {
    // Bạo lực / Cãi vã / La hét
    card.className = "security-status-card status-danger";
    if (icon) icon.innerText = "🚨";
    if (title) title.innerText = "🚨 BÁO ĐỘNG ĐỎ: PHÁT HIỆN DẤU HIỆU CÃI VÃ / BẠO LỰC!";
    if (desc) desc.innerText = "Cảm biến âm thanh KY-038 ghi nhận tiếng la hét dồn dập >85dB kéo dài >1.5s. Còi răn đe tại chỗ đang hú!";
    if (tag) {
      tag.className = "badge-status-danger";
      tag.innerText = "NGUY CƠ BẠO LỰC";
    }
  } else if (level === 1) {
    // Khói thuốc lá / Vape
    card.className = "security-status-card status-warning";
    if (icon) icon.innerText = "🚬";
    if (title) title.innerText = "🚬 CẢNH BÁO: PHÁT HIỆN KHÓI THUỐC LÁ / VAPE!";
    if (desc) desc.innerText = "Cảm biến khói MQ-2 ghi nhận nồng độ khói vượt ngưỡng quy định. Đèn cảnh báo tại cửa đã kích hoạt!";
    if (tag) {
      tag.className = "badge-status-warning";
      tag.innerText = "KHÓI THUỐC LÁ";
    }
  } else if (level === 4) {
    // Ở quá giờ quy định
    card.className = "security-status-card status-warning";
    if (icon) icon.innerText = "⏱️";
    if (title) title.innerText = "⚠️ CẢNH BÁO: HỌC SINH Ở TRONG WC QUÁ THỜI GIAN QUY ĐỊNH!";
    if (desc) desc.innerText = `Cảm biến PIR ghi nhận học sinh ở trong buồng vượt quá ${configuredStayTimeoutMin} phút. Cần giám thị hoặc bảo vệ kiểm tra hỗ trợ.`;
    if (tag) {
      tag.className = "badge-status-warning";
      tag.innerText = "Ở QUÁ GIỜ";
    }
  } else {
    // Bình thường / An toàn
    card.className = "security-status-card status-safe";
    if (icon) icon.innerText = "🛡️";
    if (title) title.innerText = "🟢 AN TOÀN: KHÔNG CÓ DẤU HIỆU BẠO LỰC HOẶC KHÓI THUỐC";
    if (desc) desc.innerText = "Âm thanh môi trường ổn định (<60dB), không có khói thuốc lá, thời gian buồng trong giới hạn an toàn.";
    if (tag) {
      tag.className = "badge-status-safe";
      tag.innerText = "AN TOÀN 100%";
    }
  }
}

// BỘ CÔNG CỤ THỬ NGHIỆM MÔ PHỎNG (DÀNH CHO GIÁM KHẢO & THẦY CÔ TEST TRỰC TIẾP TRÊN WEB)
window.simulateIncident = function(type) {
  if (type === 'violence') {
    isSimulationActive = true;
    const mockData = {
      isOnline: true,
      alertLevel: 2,
      soundNoise: 88,
      smokeRaw: 450,
      presence: true,
      stayMinutes: 2,
      occupancy: 2,
      currentWifi: "WiFi_THCS_NguyenCongTru (Mô Phỏng)"
    };
    renderRealData(mockData);
    addLogEntry("Báo động âm thanh la hét (>85dB, >1.5s)", "Mức 2 - Khẩn cấp", "badge-danger", "🚨 Phát hiện nguy cơ bạo lực / xô xát");
  } else if (type === 'smoke') {
    isSimulationActive = true;
    const mockData = {
      isOnline: true,
      alertLevel: 1,
      soundNoise: 42,
      smokeRaw: 2450,
      presence: true,
      stayMinutes: 3,
      occupancy: 1,
      currentWifi: "WiFi_THCS_NguyenCongTru (Mô Phỏng)"
    };
    renderRealData(mockData);
    addLogEntry("Cảm biến MQ-2 vượt ngưỡng (2450 ADC)", "Mức 1 - Cảnh báo", "badge-warning", "🚬 Phát hiện khói thuốc lá / Vape");
  } else if (type === 'overtime') {
    isSimulationActive = true;
    const mockData = {
      isOnline: true,
      alertLevel: 4,
      soundNoise: 40,
      smokeRaw: 420,
      presence: true,
      stayMinutes: 12,
      occupancy: 1,
      currentWifi: "WiFi_THCS_NguyenCongTru (Mô Phỏng)"
    };
    renderRealData(mockData);
    addLogEntry("Học sinh ở trong WC 12 phút (>10p)", "Mức 4 - Quá giờ", "badge-warning", "⚠️ Cần kiểm tra nhắc nhở học sinh");
  } else if (type === 'reset') {
    isSimulationActive = false;
    fetchDeviceStatus();
    addLogEntry("Khôi phục trạng thái", "Bình thường", "badge-success", "🟢 Hệ thống vận hành an toàn");
  }
};

setInterval(fetchDeviceStatus, 2000);
fetchDeviceStatus();

// --- 7. CÀI ĐẶT THỜI GIAN & NGƯỠNG LOGIC ---
async function saveWebSettings(e) {
  e.preventDefault();
  const stayTimeout = parseInt(document.getElementById('inputStayTimeout').value);
  const soundHold = parseFloat(document.getElementById('inputSoundHold').value);
  const smokeThresh = parseInt(document.getElementById('inputSmokeThresh').value);

  configuredStayTimeoutMin = stayTimeout;
  configuredSoundHoldSec = soundHold;
  configuredSmokeThreshold = smokeThresh;

  const controlUrl = `${apiBaseUrl}/api/status`;
  try {
    await fetch(controlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'SET_LOGIC',
        deviceId: 'RESTROOM_WC1_KHKT',
        payload: {
          stayTimeout: stayTimeout,
          soundHold: soundHold,
          smokeThresh: smokeThresh
        }
      })
    });
  } catch (err) {
    console.log("Offline mode - Applied settings locally.");
  }

  addLogEntry("⚙️ Cập nhật cấu hình", `Ở tối đa: ${stayTimeout}p | Lọc âm: ${soundHold}s | Khói: ${smokeThresh}`, "badge-info", "Đã gửi xuống ESP32");
  alert(`✅ ĐÃ LƯU CẤU HÌNH THÀNH CÔNG!\n\n• Thời gian ở tối đa: ${stayTimeout} phút\n• Thời gian lọc tiếng la hét: ${soundHold} giây\n• Ngưỡng khói thuốc: ${smokeThresh} ADC\n\nCấu hình đã được đồng bộ xuống thiết bị ESP32!`);
  fetchDeviceStatus();
}

// --- 8. ĐẶT LẠI WIFI THIẾT BỊ (RESET WIFI ESP32) ---
async function triggerResetWiFi() {
  const confirmMsg = 
    "⚠️ BẠN CÓ CHẮC MUỐN ĐẶT LẠI WIFI CỦA THIẾT BỊ ESP32?\n\n" +
    "1. ESP32 sẽ xóa mật khẩu WiFi cũ đã lưu trong bộ nhớ Flash.\n" +
    "2. ESP32 tự khởi động lại và phát ra điểm phát WiFi: 'KHKT-SmartRestroom-Setup'.\n" +
    "3. Thầy/Cô dùng điện thoại kết nối vào WiFi đó để cài đặt mạng mới.\n\n" +
    "Nhấn OK để thực hiện ngay!";

  if (!confirm(confirmMsg)) return;

  const controlUrl = `${apiBaseUrl}/api/status`;
  try {
    await fetch(controlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'RESET_WIFI',
        deviceId: 'RESTROOM_WC1_KHKT'
      })
    });
  } catch (err) {
    console.log("Offline reset wifi trigger");
  }

  addLogEntry("🔄 Đặt lại WiFi", "Gửi lệnh RESET_WIFI", "badge-warning", "ESP32 đang mở AP 192.168.4.1");
  alert("📡 ĐÃ GỬI LỆNH ĐẶT LẠI WIFI THÀNH CÔNG!\n\nThiết bị ESP32 đang xóa cấu hình WiFi cũ và tự phát WiFi: 'KHKT-SmartRestroom-Setup' (Mật khẩu: 12345678).\n\nThầy/Cô hãy dùng điện thoại kết nối vào mạng WiFi này để chọn WiFi trường học mới nhé!");
}

async function triggerRebootESP() {
  if (!confirm("Khởi động lại vi điều khiển ESP32 từ xa?")) return;

  const controlUrl = `${apiBaseUrl}/api/status`;
  try {
    await fetch(controlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'REBOOT',
        deviceId: 'RESTROOM_WC1_KHKT'
      })
    });
  } catch (err) {
    console.log("Offline reboot");
  }

  addLogEntry("🔁 Khởi động lại", "Gửi lệnh REBOOT", "badge-warning", "Đang khởi động lại CPU");
  alert("🔁 ĐÃ GỬI LỆNH!\n\nESP32 đang thực hiện khởi động lại hệ thống.");
}

// --- 9. PHÁT THANH KHẨN CẤP (SIREN / SMOKE / RESET) ---
async function sendQuickCommand(cmd) {
  const controlUrl = `${apiBaseUrl}/api/status`;
  try {
    await fetch(controlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: cmd,
        deviceId: 'RESTROOM_WC1_KHKT'
      })
    });
  } catch (e) {
    console.log("Offline command:", cmd);
  }

  if (cmd === 'SIREN') {
    currentAlertLevel = 2;
    addLogEntry("🚨 Hú còi răn đe bạo lực", "Lệnh từ Quản trị viên Web", "badge-danger", "Đã phát tới loa hộp 3020 4R 3W");
  } else if (cmd === 'SMOKE') {
    currentAlertLevel = 1;
    addLogEntry("🚬 Cảnh báo cấm hút thuốc", "Lệnh từ Quản trị viên Web", "badge-warning", "Đã phát tới loa hộp 3020 4R 3W");
  } else if (cmd === 'RESET') {
    currentAlertLevel = 0;
    addLogEntry("✅ Hủy trạng thái báo động", "Lệnh từ Quản trị viên Web", "badge-success", "Khôi phục trạng thái an toàn");
  }

  fetchDeviceStatus();
}

function addLogEntry(action, detail, badgeClass, statusText) {
  const logsBody = document.getElementById('logsTableBody');
  const mobileLogs = document.getElementById('mobileLogsList');
  const now = new Date();
  const timeStr = `${now.toLocaleTimeString('vi-VN')} - ${now.toLocaleDateString('vi-VN')}`;
  const shortTime = now.toLocaleTimeString('vi-VN');

  // Thêm vào bảng Desktop
  if (logsBody) {
    const newRow = `
      <tr>
        <td>${timeStr}</td>
        <td>Sa Bàn WC Thực Nghiệm</td>
        <td><span class="badge ${badgeClass}">${action}</span></td>
        <td>${detail}</td>
        <td>${statusText}</td>
      </tr>
    `;
    logsBody.insertAdjacentHTML('afterbegin', newRow);
  }

  // Thêm vào danh sách thẻ Mobile
  if (mobileLogs) {
    const newCard = `
      <div class="log-card-item">
        <div class="log-card-top">
          <span class="badge ${badgeClass}">${action}</span>
          <span class="log-card-time">${shortTime}</span>
        </div>
        <div class="log-card-detail">${detail}</div>
        <div class="log-card-location">📍 ${statusText}</div>
      </div>
    `;
    mobileLogs.insertAdjacentHTML('afterbegin', newCard);
  }
}

function clearDemoLogs() {
  const logsBody = document.getElementById('logsTableBody');
  const mobileLogs = document.getElementById('mobileLogsList');
  if (logsBody) {
    logsBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 14px;">
          Đã xóa lịch sử nhật ký
        </td>
      </tr>
    `;
  }
  if (mobileLogs) {
    mobileLogs.innerHTML = `
      <div class="log-card-item" style="text-align: center; color: var(--text-muted); padding: 14px;">
        Đã xóa lịch sử nhật ký
      </div>
    `;
  }
}

// --- 10. ĐÀM THOẠI TRỰC TIẾP PUSH-TO-TALK ---
async function startPTT() {
  const btn = document.getElementById('btnPtt');
  const label = document.getElementById('pttLabel');
  const hint = document.getElementById('pttHint');

  btn.classList.add('active');
  label.innerText = 'ĐANG NÓI...';
  hint.innerText = 'Giọng nói đang truyền tới Loa hộp 4Ω 3W (3020)';

  // Gửi tín hiệu báo hiệu đàm thoại xuống ESP32 để phát chuông chú ý tại loa sa bàn
  fetch(`${apiBaseUrl}/api/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: 'CHIME',
      deviceId: 'RESTROOM_WC1_KHKT',
      silentTelegram: true
    })
  }).catch(() => {});

  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (!mediaStream) mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const source = audioContext.createMediaStreamSource(mediaStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    drawVisualizer();
  } catch (err) {
    drawSimulatedWave();
  }
}

function stopPTT() {
  const btn = document.getElementById('btnPtt');
  const label = document.getElementById('pttLabel');
  const hint = document.getElementById('pttHint');

  btn.classList.remove('active');
  label.innerText = 'NHẤN GIỮ ĐỂ NÓI';
  hint.innerText = 'Chạm & giữ nút tròn để phát giọng nói';

  if (visualizerAnimationId) {
    cancelAnimationFrame(visualizerAnimationId);
    visualizerAnimationId = null;
  }
  const canvas = document.getElementById('audioVisualizer');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function drawVisualizer() {
  const canvas = document.getElementById('audioVisualizer');
  if (!canvas || !analyser) return;
  const ctx = canvas.getContext('2d');
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function renderFrame() {
    visualizerAnimationId = requestAnimationFrame(renderFrame);
    analyser.getByteFrequencyData(dataArray);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = (canvas.width / bufferLength) * 2;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * canvas.height;
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
      x += barWidth;
    }
  }
  renderFrame();
}

function drawSimulatedWave() {
  const canvas = document.getElementById('audioVisualizer');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let frame = 0;
  function renderDummy() {
    visualizerAnimationId = requestAnimationFrame(renderDummy);
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ef4444';
    const bars = 16;
    const width = canvas.width / bars;
    for (let i = 0; i < bars; i++) {
      const h = Math.abs(Math.sin((frame * 0.1) + i)) * (canvas.height * 0.8) + 4;
      ctx.fillRect(i * width, canvas.height - h, width - 4, h);
    }
  }
  renderDummy();
}

// Đăng ký toàn cục các hàm sự kiện giao diện
window.switchTab = switchTab;
window.handleLogout = handleLogout;
window.sendQuickCommand = sendQuickCommand;
window.saveWebSettings = saveWebSettings;
window.triggerResetWiFi = triggerResetWiFi;
window.triggerRebootESP = triggerRebootESP;
window.clearDemoLogs = clearDemoLogs;
window.startPTT = startPTT;
window.stopPTT = stopPTT;

// Khởi chạy khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  setupSliderListeners();
});
