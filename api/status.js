/**
 * Vercel Serverless Function: api/status.js
 * Quản lý trạng thái thiết bị, bộ nhớ bền vững và hàng đợi lệnh điều khiển FIFO
 * Dự án KHKT 2026 - 2027: Hệ thống an toàn nhà vệ sinh học đường
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import https from 'https';

const STATE_FILE = path.join(os.tmpdir(), 'khkt_device_state.json');
const CACHE_KEY = '__khktDeviceState';
const MAX_COMMAND_QUEUE = 20;

const RESERVED_TELEMETRY_KEYS = new Set([
  'commandQueue',
  'pendingCommand',
  'pendingPayload',
  'command',
  'payload',
  'isOnline',
  'lastUpdated',
  'source',
  'queueLength'
]);

const defaultState = {
  deviceId: "RESTROOM_WC1_KHKT",
  deviceName: "Trạm Sa Bàn Thực Nghiệm WC (THCS Nguyễn Công Trứ)",
  isOnline: false,
  alertLevel: 0,
  soundNoise: 0,
  smokeRaw: 0,
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
  pendingPayload: null,
  commandQueue: []
};

function clonePayload(payload) {
  if (payload === undefined || payload === null) return null;
  if (typeof payload !== 'object') return payload;
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch (_err) {
    return null;
  }
}

function normalizeState(raw) {
  const sourceObj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const merged = { ...defaultState, ...sourceObj };

  let queue = [];
  if (Array.isArray(sourceObj.commandQueue)) {
    for (const item of sourceObj.commandQueue) {
      if (item && typeof item === 'object' && typeof item.command === 'string' && item.command.trim()) {
        queue.push({
          command: item.command.trim(),
          payload: clonePayload(item.payload),
          queuedAt: item.queuedAt || null,
          source: typeof item.source === 'string' && item.source.trim() ? item.source.trim() : 'api'
        });
      }
    }
  }

  // Tương thích ngược chỉ khi dữ liệu cũ chưa có mảng commandQueue
  if (!Array.isArray(sourceObj.commandQueue) && typeof sourceObj.pendingCommand === 'string' && sourceObj.pendingCommand.trim()) {
    queue.push({
      command: sourceObj.pendingCommand.trim(),
      payload: clonePayload(sourceObj.pendingPayload),
      queuedAt: null,
      source: 'legacy'
    });
  }

  if (queue.length > MAX_COMMAND_QUEUE) {
    queue = queue.slice(-MAX_COMMAND_QUEUE);
  }

  const head = queue[0] || null;
  merged.commandQueue = queue;
  merged.pendingCommand = head ? head.command : null;
  merged.pendingPayload = head ? clonePayload(head.payload) : null;

  return merged;
}

function getKvConfig() {
  const url = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const token = String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  const key = String(process.env.KHKT_KV_STATE_KEY || 'khkt:device_state').trim() || 'khkt:device_state';
  if (!url || !token) return null;
  return { url, token, key };
}

export function isKvConfigured() {
  return Boolean(getKvConfig());
}

/**
 * Helper HTTP tương thích Node 16/18/20.
 * Luôn kiểm tra globalThis.fetch tại thời điểm gọi để hỗ trợ mock fetch trong kiểm thử cục bộ.
 */
export async function httpRequest(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = undefined,
    timeoutMs = 5000
  } = options;

  if (typeof globalThis.fetch === 'function') {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const fetchOpts = {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        ...(controller ? { signal: controller.signal } : {})
      };
      return await globalThis.fetch(url, fetchOpts);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const parsedUrl = new URL(url);
  const client = parsedUrl.protocol === 'https:' ? https : http;
  const reqHeaders = { ...headers };
  let bodyBuffer = null;

  if (body !== undefined && body !== null) {
    bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf-8');
    if (!Object.keys(reqHeaders).some((k) => k.toLowerCase() === 'content-length')) {
      reqHeaders['Content-Length'] = String(bodyBuffer.length);
    }
  }

  return await new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method,
        headers: reqHeaders
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode || 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage || '',
            headers: res.headers,
            text: async () => raw,
            json: async () => JSON.parse(raw || 'null')
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);

    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

// Đọc trạng thái cục bộ từ os.tmpdir() hoặc cache bộ nhớ globalThis
export function getSharedState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, 'utf-8');
      if (content && content.trim()) {
        const normalized = normalizeState(JSON.parse(content));
        globalThis[CACHE_KEY] = normalized;
        return normalizeState(normalized);
      }
    }
  } catch (err) {
    console.error("Lỗi đọc state từ tmpdir:", err.message);
  }

  if (globalThis[CACHE_KEY]) {
    return normalizeState(globalThis[CACHE_KEY]);
  }

  return normalizeState(defaultState);
}

// Lưu trạng thái cục bộ vào globalThis và os.tmpdir()
export function saveSharedState(state) {
  const normalized = normalizeState(state);
  globalThis[CACHE_KEY] = normalized;
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(normalized), 'utf-8');
  } catch (err) {
    console.error("Lỗi ghi state vào tmpdir:", err.message);
  }
  return normalizeState(normalized);
}

// Đặt lại trạng thái dùng chung (hữu ích cho kiểm thử độc lập)
export function resetSharedState() {
  delete globalThis[CACHE_KEY];
  try {
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
    }
  } catch (err) {
    console.error("Lỗi xóa file state:", err.message);
  }
  return normalizeState(defaultState);
}

