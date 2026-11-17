/**
 * Vercel Serverless Function: api/status.js
 * Quản lý trạng thái thiết bị và hàng đợi lệnh điều khiển từ xa
 * Dự án KHKT 2026 - 2027: Hệ thống an toàn nhà vệ sinh học đường
 */

import fs from 'fs';

const STATE_FILE = '/tmp/khkt_device_state.json';

const defaultState = {
  deviceId: "RESTROOM_WC1_KHKT",
  deviceName: "Trạm Sa Bàn Thực Nghiệm WC (THCS Nguyễn Công Trứ)",
  isOnline: false,
  alertLevel: 0,
  soundNoise: 40,
  smokeRaw: 450,
  presence: false,
  occupancy: 0,
  stayMinutes: 0,
  stayTimeoutSetting: 10,
  soundHoldSetting: 1.5,
  smokeThresholdSetting: 1800,
  uptimeSeconds: 0,
  currentWifi: "Chưa kết nối ESP32",
  lastUpdated: null,
  pendingCommand: null,
  pendingPayload: null
};

// Đọc trạng thái từ file /tmp hoặc fallback bộ nhớ
export function getSharedState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, 'utf-8');
      return { ...defaultState, ...JSON.parse(content) };
    }
  } catch (err) {
    console.error("Lỗi đọc state từ /tmp:", err.message);
  }
  return { ...defaultState };
}

// Lưu trạng thái vào file /tmp
export function saveSharedState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (err) {
    console.error("Lỗi ghi state vào /tmp:", err.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let state = getSharedState();

  // POST: Nhận telemetry từ ESP32 HOẶC nhận lệnh điều khiển từ Web Dashboard
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const now = new Date();

      // TRƯỜNG HỢP 1: Lệnh điều khiển gửi từ Web Dashboard (có trường 'command')
      if (body.command) {
        state.pendingCommand = body.command;
        state.pendingPayload = body.payload || null;
        saveSharedState(state);

        return res.status(200).json({
          success: true,
          message: `Lệnh [${body.command}] đã được đưa vào hàng đợi cho ESP32!`,
          command: body.command
        });
      }

      // TRƯỜNG HỢP 2: Gói tin Telemetry định kỳ gửi từ vi điều khiển ESP32
      state = {
        ...state,
        ...body,
        isOnline: true,
        lastUpdated: now.toISOString()
      };

      // Lấy lệnh đang chờ để trả về cho ESP32 thực thi
      const cmdToSend = state.pendingCommand;
      const payloadToSend = state.pendingPayload;

      // Xóa lệnh sau khi đã gửi xuống cho ESP32
      state.pendingCommand = null;
      state.pendingPayload = null;
      saveSharedState(state);

      return res.status(200).json({
        success: true,
        command: cmdToSend,
        payload: payloadToSend
      });

    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  // GET: Web Dashboard truy vấn trạng thái để hiển thị giao diện
  if (req.method === 'GET') {
    let isLive = false;
    if (state.lastUpdated) {
      const diffSec = (Date.now() - new Date(state.lastUpdated).getTime()) / 1000;
      isLive = diffSec < 15; // Trong vòng 15 giây gần nhất có tín hiệu heartbeat
    }

    return res.status(200).json({
      ...state,
      isOnline: isLive
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
