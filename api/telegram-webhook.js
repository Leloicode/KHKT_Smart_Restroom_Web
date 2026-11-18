/**
 * Vercel Serverless Function: api/telegram-webhook.js
 * Tiếp nhận Webhook từ Telegram Bot (Inline Buttons, Slash Commands và Voice Message)
 * Dự án KHKT 2026 - 2027: Hệ thống an toàn nhà vệ sinh học đường
 */

import {
  enqueueCommand,
  loadPersistentState,
  isKvConfigured,
  httpRequest
} from './status.js';

const DEFAULT_BOT_TOKEN = '8881401798:AAGC-KPh_-abcGM20BYZqaHBMFT-Wvsuuk8';
const DEFAULT_CHAT_ID = '1461012398';

function getBotToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN).trim();
}

function getAuthorizedChatIds() {
  return new Set(
    String(process.env.TELEGRAM_CHAT_ID || DEFAULT_CHAT_ID)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function getWebhookSecret() {
  return String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
}

function getHeaderCaseInsensitive(headers, targetName) {
  if (!headers || typeof headers !== 'object') return undefined;
  const lowerTarget = targetName.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lowerTarget) return v;
  }
  return undefined;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWord(text, keywords) {
  if (!text || !Array.isArray(keywords) || !keywords.length) return false;
  const pattern = keywords.map(escapeRegExp).join('|');
  const regex = new RegExp(`(?:^|[\\s,!?.:/-]+)(?:${pattern})(?:$|[\\s,!?.:/-]+)`, 'i');
  return regex.test(text);
}

function formatVnTime(date = new Date()) {
  try {
    return date.toLocaleTimeString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false
    });
  } catch (_err) {
    return date.toISOString();
  }
}

function parseWebhookBody(rawBody) {
  if (rawBody === undefined || rawBody === null) {
    return {};
  }
  let parsed = rawBody;
  if (Buffer.isBuffer(rawBody)) {
    const str = rawBody.toString('utf-8').trim();
    parsed = str ? JSON.parse(str) : {};
  } else if (typeof rawBody === 'string') {
    const str = rawBody.trim();
    parsed = str ? JSON.parse(str) : {};
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON payload');
  }
  return parsed;
}

function isAuthorizedCallback(callback, authorizedSet) {
  const chatId = callback?.message?.chat?.id;
  const fromId = callback?.from?.id;
  const hasChatId = chatId !== undefined && chatId !== null;
  const hasFromId = fromId !== undefined && fromId !== null;

  if (hasChatId) {
    const chatStr = String(chatId).trim();
    if (!authorizedSet.has(chatStr)) return false;
    if (Number(chatStr) > 0 && hasFromId && !authorizedSet.has(String(fromId).trim())) {
      return false;
    }
    return true;
  }

  if (hasFromId) {
    return authorizedSet.has(String(fromId).trim());
  }
  return false;
}

function isAuthorizedMessage(msg, authorizedSet) {
  const chatId = msg?.chat?.id;
  return chatId !== undefined && chatId !== null && authorizedSet.has(String(chatId).trim());
}