export async function loadPersistentState() {
  const kv = getKvConfig();
  if (kv) {
    try {
      const res = await httpRequest(kv.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kv.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['GET', kv.key]),
        timeoutMs: 4000
      });
      if (res && res.ok) {
        const data = await res.json();
        if (data && data.result !== undefined && data.result !== null) {
          const rawState = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
          const normalized = normalizeState(rawState);
          globalThis[CACHE_KEY] = normalized;
          try {
            fs.writeFileSync(STATE_FILE, JSON.stringify(normalized), 'utf-8');
          } catch (_e) { /* ignore disk error */ }
          return normalizeState(normalized);
        }
        return getSharedState();
      }
      console.warn(`KV GET không thành công: HTTP ${res?.status}`);
    } catch (err) {
      console.warn("KV GET lỗi, chuyển sang trạng thái cục bộ:", err.message);
    }
  }
  return getSharedState();
}

export async function savePersistentState(state) {
  const saved = saveSharedState(state);
  const kv = getKvConfig();
  if (kv) {
    try {
      const res = await httpRequest(kv.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kv.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SET', kv.key, JSON.stringify(saved)]),
        timeoutMs: 4000
      });
      if (!res || !res.ok) {
        console.warn(`KV SET không thành công: HTTP ${res?.status}`);
      }
    } catch (err) {
      console.warn("KV SET lỗi, giữ trạng thái cục bộ:", err.message);
    }
  }
  return normalizeState(saved);
}

export async function enqueueCommand(command, payload = null, source = 'api') {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Command must be a non-empty string');
  }
  const cmd = command.trim();
  const state = await loadPersistentState();

  // Gộp trùng lệnh SET_LOGIC (chỉ giữ cấu hình mới nhất, không làm rơi lệnh khác)
  if (cmd === 'SET_LOGIC') {
    state.commandQueue = state.commandQueue.filter((item) => item.command !== 'SET_LOGIC');
  }

  state.commandQueue.push({
    command: cmd,
    payload: clonePayload(payload),
    queuedAt: new Date().toISOString(),
    source: typeof source === 'string' && source.trim() ? source.trim() : 'api'
  });

  while (state.commandQueue.length > MAX_COMMAND_QUEUE) {
    state.commandQueue.shift();
  }

  const saved = await savePersistentState(state);
  return {
    state: saved,
    command: cmd,
    payload: clonePayload(payload),
    queueLength: saved.commandQueue.length
  };
}

function parseRequestBody(rawBody) {
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
    throw new Error('Invalid JSON body');
  }
  return parsed;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Relay');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST: Nhận telemetry từ ESP32 HOẶC nhận lệnh điều khiển từ Web Dashboard / Telegram Relay
  if (req.method === 'POST') {
    try {
      const parsed = parseRequestBody(req.body);

      // Từ chối nếu gói tin có trường 'command' nhưng rỗng, chỉ chứa khoảng trắng hoặc không phải chuỗi
      if (
        Object.prototype.hasOwnProperty.call(parsed, 'command') &&
        (typeof parsed.command !== 'string' || !parsed.command.trim())
      ) {
        return res.status(400).json({ success: false, error: 'Invalid command' });
      }

      // TRƯỜNG HỢP 1: Lệnh điều khiển gửi từ Web Dashboard hoặc Relay (có trường 'command')
      if (typeof parsed.command === 'string' && parsed.command.trim().length > 0) {
        const cmd = parsed.command.trim();
        const sourceHeader = req.headers?.['x-internal-relay'] || req.headers?.['X-Internal-Relay'];
        const source = (typeof parsed.source === 'string' && parsed.source.trim()) ||
          (typeof sourceHeader === 'string' && sourceHeader.trim()) ||
          'web';
        const result = await enqueueCommand(cmd, parsed.payload ?? null, source);

        return res.status(200).json({
          success: true,
          message: `Lệnh [${cmd}] đã được đưa vào hàng đợi cho ESP32!`,
          command: cmd,
          payload: result.payload,
          queueLength: result.queueLength
        });
      }

      // TRƯỜNG HỢP 2: Gói tin Telemetry định kỳ gửi từ vi điều khiển ESP32
      const state = await loadPersistentState();
      const sanitizedTelemetry = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (!RESERVED_TELEMETRY_KEYS.has(key)) {
          sanitizedTelemetry[key] = value;
        }
      }

      const nextState = normalizeState({
        ...state,
        ...sanitizedTelemetry,
        commandQueue: state.commandQueue,
        isOnline: true,
        lastUpdated: new Date().toISOString()
      });

      // Lấy 1 lệnh đầu hàng đợi FIFO để trả về cho ESP32 thực thi
      const nextCmd = nextState.commandQueue.shift() || null;
      const headAfterShift = nextState.commandQueue[0] || null;
      nextState.pendingCommand = headAfterShift ? headAfterShift.command : null;
      nextState.pendingPayload = headAfterShift ? clonePayload(headAfterShift.payload) : null;
      const saved = await savePersistentState(nextState);

      return res.status(200).json({
        success: true,
        command: nextCmd ? nextCmd.command : null,
        payload: nextCmd ? clonePayload(nextCmd.payload) : null,
        queueLength: saved.commandQueue.length
      });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  // GET: Web Dashboard truy vấn trạng thái để hiển thị giao diện
  if (req.method === 'GET') {
    const state = await loadPersistentState();
    let isLive = false;
    if (state.lastUpdated) {
      const ts = new Date(state.lastUpdated).getTime();
      if (Number.isFinite(ts)) {
        const diffSec = (Date.now() - ts) / 1000;
        isLive = diffSec < 15; // Trong vòng 15 giây gần nhất có tín hiệu heartbeat
      }
    }

    return res.status(200).json({
      ...state,
      isOnline: isLive,
      queueLength: state.commandQueue.length
    });
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
}
