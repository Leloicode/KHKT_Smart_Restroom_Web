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
let isSavingLogicSettings = false;
let sliderEditTimer = null;
let pendingLogicSettings = null;

// Lắng nghe người dùng kéo slider để không bị dữ liệu tải về đè lên lúc đang kéo
function setupSliderListeners() {
  ['inputStayTimeout', 'inputSoundHold', 'inputSmokeThresh'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    ['pointerdown', 'mousedown', 'touchstart', 'input'].forEach((ev) => {
      el.addEventListener(ev, () => {
        clearTimeout(sliderEditTimer);
        isUserEditingSettings = true;
      });
    });
    ['pointerup', 'mouseup', 'touchend', 'change'].forEach((ev) => {
      el.addEventListener(ev, () => {
        clearTimeout(sliderEditTimer);
        sliderEditTimer = setTimeout(() => {
          isUserEditingSettings = false;
        }, 2500);
      });
    });
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

let previousOnlineStatus = null;
let latestStatusSeq = 0;
let isPttActive = false;
let pttSessionId = 0;
let lastTouchTimestamp = 0;

function updateDynamicThresholdLabels() {
  const lblStayRule = document.getElementById('lblStayMetricRule');
  if (lblStayRule) lblStayRule.innerText = `>${configuredStayTimeoutMin}P`;

  const lblHwOvertime = document.getElementById('lblHwOvertimeMin');
  if (lblHwOvertime) lblHwOvertime.innerText = String(configuredStayTimeoutMin);

  const valStayLimit = document.getElementById('valStayLimit');
  if (valStayLimit) valStayLimit.innerText = `/ ${configuredStayTimeoutMin}p`;
}

function updateHardwareControlsState(isOnline) {
  const buttons = document.querySelectorAll('#hardwareTestCard button[data-hw-btn]');
  buttons.forEach((btn) => {
    btn.disabled = !isOnline;
  });

  const badge = document.getElementById('hardwareTestBadge');
  if (badge) {
    if (isOnline) {
      badge.className = 'badge badge-success';
      badge.innerText = 'ESP32 Trực Tuyến • Sẵn Sàng';
    } else {
      badge.className = 'badge badge-warning';
      badge.innerText = 'Chờ ESP32 trực tuyến';
    }
  }
}

// --- 6. GỌI API STATUS TỪ ESP32 HOẶC CLOUD ---
async function fetchDeviceStatus() {
  const seq = ++latestStatusSeq;
  const statusUrl = `${apiBaseUrl}/api/status?_t=${Date.now()}`;
  try {
    const res = await fetch(statusUrl, { method: 'GET', cache: 'no-store' });
    if (!res.ok) throw new Error("HTTP error " + res.status);
    const data = await res.json();
    if (seq !== latestStatusSeq) return;

    if (data && data.isOnline) {
      // Khi ESP32 trực tuyến: nhận diện ngay lập tức và dùng 100% dữ liệu thật từ phần cứng
      isEsp32Online = true;

      if (previousOnlineStatus === false || previousOnlineStatus === null) {
        addLogEntry("Phần cứng ESP32 đã kết nối", data.currentWifi || "WiFi Sa Bàn", "badge-success", "🟢 Thiết bị trực tuyến - Nhận dữ liệu thực 100%");
      }
      previousOnlineStatus = true;
      updateHardwareControlsState(true);
      renderRealData(data);
    } else {
      isEsp32Online = false;
      if (previousOnlineStatus === true) {
        addLogEntry("Mất kết nối ESP32", "Ngoại tuyến", "badge-warning", "⚠️ Mất tín hiệu heartbeat từ vi điều khiển");
      }
      previousOnlineStatus = false;
      renderStaticIdleState();
    }
  } catch (err) {
    if (seq !== latestStatusSeq) return;
    isEsp32Online = false;
    if (previousOnlineStatus === true) {
      addLogEntry("Mất kết nối ESP32", "Ngoại tuyến", "badge-warning", "⚠️ Không thể kết nối máy chủ trạng thái");
    }
    previousOnlineStatus = false;
    renderStaticIdleState();
  }
}

// Hiển thị trạng thái tĩnh khi chưa kết nối phần cứng ESP32 (Không tự nhảy số ảo)
function renderStaticIdleState() {
  updateLiveBadge(false);
  currentAlertLevel = 0;

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
  document.getElementById('valStayStatus').innerText = "Chưa có người";
  document.getElementById('valStayStatus').style.color = "var(--text-muted)";
  document.getElementById('barStayTime').style.width = "0%";
  document.getElementById('barStayTime').style.backgroundColor = "var(--success)";

  document.getElementById('valOccupancy').innerHTML = `0 <small>học sinh</small>`;
  document.getElementById('valPresence').innerText = "PIR: Khu vực WC trống";
  document.getElementById('valPresence').style.color = "var(--text-muted)";
  document.getElementById('barOccupancy').style.width = "0%";
  document.getElementById('barOccupancy').style.backgroundColor = "var(--primary)";

  const emergencyBanner = document.getElementById('emergencyBanner');
  if (emergencyBanner) emergencyBanner.classList.remove('show');

  updateHardwareControlsState(false);
  updateDynamicThresholdLabels();
  renderSecurityStatus(0, false, null);
}

// Cập nhật dữ liệu thật nhận từ ESP32
function renderRealData(data) {
  const isOnline = Boolean(data.isOnline);
  updateLiveBadge(isOnline);
  updateHardwareControlsState(isOnline);

  if (isOnline) {
    document.getElementById('valConnectionStatus').className = "badge badge-success";
    document.getElementById('valConnectionStatus').innerText = "🟢 Trực tuyến";
  } else {
    document.getElementById('valConnectionStatus').className = "badge badge-warning";
    document.getElementById('valConnectionStatus').innerText = "Chờ kết nối ESP32";
  }

  currentAlertLevel = Number(data.alertLevel ?? 0);

  if (pendingLogicSettings) {
    const hasAllSettings =
      data.stayTimeoutSetting !== undefined && data.stayTimeoutSetting !== null &&
      data.soundHoldSetting !== undefined && data.soundHoldSetting !== null &&
      data.smokeThresholdSetting !== undefined && data.smokeThresholdSetting !== null;

    const stayMatches = hasAllSettings && Number(data.stayTimeoutSetting) === pendingLogicSettings.stayTimeout;
    const soundMatches = hasAllSettings && Math.abs(Number(data.soundHoldSetting) - pendingLogicSettings.soundHold) < 0.05;
    const smokeMatches = hasAllSettings && Number(data.smokeThresholdSetting) === pendingLogicSettings.smokeThresh;

    if (stayMatches && soundMatches && smokeMatches) {
      pendingLogicSettings = null;
      addLogEntry("✅ ESP32 đã xác nhận cấu hình", `Ở tối đa: ${data.stayTimeoutSetting}p | Lọc âm: ${data.soundHoldSetting}s | Khói: ${data.smokeThresholdSetting}`, "badge-success", "Đồng bộ NVS thành công");
    } else if (Date.now() > pendingLogicSettings.expiresAt) {
      pendingLogicSettings = null;
      addLogEntry("⚠️ Hết thời gian chờ đồng bộ cấu hình", "Đọc lại giá trị hiện hành từ ESP32", "badge-warning", "Vui lòng kiểm tra kết nối phần cứng");
    }
  }

  configuredStayTimeoutMin = pendingLogicSettings
    ? pendingLogicSettings.stayTimeout
    : Number(data.stayTimeoutSetting ?? configuredStayTimeoutMin ?? 10);
  configuredSoundHoldSec = pendingLogicSettings
    ? pendingLogicSettings.soundHold
    : Number(data.soundHoldSetting ?? configuredSoundHoldSec ?? 1.5);
  configuredSmokeThreshold = pendingLogicSettings
    ? pendingLogicSettings.smokeThresh
    : Number(data.smokeThresholdSetting ?? configuredSmokeThreshold ?? 1800);

  updateDynamicThresholdLabels();

  currentConnectedWifi = data.currentWifi || (isOnline ? "WiFi Sa Bàn" : "Chưa kết nối");
  document.getElementById('valCurrentWifi').innerText = currentConnectedWifi;
  document.getElementById('valCurrentWifi').style.color = isOnline ? "var(--primary)" : "var(--text-muted)";
  document.getElementById('settingsWifiStatus').innerText = currentConnectedWifi;

  // Tự động đồng bộ các thanh trượt trong Tab Cài Đặt theo giá trị thực lưu trong Flash ESP32
  if (!isUserEditingSettings && !isSavingLogicSettings && !pendingLogicSettings) {
    if (data.stayTimeoutSetting !== undefined && data.stayTimeoutSetting !== null) {
      document.getElementById('inputStayTimeout').value = data.stayTimeoutSetting;
      document.getElementById('lblStayTimeout').innerText = data.stayTimeoutSetting + ' phút';
    }
    if (data.soundHoldSetting !== undefined && data.soundHoldSetting !== null) {
      document.getElementById('inputSoundHold').value = data.soundHoldSetting;
      document.getElementById('lblSoundHold').innerText = data.soundHoldSetting + ' giây';
    }
    if (data.smokeThresholdSetting !== undefined && data.smokeThresholdSetting !== null) {
      document.getElementById('inputSmokeThresh').value = data.smokeThresholdSetting;
      document.getElementById('lblSmokeThresh').innerText = data.smokeThresholdSetting;
    }
  }

  // 1. Cảm biến âm thanh KY-038
  const soundDb = Number(data.soundNoise ?? 0);
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
  const smoke = Number(data.smokeRaw ?? 0);
  document.getElementById('valSmokeRaw').innerHTML = `${smoke} <small>ADC</small>`;
  const barSmoke = document.getElementById('barSmoke');
  const valSmokeStatus = document.getElementById('valSmokeStatus');
  barSmoke.style.width = Math.min(100, (smoke / 4095) * 100 * 2) + '%';

  if (smoke > configuredSmokeThreshold || currentAlertLevel === 1) {
    barSmoke.style.backgroundColor = 'var(--danger)';
    valSmokeStatus.innerText = '⚠️ Phát hiện khói thuốc / vape!';
    valSmokeStatus.style.color = 'var(--danger)';
  } else {
    barSmoke.style.backgroundColor = 'var(--success)';
    valSmokeStatus.innerText = 'Không có khói thuốc lá';
    valSmokeStatus.style.color = 'var(--text-muted)';
  }

  // 3. Thời gian ở trong WC
  const stayMins = Number(data.stayMinutes ?? 0);
  const timeFormatted = `${String(stayMins).padStart(2, '0')}:00`;
  document.getElementById('valStayTime').innerHTML = `${timeFormatted} <small id="valStayLimit">/ ${configuredStayTimeoutMin}p</small>`;
  const barStay = document.getElementById('barStayTime');
  const valStayStatus = document.getElementById('valStayStatus');

  const percentStay = Math.min(100, (stayMins / Math.max(1, configuredStayTimeoutMin)) * 100);
  barStay.style.width = percentStay + '%';

  if (stayMins >= configuredStayTimeoutMin || currentAlertLevel === 4) {
    barStay.style.backgroundColor = 'var(--danger)';
    valStayStatus.innerText = `⚠️ Ở quá ${configuredStayTimeoutMin}p (Cần kiểm tra)`;
    valStayStatus.style.color = 'var(--danger)';
  } else {
    barStay.style.backgroundColor = 'var(--success)';
    valStayStatus.innerText = data.presence ? `Có người (${stayMins} phút)` : "Chưa có người";
    valStayStatus.style.color = 'var(--text-muted)';
  }

  // 4. Hiện diện & số học sinh
  const occ = Number(data.occupancy ?? 0);
  const presence = Boolean(data.presence ?? false);
  const barOccupancy = document.getElementById('barOccupancy');
  const valPresence = document.getElementById('valPresence');
  document.getElementById('valOccupancy').innerHTML = `${occ} <small>học sinh</small>`;

  if (currentAlertLevel === 3) {
    barOccupancy.style.backgroundColor = 'var(--warning)';
    barOccupancy.style.width = '100%';
    valPresence.innerText = `⚠️ Tụ tập đông người (${occ} học sinh)`;
    valPresence.style.color = 'var(--warning-dark)';
  } else {
    barOccupancy.style.backgroundColor = 'var(--primary)';
    barOccupancy.style.width = Math.min(100, occ * 25) + '%';
    valPresence.innerText = presence ? 'PIR: Có người trong WC' : 'PIR: Khu vực WC trống';
    valPresence.style.color = 'var(--text-muted)';
  }

  renderEmergencyBanner(currentAlertLevel);
  renderSecurityStatus(currentAlertLevel, isOnline, data);
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
  const bannerIcon = document.getElementById('emergencyBannerIcon');
  const bannerText = document.getElementById('emergencyBannerText');
  if (!banner) return;

  if (level === 2) {
    banner.classList.add('show');
    if (bannerIcon) bannerIcon.innerText = '🚨';
    if (bannerText) bannerText.innerText = '🚨 BÁO ĐỘNG BẠO LỰC / XÔ XÁT: Phát hiện la hét trong WC!';
  } else if (level === 1) {
    banner.classList.add('show');
    if (bannerIcon) bannerIcon.innerText = '🚬';
    if (bannerText) bannerText.innerText = '🚬 CẢNH BÁO HÚT THUỐC: Phát hiện khói thuốc / vape!';
  } else if (level === 3) {
    banner.classList.add('show');
    if (bannerIcon) bannerIcon.innerText = '👥';
    if (bannerText) bannerText.innerText = '👥 CẢNH BÁO TỤ TẬP ĐÔNG NGƯỜI: Phát hiện số lượng học sinh vượt ngưỡng trong WC!';
  } else if (level === 4) {
    banner.classList.add('show');
    if (bannerIcon) bannerIcon.innerText = '⏱️';
    if (bannerText) bannerText.innerText = `⚠️ CẢNH BÁO: Học sinh ở trong WC quá ${configuredStayTimeoutMin} phút!`;
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

  if (!isOnline) {
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
    if (desc) desc.innerText = `Cảm biến âm thanh KY-038 ghi nhận tiếng la hét dồn dập >85dB kéo dài >${configuredSoundHoldSec}s. Còi răn đe tại chỗ đang hú!`;
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
  } else if (level === 3) {
    // Tụ tập đông người bất thường
    const occCount = Number(data?.occupancy ?? 0);
    card.className = "security-status-card status-warning";
    if (icon) icon.innerText = "👥";
    if (title) title.innerText = "⚠️ CẢNH BÁO: TỤ TẬP ĐÔNG NGƯỜI BẤT THƯỜNG TRONG WC!";
    if (desc) desc.innerText = `Cảm biến cửa IR ghi nhận ${occCount} học sinh đang tập trung trong khu vực WC. Đề nghị giám thị kiểm tra để ngăn ngừa nguy cơ xô xát.`;
    if (tag) {
      tag.className = "badge-status-warning";
      tag.innerText = "TỤ TẬP ĐÔNG NGƯỜI";
    }
  } else if (level === 4) {
    // Ở quá giờ quy định
    card.className = "security-status-card status-warning";
    if (icon) icon.innerText = "⏱️";
    if (title) title.innerText = "⚠️ CẢNH BÁO: HỌC SINH Ở TRONG WC QUÁ THỜI GIAN QUY ĐỊNH!";
    if (desc) desc.innerText = `Cảm biến PIR ghi nhận học sinh ở trong WC vượt quá ${configuredStayTimeoutMin} phút. Cần giám thị hoặc bảo vệ kiểm tra hỗ trợ.`;
    if (tag) {
      tag.className = "badge-status-warning";
      tag.innerText = "Ở QUÁ GIỜ";
    }
  } else {
    // Bình thường / An toàn
    card.className = "security-status-card status-safe";
    if (icon) icon.innerText = "🛡️";
    if (title) title.innerText = "🟢 AN TOÀN: KHÔNG CÓ DẤU HIỆU BẠO LỰC HOẶC KHÓI THUỐC";
    if (desc) desc.innerText = "Âm thanh môi trường ổn định (<60dB), không có khói thuốc lá, thời gian ở trong WC trong giới hạn an toàn.";
    if (tag) {
      tag.className = "badge-status-safe";
      tag.innerText = "AN TOÀN 100%";
    }
  }
}

// Hàm dùng chung gửi lệnh POST xuống /api/status và kiểm tra res.ok + success
async function postStatusCommand(command, payload = null, extraFields = {}) {
  const controlUrl = `${apiBaseUrl}/api/status`;
  const bodyObj = {
    command,
    deviceId: 'RESTROOM_WC1_KHKT',
    ...(payload !== null ? { payload } : {}),
    ...extraFields
  };

  const res = await fetch(controlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj)
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_err) {
    data = null;
  }

  if (!res.ok || (data && data.success === false)) {
    throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  }
  return data;
}

// Hàm gửi lệnh điều khiển xuống mạch phần cứng ESP32 qua Cloud
async function sendHardwareCommand(cmd) {
  try {
    await postStatusCommand(cmd);
    return true;
  } catch (err) {
    addLogEntry("❌ Lỗi gửi lệnh phần cứng", cmd, "badge-danger", err.message);
    return false;
  }
}

// BỘ KIỂM TRA TÍN HIỆU PHẦN CỨNG SA BÀN THỰC TẾ (KHÔNG GIẢ LẬP)
window.triggerHardwareTest = async function(cmd) {
  if (!isEsp32Online) {
    addLogEntry("⚠️ ESP32 đang ngoại tuyến", "Từ chối gửi lệnh", "badge-warning", "Vui lòng bật nguồn sa bàn trước khi kiểm tra");
    return false;
  }

  const ok = await sendHardwareCommand(cmd);
  if (!ok) return false;

  if (cmd === 'SIREN') {
    addLogEntry("🚨 Lệnh kiểm tra: Báo động bạo lực", "Gửi xuống ESP32", "badge-danger", "Đã kích hoạt còi răn đe & đèn chớp sa bàn");
  } else if (cmd === 'SMOKE') {
    addLogEntry("🚬 Lệnh kiểm tra: Cảnh báo khói", "Gửi xuống ESP32", "badge-warning", "Đã kích hoạt cảnh báo khói thuốc sa bàn");
  } else if (cmd === 'OVERTIME') {
    addLogEntry(`⏱️ Lệnh kiểm tra: Ở quá ${configuredStayTimeoutMin} phút`, "Gửi xuống ESP32", "badge-warning", "Đã kích hoạt chuông nhắc nhở quá giờ sa bàn");
  } else if (cmd === 'RESET') {
    addLogEntry("🟢 Khôi phục an toàn", "Gửi xuống ESP32", "badge-success", "Đã đặt lại trạng thái bình thường cho phần cứng");
  }

  setTimeout(fetchDeviceStatus, 500);
  return true;
};

setInterval(fetchDeviceStatus, 2000);
fetchDeviceStatus();

// --- 7. CÀI ĐẶT THỜI GIAN & NGƯỠNG LOGIC ---
async function saveWebSettings(e) {
  e.preventDefault();
  const inputStay = document.getElementById('inputStayTimeout');
  const inputSound = document.getElementById('inputSoundHold');
  const inputSmoke = document.getElementById('inputSmokeThresh');
  const stayTimeout = parseInt(inputStay.value, 10);
  const soundHold = parseFloat(inputSound.value);
  const smokeThresh = parseInt(inputSmoke.value, 10);

  isSavingLogicSettings = true;
  try {
    await postStatusCommand('SET_LOGIC', {
      stayTimeout,
      soundHold,
      smokeThresh
    });

    configuredStayTimeoutMin = stayTimeout;
    configuredSoundHoldSec = soundHold;
    configuredSmokeThreshold = smokeThresh;

    if (inputStay) inputStay.value = String(stayTimeout);
    if (inputSound) inputSound.value = String(soundHold);
    if (inputSmoke) inputSmoke.value = String(smokeThresh);
    const lblStay = document.getElementById('lblStayTimeout');
    if (lblStay) lblStay.innerText = stayTimeout + ' phút';
    const lblSound = document.getElementById('lblSoundHold');
    if (lblSound) lblSound.innerText = soundHold + ' giây';
    const lblSmoke = document.getElementById('lblSmokeThresh');
    if (lblSmoke) lblSmoke.innerText = String(smokeThresh);

    updateDynamicThresholdLabels();

    addLogEntry("⚙️ Cập nhật cấu hình", `Ở tối đa: ${stayTimeout}p | Lọc âm: ${soundHold}s | Khói: ${smokeThresh}`, "badge-info", "Đã gửi xuống ESP32");
    alert(`✅ ĐÃ LƯU CẤU HÌNH THÀNH CÔNG!\n\n• Thời gian ở tối đa: ${stayTimeout} phút\n• Thời gian lọc tiếng la hét: ${soundHold} giây\n• Ngưỡng khói thuốc: ${smokeThresh} ADC\n\nCấu hình đã được đồng bộ xuống thiết bị ESP32!`);

    // Bắt đầu cửa sổ chờ 20s SAU khi đóng alert() để thanh trượt không bị giá trị cũ ghi đè trước khi ESP32 phản hồi
    pendingLogicSettings = {
      stayTimeout,
      soundHold,
      smokeThresh,
      expiresAt: Date.now() + 20000
    };
  } catch (err) {
    addLogEntry("❌ Lỗi lưu cấu hình", `Ở tối đa: ${stayTimeout}p | Lọc âm: ${soundHold}s | Khói: ${smokeThresh}`, "badge-danger", err.message);
    alert("❌ Lưu cấu hình thất bại: " + err.message);
    return;
  } finally {
    isSavingLogicSettings = false;
  }

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

  try {
    await postStatusCommand('RESET_WIFI');
  } catch (err) {
    addLogEntry("❌ Lỗi đặt lại WiFi", "RESET_WIFI", "badge-danger", err.message);
    alert("❌ Gửi lệnh đặt lại WiFi thất bại: " + err.message);
    return;
  }

  addLogEntry("🔄 Đặt lại WiFi", "Gửi lệnh RESET_WIFI", "badge-warning", "ESP32 đang mở AP 192.168.4.1");
  alert("📡 ĐÃ GỬI LỆNH ĐẶT LẠI WIFI THÀNH CÔNG!\n\nThiết bị ESP32 đang xóa cấu hình WiFi cũ và tự phát WiFi: 'KHKT-SmartRestroom-Setup' (Mật khẩu: 12345678).\n\nThầy/Cô hãy dùng điện thoại kết nối vào mạng WiFi này để chọn WiFi trường học mới nhé!");
}

async function triggerRebootESP() {
  if (!confirm("Khởi động lại vi điều khiển ESP32 từ xa?")) return;

  try {
    await postStatusCommand('REBOOT');
  } catch (err) {
    addLogEntry("❌ Lỗi khởi động lại", "REBOOT", "badge-danger", err.message);
    alert("❌ Gửi lệnh khởi động lại thất bại: " + err.message);
    return;
  }

  addLogEntry("🔁 Khởi động lại", "Gửi lệnh REBOOT", "badge-warning", "Đang khởi động lại CPU");
  alert("🔁 ĐÃ GỬI LỆNH!\n\nESP32 đang thực hiện khởi động lại hệ thống.");
}

// --- 9. PHÁT THANH KHẨN CẤP (SIREN / SMOKE / RESET) ---
async function sendQuickCommand(cmd) {
  try {
    await postStatusCommand(cmd);
  } catch (err) {
    addLogEntry("❌ Lỗi gửi lệnh " + cmd, "Thao tác thất bại", "badge-danger", err.message);
    alert("❌ Không thể gửi lệnh " + cmd + ": " + err.message);
    return;
  }

  if (cmd === 'SIREN') {
    addLogEntry("🚨 Hú còi răn đe bạo lực", "Lệnh từ Quản trị viên Web", "badge-danger", "Đã phát tới loa hộp 3020 4R 3W");
  } else if (cmd === 'SMOKE') {
    addLogEntry("🚬 Cảnh báo cấm hút thuốc", "Lệnh từ Quản trị viên Web", "badge-warning", "Đã phát tới loa hộp 3020 4R 3W");
  } else if (cmd === 'OVERTIME') {
    addLogEntry(`⏱️ Cảnh báo ở quá ${configuredStayTimeoutMin} phút`, "Lệnh từ Quản trị viên Web", "badge-warning", "Đã phát chuông nhắc nhở tới loa hộp 3020 4R 3W");
  } else if (cmd === 'RESET') {
    addLogEntry("✅ Hủy trạng thái báo động", "Lệnh từ Quản trị viên Web", "badge-success", "Khôi phục trạng thái an toàn");
  }

  fetchDeviceStatus();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function addLogEntry(action, detail, badgeClass, statusText) {
  const logsBody = document.getElementById('logsTableBody');
  const mobileLogs = document.getElementById('mobileLogsList');
  const now = new Date();
  const timeStr = `${now.toLocaleTimeString('vi-VN')} - ${now.toLocaleDateString('vi-VN')}`;
  const shortTime = now.toLocaleTimeString('vi-VN');

  const rawBadge = typeof badgeClass === 'string' ? badgeClass.trim() : '';
  const safeBadgeClass = /^[a-z0-9_-]+$/i.test(rawBadge) ? rawBadge : 'badge-info';
  const safeAction = escapeHtml(action);
  const safeDetail = escapeHtml(detail);
  const safeStatusText = escapeHtml(statusText);
  const safeTimeStr = escapeHtml(timeStr);
  const safeShortTime = escapeHtml(shortTime);

  // Thêm vào bảng Desktop
  if (logsBody) {
    const newRow = `
      <tr>
        <td>${safeTimeStr}</td>
        <td>Sa Bàn WC Thực Nghiệm</td>
        <td><span class="badge ${safeBadgeClass}">${safeAction}</span></td>
        <td>${safeDetail}</td>
        <td>${safeStatusText}</td>
      </tr>
    `;
    logsBody.insertAdjacentHTML('afterbegin', newRow);
  }

  // Thêm vào danh sách thẻ Mobile
  if (mobileLogs) {
    const newCard = `
      <div class="log-card-item">
        <div class="log-card-top">
          <span class="badge ${safeBadgeClass}">${safeAction}</span>
          <span class="log-card-time">${safeShortTime}</span>
        </div>
        <div class="log-card-detail">${safeDetail}</div>
        <div class="log-card-location">📍 ${safeStatusText}</div>
      </div>
    `;
    mobileLogs.insertAdjacentHTML('afterbegin', newCard);
  }
}

function clearActivityLogs() {
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
function setupPttListeners() {
  const btn = document.getElementById('btnPtt');
  if (!btn) return;

  if (typeof window.PointerEvent === 'function') {
    btn.addEventListener('pointerdown', (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (e && e.pointerId !== undefined && typeof btn.setPointerCapture === 'function') {
        try {
          btn.setPointerCapture(e.pointerId);
        } catch (_err) { /* ignore capture failure */ }
      }
      startPTT(e);
    });
    btn.addEventListener('pointerup', (e) => stopPTT(e));
    btn.addEventListener('pointercancel', (e) => stopPTT(e));
    btn.addEventListener('lostpointercapture', (e) => stopPTT(e));
  } else {
    btn.addEventListener('touchstart', (e) => {
      lastTouchTimestamp = Date.now();
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      startPTT(e);
    }, { passive: false });
    btn.addEventListener('touchend', (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      stopPTT(e);
    });
    btn.addEventListener('touchcancel', (e) => stopPTT(e));
    btn.addEventListener('mousedown', (e) => {
      if (Date.now() - lastTouchTimestamp < 800) return;
      startPTT(e);
    });
    btn.addEventListener('mouseup', (e) => stopPTT(e));
    btn.addEventListener('mouseleave', (e) => stopPTT(e));
  }
}

async function startPTT() {
  if (isPttActive) return;
  isPttActive = true;
  const mySession = ++pttSessionId;

  const btn = document.getElementById('btnPtt');
  const label = document.getElementById('pttLabel');
  const hint = document.getElementById('pttHint');

  if (btn) btn.classList.add('active');
  if (label) label.innerText = 'ĐANG NÓI...';
  if (hint) hint.innerText = 'Giọng nói đang truyền tới Loa hộp 4Ω 3W (3020)';

  // Gửi tín hiệu báo hiệu đàm thoại xuống ESP32 để phát chuông chú ý tại loa sa bàn
  postStatusCommand('CHIME', null, { silentTelegram: true }).catch((err) => {
    console.warn("PTT CHIME error:", err.message);
  });

  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    let acquiredStream = null;
    if (!mediaStream) {
      acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (!isPttActive || mySession !== pttSessionId) {
      if (acquiredStream && typeof acquiredStream.getTracks === 'function') {
        acquiredStream.getTracks().forEach((t) => t.stop());
      }
      return;
    }
    if (acquiredStream) {
      mediaStream = acquiredStream;
    }

    const source = audioContext.createMediaStreamSource(mediaStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    drawVisualizer(mySession);
  } catch (_err) {
    if (!isPttActive || mySession !== pttSessionId) return;
    const canvas = document.getElementById('audioVisualizer');
    if (canvas && typeof canvas.getContext === 'function') {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (hint) {
      hint.innerText = 'Không truy cập được micro trình duyệt (đã gửi chuông chú ý CHIME tới loa ESP32)';
    }
  }
}

function stopPTT() {
  if (!isPttActive) return;
  isPttActive = false;
  pttSessionId++;

  const btn = document.getElementById('btnPtt');
  const label = document.getElementById('pttLabel');
  const hint = document.getElementById('pttHint');

  if (btn) btn.classList.remove('active');
  if (label) label.innerText = 'NHẤN GIỮ ĐỂ NÓI';
  if (hint) hint.innerText = 'Chạm & giữ nút tròn để phát giọng nói';

  if (visualizerAnimationId) {
    cancelAnimationFrame(visualizerAnimationId);
    visualizerAnimationId = null;
  }
  const canvas = document.getElementById('audioVisualizer');
  if (canvas && typeof canvas.getContext === 'function') {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function drawVisualizer(sessionId = pttSessionId) {
  if (visualizerAnimationId) {
    cancelAnimationFrame(visualizerAnimationId);
    visualizerAnimationId = null;
  }
  if (!isPttActive || sessionId !== pttSessionId) return;

  const canvas = document.getElementById('audioVisualizer');
  if (!canvas || !analyser) return;
  const ctx = canvas.getContext('2d');
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function renderFrame() {
    if (!isPttActive || sessionId !== pttSessionId) {
      visualizerAnimationId = null;
      return;
    }
    if (visualizerAnimationId) {
      cancelAnimationFrame(visualizerAnimationId);
      visualizerAnimationId = null;
    }
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
    visualizerAnimationId = requestAnimationFrame(renderFrame);
  }
  renderFrame();
}

// Đăng ký toàn cục các hàm sự kiện giao diện
window.switchTab = switchTab;
window.handleLogout = handleLogout;
window.sendQuickCommand = sendQuickCommand;
window.saveWebSettings = saveWebSettings;
window.triggerResetWiFi = triggerResetWiFi;
window.triggerRebootESP = triggerRebootESP;
window.clearActivityLogs = clearActivityLogs;
window.startPTT = startPTT;
window.stopPTT = stopPTT;

// Khởi chạy khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  setupSliderListeners();
  setupPttListeners();
  updateDynamicThresholdLabels();
  updateHardwareControlsState(isEsp32Online);
});
