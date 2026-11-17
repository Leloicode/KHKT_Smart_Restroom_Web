/**
 * Vercel Serverless Function: api/control.js
 * Tiếp nhận lệnh điều khiển từ Web Dashboard (Reset WiFi, Phát loa, Cài ngưỡng)
 * Dự án KHKT 2026 - 2027: Hệ thống an toàn nhà vệ sinh học đường
 */

import { getSharedState, saveSharedState } from './status.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      const { command, deviceId, payload } = req.body || {};
      
      console.log(`[CONTROL] Lệnh mới từ Web: ${command}`, payload);

      // Đọc state dùng chung và đưa lệnh vào hàng đợi
      const state = getSharedState();
      state.pendingCommand = command;
      state.pendingPayload = payload || null;
      saveSharedState(state);

      // Thông báo lên Telegram nếu có cấu hình Bot
      const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

      if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
        try {
          let desc = `Lệnh: *${command}*`;
          if (command === 'RESET_WIFI' || command === 'OPEN_AP') {
            desc = `🔄 Đặt lại WiFi & mở điểm phát WiFi (*KHKT-SmartRestroom-Setup*) để cài đặt lại`;
          } else if (command === 'REBOOT') {
            desc = `🔁 Khởi động lại thiết bị ESP32 từ xa`;
          } else if (command === 'SET_LOGIC' && payload) {
            desc = `⚙️ Cập nhật ngưỡng: Ở tối đa *${payload.stayTimeout} phút*, Lọc âm *${payload.soundHold}s*, Khói *${payload.smokeThresh} ADC*`;
          } else if (command === 'SIREN') {
            desc = `🚨 Kích hoạt còi hú răn đe bạo lực khẩn cấp!`;
          } else if (command === 'SMOKE') {
            desc = `🚬 Phát cảnh báo nhắc nhở cấm hút thuốc!`;
          } else if (command === 'RESET') {
            desc = `✅ Hủy trạng thái báo động, đưa thiết bị về bình thường`;
          }

          await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: TELEGRAM_CHAT_ID,
              text: `📢 *THÔNG BÁO TỪ QUẢN TRỊ VIÊN WEB:*\n• ${desc}\n• Thời gian: ${new Date().toLocaleTimeString('vi-VN')}`,
              parse_mode: 'Markdown'
            })
          });
        } catch (tgErr) {
          console.error("Lỗi gửi Telegram từ Web Control:", tgErr);
        }
      }

      return res.status(200).json({
        success: true,
        command: command,
        payload: payload,
        message: `Đã đưa lệnh [${command}] vào hàng đợi thành công cho thiết bị ESP32!`
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
