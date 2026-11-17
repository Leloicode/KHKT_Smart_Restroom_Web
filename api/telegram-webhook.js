/**
 * Vercel Serverless Function: api/telegram-webhook.js
 * Tiếp nhận Webhook từ Telegram Bot (Inline Buttons và phản hồi tương tác)
 */

import { getSharedState, saveSharedState } from './status.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send("Telegram Webhook Serverless Endpoint Ready.");
  }

  try {
    const update = req.body;
    console.log("[TELEGRAM WEBHOOK] Received update:", JSON.stringify(update));

    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8881401798:AAGC-KPh_-abcGM20BYZqaHBMFT-Wvsuuk8';

    // Xử lý khi người dùng bấm vào các nút Inline Keyboard
    if (update && update.callback_query) {
      const callback = update.callback_query;
      const callbackId = callback.id;
      const data = callback.data;
      const fromUser = callback.from.first_name || "Thầy/Cô";
      const chatId = callback.message.chat.id;
      const messageId = callback.message.message_id;

      let answerText = "Đã tiếp nhận yêu cầu!";
      let statusNote = "";
      let queuedCmd = null;

      if (data === "CMD_SIREN") {
        answerText = "Đang kích hoạt còi hụ răn đe tại nhà vệ sinh!";
        statusNote = `\n\n⚡ *CẬP NHẬT:* ${fromUser} đã kích hoạt *CÒI HỤ RĂN ĐE* lúc ${new Date().toLocaleTimeString('vi-VN')}.`;
        queuedCmd = "SIREN";
      } else if (data === "CMD_SMOKE") {
        answerText = "Đang phát chuỗi âm thanh cảnh báo cấm hút thuốc!";
        statusNote = `\n\n⚡ *CẬP NHẬT:* ${fromUser} đã phát cảnh báo *CẤM HÚT THUỐC* lúc ${new Date().toLocaleTimeString('vi-VN')}.`;
        queuedCmd = "SMOKE";
      } else if (data === "CMD_SECURITY") {
        answerText = "Đã ghi nhận! Hệ thống phát chuông thông báo bảo vệ đang di chuyển tới.";
        statusNote = `\n\n👮 *XỬ LÝ:* ${fromUser} xác nhận *ĐANG CỬ BẢO VỆ TỚI HIỆN TRƯỜNG* lúc ${new Date().toLocaleTimeString('vi-VN')}.`;
        queuedCmd = "CHIME";
      } else if (data === "CMD_RESET") {
        answerText = "Đã hủy trạng thái báo động!";
        statusNote = `\n\n✅ *HOÀN TẤT:* ${fromUser} đã xác minh và *HỦY BÁO ĐỘNG* lúc ${new Date().toLocaleTimeString('vi-VN')}.`;
        queuedCmd = "RESET";
      }

      // Đưa lệnh vào hàng đợi để ESP32 kéo về thực thi ngay trong chu kỳ tiếp theo
      if (queuedCmd) {
        const state = getSharedState();
        state.pendingCommand = queuedCmd;
        saveSharedState(state);
      }

      // Trả lời Telegram Callback Query (để tắt vòng tròn xoay trên nút)
      if (TELEGRAM_TOKEN) {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: callbackId,
            text: answerText,
            show_alert: false
          })
        });

        // Cập nhật lại tin nhắn cũ kèm dấu vết xử lý
        if (callback.message && callback.message.text) {
          const updatedText = callback.message.text + statusNote;
          await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: updatedText,
              parse_mode: 'Markdown',
              reply_markup: callback.message.reply_markup
            })
          });
        }
      }
    }

    // Xử lý khi giám thị gửi Tin nhắn thoại (Voice Message) hoặc tin nhắn Text
    if (update && update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      let queuedCmd = null;
      let replyText = null;

      if (msg.voice) {
        queuedCmd = "CHIME";
        replyText = "🎙️ Đã nhận tin nhắn thoại từ Thầy/Cô! Đang kích hoạt chuông chú ý can thiệp ra Loa 3020 tại sa bàn.";
      } else if (msg.text) {
        const txt = msg.text.trim().toLowerCase();
        if (txt.startsWith("/siren") || txt.includes("coi")) {
          queuedCmd = "SIREN";
          replyText = "🚨 Đã kích hoạt Còi Báo Động Hú Răn Đe!";
        } else if (txt.startsWith("/smoke") || txt.includes("thuoc")) {
          queuedCmd = "SMOKE";
          replyText = "⚠️ Đã phát chuỗi âm thanh Cảnh Báo Cấm Hút Thuốc!";
        } else if (txt.startsWith("/guard") || txt.includes("baove")) {
          queuedCmd = "CHIME";
          replyText = "👮 Đã phát thông báo Bảo Vệ Đang Di Chuyển Tới Hiện Trường!";
        } else if (txt.startsWith("/reset") || txt.includes("tat")) {
          queuedCmd = "RESET";
          replyText = "✅ Đã hủy trạng thái báo động, đưa hệ thống về An Toàn.";
        }
      }

      if (queuedCmd) {
        const state = getSharedState();
        state.pendingCommand = queuedCmd;
        saveSharedState(state);

        if (TELEGRAM_TOKEN && replyText) {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: replyText
            })
          });
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return res.status(200).json({ ok: false, error: err.message });
  }
}

