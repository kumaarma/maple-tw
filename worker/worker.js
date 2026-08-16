/**
 * 台版新楓之谷查詢站 — Cloudflare Worker 代理
 *
 * 為什麼需要它：GitHub Pages 只能放靜態檔，金鑰若放前端等於公開。
 * 這支 Worker 把金鑰留在伺服器端，前端只跟它說話。
 *
 * 封測期間有兩道關卡（金鑰是共用的，URL 外流就等於開放代理）：
 *   1. 來源白名單 ALLOWED_ORIGINS
 *   2. 封測碼 BETA_TOKEN（前端以 x-beta-token 標頭帶上）
 *
 * 環境變數（wrangler secret put）：
 *   NEXON_KEY        必填，live_ 開頭的金鑰
 *   BETA_TOKEN       必填，發給測試者的通行碼
 *   ALLOWED_ORIGINS  必填，逗號分隔，例如 https://你的帳號.github.io
 */

const UPSTREAM = 'https://open.api.nexon.com/maplestorytw/v1';

/* 官方資料每日凌晨才更新，帶 date 的是不會再變的歷史快照；
   不帶 date 的是近即時資料，只能短快取。 */
const TTL_DATED = 21600;   // 6 小時
const TTL_LIVE = 180;      // 3 分鐘

function originAllowed(origin, env) {
  if (!origin) return false;
  const list = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.indexOf(origin) !== -1;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'x-beta-token,content-type',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8' },
      corsHeaders(origin || '*')
    ),
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    /* --- 預檢 --- */
    if (request.method === 'OPTIONS') {
      if (!originAllowed(origin, env)) {
        return new Response('forbidden origin', { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'GET') {
      return jsonResponse({ error: { name: 'METHOD', message: '只接受 GET' } },
        405, origin);
    }

    /* --- 關卡 1：來源白名單 --- */
    if (!originAllowed(origin, env)) {
      return jsonResponse(
        { error: { name: 'ORIGIN_DENIED', message: '此來源未被允許' } }, 403, origin);
    }

    /* --- 關卡 2：封測碼 --- */
    if (!env.BETA_TOKEN || request.headers.get('x-beta-token') !== env.BETA_TOKEN) {
      return jsonResponse(
        { error: { name: 'BETA_DENIED', message: '封測碼不正確' } }, 401, origin);
    }

    if (!url.pathname.startsWith('/api/')) {
      return jsonResponse({ error: { name: 'NOT_FOUND', message: '無此路徑' } },
        404, origin);
    }

    const path = url.pathname.slice('/api/'.length);

    /* 前端會問狀態，這裡回一份 Worker 版的 */
    if (path === 'status') {
      return jsonResponse({
        has_key: !!env.NEXON_KEY,
        key_hint: env.NEXON_KEY ? env.NEXON_KEY.slice(0, 6) + '…' : '',
        key_tier: '封測（Worker 代理）',
        source: 'Cloudflare Worker',
        quota_used: 0,
        quota_budget: 0,
        cached_entries: 0,
      }, 200, origin);
    }

    if (!env.NEXON_KEY) {
      return jsonResponse(
        { error: { name: 'NO_API_KEY', message: 'Worker 未設定 NEXON_KEY' } },
        500, origin);
    }

    /* --- 代理到官方 --- */
    const params = new URLSearchParams(url.search);
    params.delete('_fresh');                       // 前端用的旗標，不往上游送
    const hasDate = !!params.get('date');
    const target = UPSTREAM + '/' + path
      + (params.toString() ? '?' + params.toString() : '');

    const cache = caches.default;
    const cacheKey = new Request(target, { method: 'GET' });

    let hit = await cache.match(cacheKey);
    if (hit) {
      const out = new Response(hit.body, hit);
      Object.entries(corsHeaders(origin)).forEach(([k, v]) => out.headers.set(k, v));
      out.headers.set('X-Cache', 'HIT');
      return out;
    }

    const upstream = await fetch(target, {
      headers: { 'x-nxopen-api-key': env.NEXON_KEY, 'Accept': 'application/json' },
    });

    const body = await upstream.text();
    const out = new Response(body, {
      status: upstream.status,
      headers: Object.assign(
        { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'MISS' },
        corsHeaders(origin)
      ),
    });

    if (upstream.ok) {
      const ttl = hasDate ? TTL_DATED : TTL_LIVE;
      const cached = new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=' + ttl,
        },
      });
      ctx.waitUntil(cache.put(cacheKey, cached));
    }

    return out;
  },
};
