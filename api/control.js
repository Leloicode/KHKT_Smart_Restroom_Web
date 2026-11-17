/**
 * Vercel Serverless Function: api/control.js
 * Tiếp nhận lệnh điều khiển từ Web Dashboard (Reset WiFi, Phát loa, Cài ngưỡng)
 * Dự án KHKT 2026 - 2027: Hệ thống an toàn nhà vệ sinh học đường
 */

import statusHandler from './status.js';

export default async function handler(req, res) {
  // Chuyển tiếp trực tiếp sang statusHandler để dùng chung bộ nhớ và hàng đợi lệnh cho ESP32
  return statusHandler(req, res);
}