function getRelayContext(req) {
  const rawForwardedHost = getHeaderCaseInsensitive(req.headers, 'x-forwarded-host');
  const rawHost = getHeaderCaseInsensitive(req.headers, 'host');
  const rawVercelUrl = process.env.VERCEL_URL || '';
  const candidate = String(rawForwardedHost || rawHost || rawVercelUrl).split(',')[0].trim();
  const isLocalHost = !candidate || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(candidate);
  const isVercelRuntime = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
  const shouldRelay = !isKvConfigured() && (isVercelRuntime || (!isLocalHost && candidate.length > 0));

  if (!shouldRelay) {
    return { shouldRelay: false, baseUrl: null };
  }

  let safeHost = candidate.replace(/^https?:\/\//i, '').split('/')[0];
  if (!/^[a-zA-Z0-9.-]+(:\d+)?$/.test(safeHost)) {
    safeHost = String(rawVercelUrl || 'khktsmartrestroomweb.vercel.app')
      .replace(/^https?:\/\//i, '')
      .split('/')[0];
  }
  if (!safeHost || !/^[a-zA-Z0-9.-]+(:\d+)?$/.test(safeHost)) {
    safeHost = 'khktsmartrestroomweb.vercel.app';
  }

  const rawProto = getHeaderCaseInsensitive(req.headers, 'x-forwarded-proto');
  const proto = String(rawProto || (isLocalHost ? 'http' : 'https')).split(',')[0].trim();
  return {
    shouldRelay: true,
    baseUrl: `${proto}://${safeHost}`
  };
}

async function answerCallback(token, callbackId, text, showAlert = false) {
  if (!token || !callbackId) return false;
  try {
    const res = await httpRequest(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackId,
        text,
        show_alert: Boolean(showAlert)
      }),
      timeoutMs: 4000
    });
    if (!res || !res.ok) {
      console.warn(`Telegram answerCallbackQuery HTTP ${res?.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Telegram answerCallbackQuery lỗi:", err.message);
    return false;
  }
}

async function editCallbackMessage(token, message, statusNote) {
  const msgChatId = message?.chat?.id;
  const msgId = message?.message_id;
  if (!token || msgChatId === undefined || msgChatId === null || msgId === undefined || msgId === null) {
    return false;
  }
  if (typeof message?.text !== 'string' || !message.text.length || !statusNote) {
    return false;
  }

  const maxEscapedOrigLen = 4096 - statusNote.length;
  let escapedOrig = escapeHtml(message.text);
  if (escapedOrig.length > maxEscapedOrigLen) {
    if (maxEscapedOrigLen >= 3) {
      const budgetForEscaped = maxEscapedOrigLen - 3;
      let low = 0;
      let high = message.text.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (escapeHtml(message.text.slice(0, mid)).length <= budgetForEscaped) {
          low = mid;
        } else {
          high = mid - 1;
        }
      }
      if (low > 0) {
        const code = message.text.charCodeAt(low - 1);
        if (code >= 0xD800 && code <= 0xDBFF) {
          low -= 1;
        }
      }
      escapedOrig = `${escapeHtml(message.text.slice(0, low))}...`;
    } else {
      escapedOrig = '';
    }
  }
  const updatedText = maxEscapedOrigLen >= 0
    ? `${escapedOrig}${statusNote}`
    : statusNote;

  try {
    const payload = {
      chat_id: msgChatId,
      message_id: msgId,
      text: updatedText,
      parse_mode: 'HTML',
      ...(message.reply_markup ? { reply_markup: message.reply_markup } : {})
    };
    const res = await httpRequest(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 4000
    });
    if (!res || !res.ok) {
      console.warn(`Telegram editMessageText HTTP ${res?.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Telegram editMessageText lỗi:", err.message);
    return false;
  }
}

async function sendTelegramMessage(token, chatId, text, parseMode = null) {
  if (!token || chatId === undefined || chatId === null || !text) return false;
  try {
    const payload = {
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {})
    };
    const res = await httpRequest(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 4000
    });
    if (!res || !res.ok) {
      console.warn(`Telegram sendMessage HTTP ${res?.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Telegram sendMessage lỗi:", err.message);
    return false;
  }
}

async function deliverCommandToEsp32(req, queuedCmd) {
  const result = await enqueueCommand(queuedCmd, null, 'telegram-webhook');
  const relay = getRelayContext(req);
  if (relay.shouldRelay && relay.baseUrl) {
    const relayRes = await httpRequest(`${relay.baseUrl}/api/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Relay': 'telegram-webhook'
      },
      body: JSON.stringify({
        command: queuedCmd,
        deviceId: 'RESTROOM_WC1_KHKT',
        payload: null,
        source: 'telegram-webhook'
      }),
      timeoutMs: 4000
    });
    if (!relayRes || !relayRes.ok) {
      throw new Error(`Relay POST /api/status HTTP ${relayRes?.status || 'unknown'}`);
    }
  }
  return result;
}

async function loadStatusForTelegram(req) {
  const relay = getRelayContext(req);
  if (relay.shouldRelay && relay.baseUrl) {
    try {
      const res = await httpRequest(`${relay.baseUrl}/api/status?_t=${Date.now()}`, {
        method: 'GET',
        headers: { 'X-Internal-Relay': 'telegram-webhook' },
        timeoutMs: 4000
      });
      if (res && res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn("Relay GET /api/status lỗi, dùng trạng thái cục bộ:", err.message);
    }
  }
  const state = await loadPersistentState();
  let isLive = false;
  if (state.lastUpdated) {
    const ts = new Date(state.lastUpdated).getTime();
    if (Number.isFinite(ts)) {
      isLive = ((Date.now() - ts) / 1000) < 15;
    }
  }
  return { ...state, isOnline: isLive };
}

function formatStatusReport(state) {
  const timeStr = formatVnTime(new Date());
  const alertLabels = {
    0: '🟢 Bình thường (An toàn)',
    1: '🚬 Cảnh báo khói thuốc / Vape',
    2: '🚨 Báo động bạo lực / La hét',
    3: '👥 Cảnh báo tụ tập đông người',
    4: '⏱️ Cảnh báo ở quá thời gian'
  };
  const alertText = alertLabels[Number(state?.alertLevel ?? 0)] || '🟢 Bình thường';
  const onlineText = state?.isOnline ? '🟢 TRỰC TUYẾN' : '⚪ CHỜ KẾT NỐI ESP32';
  const soundDb = Number(state?.soundNoise ?? 0);
  const smokeAdc = Number(state?.smokeRaw ?? 0);
  const occ = Number(state?.occupancy ?? 0);
  const stayMins = Number(state?.stayMinutes ?? 0);
  const wifi = state?.currentWifi || 'Chưa kết nối';

  return (
    `📊 TRẠNG THÁI SA BÀN WC (${timeStr})\n` +
    `• Kết nối: ${onlineText}\n` +
    `• WiFi: ${wifi}\n` +
    `• An ninh: ${alertText}\n` +
    `• Âm thanh (KY-038): ${soundDb} dB\n` +
    `• Khói (MQ-2): ${smokeAdc} ADC\n` +
    `• Số người: ${occ} học sinh (${stayMins} phút)`
  );
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token, X-Internal-Relay'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).send("Telegram Webhook Serverless Endpoint Ready.");
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const webhookSecret = getWebhookSecret();
  if (webhookSecret) {
    const incomingSecret = getHeaderCaseInsensitive(req.headers, 'x-telegram-bot-api-secret-token');
    if (String(incomingSecret || '') !== webhookSecret) {
      return res.status(401).json({ ok: false, error: "Unauthorized webhook secret" });
    }
  }

  let update;
  try {
    update = parseWebhookBody(req.body);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  const TELEGRAM_TOKEN = getBotToken();
  const AUTHORIZED_CHAT_IDS = getAuthorizedChatIds();

  try {
    // 1. Xử lý khi người dùng bấm vào các nút Inline Keyboard
    if (update.callback_query) {
      const callback = update.callback_query;
      const callbackId = callback.id !== undefined && callback.id !== null ? String(callback.id) : '';
      const data = typeof callback.data === 'string' ? callback.data.trim() : '';
      const rawUser = callback.from?.first_name || callback.from?.username || 'Thầy/Cô';
      const safeUser = escapeHtml(rawUser);
      const message = callback.message && typeof callback.message === 'object' ? callback.message : null;

      if (!isAuthorizedCallback(callback, AUTHORIZED_CHAT_IDS)) {
        await answerCallback(TELEGRAM_TOKEN, callbackId, '⛔ Không có quyền thực hiện thao tác này!', true);
        return res.status(200).json({ ok: false, authorized: false, error: 'Unauthorized chat' });
      }

      const timeStr = formatVnTime(new Date());
      let answerText = "ℹ️ Thao tác không được hỗ trợ.";
      let statusNote = "";
      let queuedCmd = null;

      if (data === "CMD_SIREN") {
        answerText = "🚨 Đang kích hoạt còi hụ răn đe tại khu vực WC!";
        statusNote = `\n\n⚡ <b>CẬP NHẬT:</b> ${safeUser} đã kích hoạt <b>CÒI HỤ RĂN ĐE</b> lúc ${timeStr}.`;
        queuedCmd = "SIREN";
      } else if (data === "CMD_SMOKE") {
        answerText = "🚬 Đang phát chuỗi âm thanh cảnh báo cấm hút thuốc!";
        statusNote = `\n\n⚡ <b>CẬP NHẬT:</b> ${safeUser} đã phát cảnh báo <b>CẤM HÚT THUỐC</b> lúc ${timeStr}.`;
        queuedCmd = "SMOKE";
      } else if (data === "CMD_SECURITY") {
        answerText = "👮 Đã ghi nhận! Hệ thống phát chuông thông báo bảo vệ đang tới.";
        statusNote = `\n\n👮 <b>XỬ LÝ:</b> ${safeUser} xác nhận <b>ĐANG CỬ BẢO VỆ TỚI HIỆN TRƯỜNG</b> lúc ${timeStr}.`;
        queuedCmd = "CHIME";
      } else if (data === "CMD_RESET") {
        answerText = "✅ Đã hủy trạng thái báo động!";
        statusNote = `\n\n✅ <b>HOÀN TẤT:</b> ${safeUser} đã xác minh và <b>HỦY BÁO ĐỘNG</b> lúc ${timeStr}.`;
        queuedCmd = "RESET";
      } else if (data === "CMD_OVERTIME") {
        answerText = "⏱️ Đang phát chuông nhắc nhở thời gian ở WC!";
        statusNote = `\n\n⏱️ <b>NHẮC NHỞ:</b> ${safeUser} đã phát chuông <b>NHẮC NHỞ QUÁ GIỜ</b> lúc ${timeStr}.`;
        queuedCmd = "OVERTIME";
      }

      // Luôn trả lời Telegram Callback Query NGAY LẬP TỨC để tắt vòng tròn xoay trên nút
      await answerCallback(TELEGRAM_TOKEN, callbackId, answerText, false);

      let deliveryError = null;
      if (queuedCmd) {
        try {
          await deliverCommandToEsp32(req, queuedCmd);
        } catch (err) {
          deliveryError = err.message;
          console.error("Lỗi xếp hàng/chuyển tiếp lệnh từ callback:", err.message);
        }
      }

      if (statusNote) {
        const finalNote = deliveryError
          ? `\n\n⚠️ <b>LƯU Ý:</b> Lệnh ${escapeHtml(queuedCmd)} gặp lỗi chuyển tiếp (${escapeHtml(deliveryError)}).`
          : statusNote;
        await editCallbackMessage(TELEGRAM_TOKEN, message, finalNote);
      }

      return res.status(200).json({
        ok: true,
        command: queuedCmd,
        ...(deliveryError ? { warning: deliveryError } : {})
      });
    }

    // 2. Xử lý khi giám thị gửi Tin nhắn thoại (Voice Message) hoặc Slash Command / Text
    if (update.message) {
      const msg = update.message;
      if (!isAuthorizedMessage(msg, AUTHORIZED_CHAT_IDS)) {
        return res.status(200).json({ ok: false, authorized: false, error: 'Unauthorized chat' });
      }

      const chatId = msg.chat.id;
      let queuedCmd = null;
      let replyText = null;

      if (msg.voice) {
        queuedCmd = "CHIME";
        replyText = "🎙️ Đã nhận tin nhắn thoại từ Thầy/Cô! Đang kích hoạt chuông chú ý can thiệp ra Loa 3020 tại sa bàn.";
      } else if (typeof msg.text === 'string' && msg.text.trim()) {
        const trimmed = msg.text.trim();
        const lower = trimmed.toLowerCase();
        const firstWord = lower.split(/\s+/)[0] || '';
        const slashCmd = firstWord.startsWith('/') ? firstWord.split('@')[0] : '';

        if (slashCmd === '/start' || slashCmd === '/help') {
          replyText =
            "🛡️ HỆ THỐNG GIÁM SÁT AN TOÀN WC HỌC ĐƯỜNG\n" +
            "Các lệnh hỗ trợ:\n" +
            "• /status - Xem trạng thái cảm biến hiện tại\n" +
            "• /siren - Kích hoạt còi hú răn đe\n" +
            "• /smoke - Phát nhắc nhở cấm hút thuốc\n" +
            "• /overtime - Phát chuông nhắc nhở quá giờ\n" +
            "• /guard - Phát chuông bảo vệ đang tới\n" +
            "• /reset - Hủy báo động về trạng thái an toàn";
        } else if (slashCmd === '/status' || (!slashCmd && /^status$/i.test(trimmed))) {
          const liveState = await loadStatusForTelegram(req);
          replyText = formatStatusReport(liveState);
        } else if (slashCmd === '/siren' || (!slashCmd && hasWord(lower, ['coi', 'còi']))) {
          queuedCmd = "SIREN";
          replyText = "🚨 Đã kích hoạt Còi Báo Động Hú Răn Đe!";
        } else if (slashCmd === '/smoke' || (!slashCmd && hasWord(lower, ['thuoc', 'thuốc']))) {
          queuedCmd = "SMOKE";
          replyText = "⚠️ Đã phát chuỗi âm thanh Cảnh Báo Cấm Hút Thuốc!";
        } else if (slashCmd === '/overtime' || (!slashCmd && hasWord(lower, ['qua gio', 'quá giờ']))) {
          queuedCmd = "OVERTIME";
          replyText = "⏱️ Đã phát chuông Nhắc Nhở Thời Gian Ở WC!";
        } else if (slashCmd === '/guard' || (!slashCmd && hasWord(lower, ['baove', 'bảo vệ']))) {
          queuedCmd = "CHIME";
          replyText = "👮 Đã phát thông báo Bảo Vệ Đang Di Chuyển Tới Hiện Trường!";
        } else if (slashCmd === '/reset' || (!slashCmd && hasWord(lower, ['tat', 'tắt']))) {
          queuedCmd = "RESET";
          replyText = "✅ Đã hủy trạng thái báo động, đưa hệ thống về An Toàn.";
        } else if (slashCmd) {
          replyText = "ℹ️ Lệnh chưa được hỗ trợ. Gửi /help để xem danh sách lệnh.";
        }
      }

      if (queuedCmd) {
        try {
          await deliverCommandToEsp32(req, queuedCmd);
        } catch (err) {
          console.error("Lỗi xếp hàng/chuyển tiếp lệnh từ message:", err.message);
          replyText = `⚠️ Không thể đưa lệnh ${queuedCmd} vào hàng đợi: ${err.message}`;
        }
      }

      if (replyText) {
        await sendTelegramMessage(TELEGRAM_TOKEN, chatId, replyText);
      }

      return res.status(200).json({ ok: true, command: queuedCmd });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return res.status(200).json({ ok: false, error: err.message });
  }
}
