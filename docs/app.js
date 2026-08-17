'use strict';

/* ================================================================== *
 * 小工具
 * ================================================================== */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function num(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('zh-TW') : String(v);
}

function txt(v) {
  return (v === null || v === undefined || v === '') ? '—' : String(v);
}

/**
 * liberation_quest_clear 的值不是布林 —— 實測回傳字串 "2"，是階段數。
 * 官方文件查不到刻度定義，所以原值照實顯示，不自行詮釋成「已完成」。
 * 也一併容錯 true/false，以免其他角色回傳的型別不同。
 */
function liberationLabel(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (v === 'true') return '已完成';
  if (v === 'false') return '未完成';
  const n = Number(v);
  return Number.isFinite(n) ? ('第 ' + n + ' 階段') : String(v);
}

/** 秒數 -> mm:ss */
function secs(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return txt(v);
  const m = Math.floor(n / 60);
  const s = n % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/**
 * 目前可查到的最新日期。
 *
 * 官方資料一天只更新一次：凌晨 2 點後才查得到「前一天」的資料
 * （韓版公告載明 2024-07-11 起由 1 點改為 2 點）。所以在凌晨 2 點前，
 * 最新可查的其實是前天。台版沒有另外公告時間，這裡以 2 點為界較保險；
 * 萬一抓錯，api() 還會自動改成不帶 date 重試一次。
 */
function latestDataDate() {
  const tw = new Date(Date.now() + 8 * 3600 * 1000);   // 轉成 UTC+8
  tw.setUTCDate(tw.getUTCDate() - (tw.getUTCHours() < 2 ? 2 : 1));
  return tw.toISOString().slice(0, 10);
}

function spinner(box, label) {
  box.className = 'status';
  box.innerHTML = '';
  box.appendChild(el('span', 'spinner'));
  box.appendChild(el('span', null, label));
  setWelcome(false);
}

function showError(box, msg) {
  box.className = 'status error';
  box.textContent = msg;
  setWelcome(false);
}

function setWelcome(show) {
  const w = $('#welcome');
  if (w) w.hidden = !show;
}

/* ================================================================== *
 * API
 *
 * 兩種執行模式：
 *   本機  —— 由 server.py 代理，路徑就是 /api/…，金鑰存在 apikey.txt
 *   線上  —— 靜態站（GitHub Pages）+ Cloudflare Worker 代理，
 *            金鑰留在 Worker，前端只帶封測碼
 * ================================================================== */

/* Cloudflare Worker 代理。金鑰存在它的 secret 裡，前端拿不到也不需要。 */
const WORKER_URL = 'https://maple-tw-proxy.karmma33.workers.dev';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', ''];
const HOSTED = LOCAL_HOSTS.indexOf(location.hostname) === -1;
const API_BASE = HOSTED ? (WORKER_URL + '/api/') : '/api/';

const BETA_KEY = 'tms.betaToken';

function betaToken() {
  try {
    return localStorage.getItem(BETA_KEY) || '';
  } catch (e) {
    return '';
  }
}

function setBetaToken(v) {
  try {
    localStorage.setItem(BETA_KEY, v);
  } catch (e) { /* 隱私模式就算了 */ }
}

/**
 * 封測碼要放進 HTTP 標頭。中文與 emoji 會讓 fetch 直接拋 TypeError
 * （無法轉成 ByteString），錯誤訊息又難懂，所以先擋下並說清楚。
 *
 * 這裡刻意比規範更嚴：標頭值其實接受整個 Latin-1（連 é ü 都過得了），
 * 但 wrangler 存的是 UTF-8、瀏覽器送的是 Latin-1 單位元組，兩邊編碼對不上，
 * 結果會是「設了一個看似有效卻永遠驗不過的碼」。限制成 ASCII 可以避免這種悶虧。
 *
 * 回傳錯誤說明，沒問題則回傳空字串。
 */
function betaTokenProblem(v) {
  if (!v) return '請輸入封測碼。';
  if (/[\r\n]/.test(v)) return '封測碼不能包含換行。';
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E\t]/.test(v)) {
    return '封測碼只能使用半形英數字與符號 —— 它要放進 HTTP 標頭，'
         + '中文、emoji 等非 ASCII 字元無法傳送。';
  }
  return '';
}

/** 統一出口：線上模式會補上封測碼標頭 */
function apiFetch(path, init) {
  const opts = init || {};
  if (HOSTED) {
    // 舊版存下的封測碼可能含非 ASCII，帶進標頭會讓 fetch 拋錯，
    // 那樣連錯誤訊息都顯示不出來。有問題就送空字串，讓 Worker 回 401。
    const t = betaToken();
    opts.headers = Object.assign({}, opts.headers, {
      'x-beta-token': betaTokenProblem(t) ? '' : t,
    });
  }
  return fetch(API_BASE + path, opts);
}

async function rawCall(path, params) {
  const qs = new URLSearchParams();
  Object.keys(params || {}).forEach((k) => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  });
  const res = await apiFetch(path + (qs.toString() ? '?' + qs.toString() : ''));
  let body = null;
  try { body = await res.json(); } catch (e) { /* 保持 null */ }
  return { ok: res.ok, status: res.status, body: body,
           cached: res.headers.get('X-Cache') === 'HIT' };
}

/**
 * 打本機代理。若帶了 date 而失敗，會再試一次不帶 date
 * （部分端點對日期敏感，不帶就回最新一筆）。
 */
async function api(path, params) {
  params = params || {};
  let r = await rawCall(path, params);

  if (!r.ok && params.date) {
    const retry = Object.assign({}, params);
    delete retry.date;
    const r2 = await rawCall(path, retry);
    if (r2.ok) { refreshQuota(); return r2.body; }
  }

  refreshQuota();
  if (!r.ok) {
    const e = r.body && r.body.error;
    const err = new Error(e ? (e.message || e.name) : ('HTTP ' + r.status));
    err.code = e ? e.name : ('HTTP' + r.status);
    err.status = r.status;
    throw err;
  }
  return r.body;
}

/** 不會 throw 的版本 */
async function trySection(path, params) {
  try {
    return { ok: true, data: await api(path, params) };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code, status: err.status };
  }
}

let quotaTimer = null;
function refreshQuota() {
  clearTimeout(quotaTimer);
  quotaTimer = setTimeout(async () => {
    try {
      const s = await (await apiFetch('status')).json();
      const box = $('#quota');

      // 金鑰／封測碼有沒有過關 —— 這個提示兩種模式都要留
      $('#keyBtn').classList.toggle('no-key', !s.has_key);

      /* 配額只對「跑本機代理的人」有意義：他自己在燒自己的每日額度。
         線上封測版的金鑰在 Worker 端，前端問到的一律是 0 / 0，
         顯示出來只會讓測試者以為壞掉，所以整顆徽章不出現。 */
      if (HOSTED) { box.hidden = true; return; }

      box.hidden = false;
      if (!s.has_key) {
        box.textContent = '未設 API 金鑰';
        box.className = 'quota bad';
        return;
      }
      const pct = s.quota_budget ? (s.quota_used / s.quota_budget) : 0;
      box.textContent = 'API ' + s.quota_used + ' / ' + s.quota_budget;
      box.className = 'quota' + (pct > 0.85 ? ' bad' : (pct > 0.6 ? ' warn' : ''));
      box.title = '今日已用 API 次數（' + s.key_tier + '金鑰）· 快取 '
                + s.cached_entries + ' 筆';
    } catch (e) { /* 忽略 */ }
  }, 250);
}

/* ================================================================== *
 * 角色查詢
 * ================================================================== */

const EP = {
  basic:         'character/basic',
  stat:          'character/stat',
  popularity:    'character/popularity',
  ability:       'character/ability',
  hyperStat:     'character/hyper-stat',
  propensity:    'character/propensity',
  dojang:        'character/dojang',
  equip:         'character/item-equipment',
  cash:          'character/cashitem-equipment',
  symbol:        'character/symbol-equipment',
  setEffect:     'character/set-effect',
  beauty:        'character/beauty-equipment',
  android:       'character/android-equipment',
  pet:           'character/pet-equipment',
  linkSkill:     'character/link-skill',
  vmatrix:       'character/vmatrix',
  hexa:          'character/hexamatrix',
  hexaStat:      'character/hexamatrix-stat',
  union:         'user/union',
  unionRaider:   'user/union-raider',
  unionArtifact: 'user/union-artifact',
  familiar:      'character/familiar',
  unionChampion: 'user/union-champion',
  skill6:        'character/skill',
  skill5:        'character/skill',
  skill4:        'character/skill',
};

/* 少數端點需要額外參數。HEXA / V 核心本身沒有圖示欄位，
   要靠各轉技能清單的 skill_icon 對照出來。 */
const EP_EXTRA = {
  skill6: { character_skill_grade: '6' },
  skill5: { character_skill_grade: '5' },
  skill4: { character_skill_grade: '4' },
};

const EP_LABEL = {
  basic: '基本資訊', stat: '綜合能力值', popularity: '人氣', ability: '潛能能力',
  hyperStat: '極限屬性', propensity: '性向', dojang: '武陵道場', equip: '裝備',
  cash: '現金裝備', symbol: '符文', setEffect: '套裝效果', beauty: '造型',
  android: '機器人', pet: '寵物', linkSkill: '連結技能', vmatrix: 'V 矩陣',
  hexa: 'HEXA 矩陣', hexaStat: 'HEXA 能力值', union: '聯盟',
  unionRaider: '聯盟攻擊隊', unionArtifact: '聯盟神器', unionChampion: '聯盟冠軍',
  familiar: '萌獸',
  skill6: '6 轉技能（供 HEXA 取圖示）',
  skill5: '5 轉技能（供 V 矩陣取圖示）',
  skill4: '4 轉技能（強化核心的圖示來源）',
};

const SKILL_GRADES = ['0', '1', '1.5', '2', '2.5', '3', '4',
                      'hyperpassive', 'hyperactive', '5', '6'];

let DATA = {};
let OCID = '';
let QDATE = '';
let FRESH = false;      // 下一批請求要不要跳過伺服器快取
let FETCHED_AT = null;  // 這批資料的取得時間，顯示在「最近更新」

function d(key) {
  const s = DATA[key];
  return (s && s.ok) ? s.data : null;
}

/** 按需抓取：只打還沒抓過的端點，省配額 */
async function need(keys) {
  const missing = keys.filter((k) => !DATA[k]);
  if (!missing.length) return;
  const results = await Promise.all(
    missing.map((k) => trySection(EP[k], Object.assign({
      ocid: OCID, date: QDATE, _fresh: FRESH ? '1' : '',
    }, EP_EXTRA[k] || {})))
  );
  missing.forEach((k, i) => { DATA[k] = results[i]; });
}

async function lookup(name, date) {
  const box = $('#status');
  const out = $('#result');

  out.hidden = true;
  spinner(box, '查詢「' + name + '」中…');
  $('#goBtn').disabled = true;
  DATA = {};
  QDATE = date;

  try {
    const id = await api('id', { character_name: name });
    OCID = id.ocid;
  } catch (err) {
    $('#goBtn').disabled = false;
    showError(box, '找不到角色「' + name + '」：' + err.message);
    return;
  }

  // 首屏：角色卡上的三張資訊卡需要武陵與聯盟
  await need(['basic', 'stat', 'popularity', 'dojang', 'union']);
  FETCHED_AT = new Date();

  $('#goBtn').disabled = false;
  box.textContent = '';
  box.className = 'status';
  render(name);
  out.hidden = false;
  setWelcome(false);
  histAdd(name, d('basic'));
}

const TABS = [
  ['總覽',     ['basic', 'stat', 'popularity', 'ability', 'hyperStat', 'propensity', 'dojang'], renderOverview],
  ['裝備',     ['equip', 'setEffect'],                          renderEquip],
  ['造型',     ['beauty', 'android', 'cash'],                   renderCosmetic],
  ['寵物',     ['pet'],                                         renderPets],
  ['萌獸',     ['familiar'],                                    renderFamiliar],
  ['符文',     ['symbol'],                                      renderSymbol],
  ['聯盟',     ['union', 'unionRaider', 'unionArtifact', 'unionChampion'], renderUnion],
  ['HEXA',     ['hexa', 'hexaStat', 'skill6'],                  renderHexa],
  ['V 矩陣',   ['vmatrix', 'skill5', 'skill4'],                 renderVMatrix],
  ['技能',     ['linkSkill'],                                   renderSkills],
  ['經驗',     [],                                              renderExp],
  ['原始資料', [],                                              renderRaw],
];

function render(name) {
  const box = $('#result');
  box.innerHTML = '';
  box.appendChild(renderHero(name));

  const tabsWrap = el('div', 'tabs-wrap');
  tabsWrap.appendChild(el('p', 'tabs-hint',
    '👆 點選分頁查看詳細資料 · 各分頁首次開啟才會向 API 請求，節省配額'));

  const tabs = el('div', 'tabs');
  const panels = el('div', 'panels');

  TABS.forEach(([label, needs, fn], i) => {
    const btn = el('button', 'tab' + (i === 0 ? ' active loaded' : ''), label);
    btn.type = 'button';
    const panel = el('div', 'panel' + (i === 0 ? ' active' : ''));
    let loaded = false;

    async function activate() {
      tabs.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      panels.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      panel.classList.add('active');

      if (loaded) return;
      loaded = true;
      panel.innerHTML = '';
      if (needs.length) {
        const s = el('div', 'status');
        s.appendChild(el('span', 'spinner'));
        s.appendChild(el('span', null, '載入「' + label + '」中…'));
        panel.appendChild(s);
        await need(needs);
        panel.innerHTML = '';
      }
      try {
        panel.appendChild(fn());
        btn.classList.add('loaded');
      } catch (err) {
        panel.appendChild(el('div', 'err-line', '這一區渲染失敗：' + err.message));
        btn.classList.add('loaded');
      }
    }

    btn.addEventListener('click', activate);
    tabs.appendChild(btn);
    panels.appendChild(panel);

    if (i === 0) activate();
  });

  tabsWrap.appendChild(tabs);
  box.appendChild(tabsWrap);
  box.appendChild(panels);
}

function findStat(names) {
  const stat = d('stat');
  if (!stat || !Array.isArray(stat.final_stat)) return null;
  for (const row of stat.final_stat) {
    for (const n of names) {
      if (row.stat_name && row.stat_name.indexOf(n) !== -1) return row.stat_value;
    }
  }
  return null;
}

/** 資訊卡：標題 + 若干列「名稱 ....... 值」 */
function infoCard(heading, rows) {
  const live = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!live.length) return null;

  const card = el('div', 'icard');
  card.appendChild(el('div', 'icard-h', heading));
  live.forEach(([k, v]) => {
    const r = el('div', 'icard-r');
    r.appendChild(el('span', 'icard-k', k));
    r.appendChild(el('span', 'icard-v', v));
    card.appendChild(r);
  });
  return card;
}

function renderHero(name) {
  const basic = d('basic') || {};
  const pop = d('popularity');
  const dj = d('dojang');
  const un = d('union');

  const hero = el('div', 'hero');

  /* ---- 左：身分 ---- */
  const left = el('div', 'hero-id');

  const imgBox = el('div', 'hero-img');
  attachIcon(imgBox, basic.character_image, '🍁');
  left.appendChild(imgBox);

  if (basic.character_class) {
    left.appendChild(el('div', 'hero-class', basic.character_class));
  }
  left.appendChild(el('div', 'hero-name', basic.character_name || name));

  const meta = el('div', 'hero-sub');
  if (basic.world_name) meta.appendChild(el('span', 'hero-world', basic.world_name));
  if (basic.character_guild_name) {
    meta.appendChild(el('span', 'hero-guild', basic.character_guild_name));
  }
  if (basic.character_gender) {
    meta.appendChild(el('span', 'hero-gender', basic.character_gender));
  }
  left.appendChild(meta);

  /* API 沒有登入時間欄位，這是從經驗快照反推的「最後有活動的日期」 */
  const act = OCID ? lastActiveFromExp(OCID, {
    lv: Number(basic.character_level),
    rate: parseFloat(basic.character_exp_rate),
  }) : null;

  const facts = el('div', 'hero-facts');
  [
    ['名聲', pop ? num(pop.popularity) : null],
    ['創角時間', basic.character_date_create
      ? String(basic.character_date_create).slice(0, 10).replace(/-/g, '/') : null],
    ['最後活動', act ? act.label : null,
      'API 沒有登入時間欄位。這是從經驗快照反推的 —— 經驗有變動代表當天有上線。'
      + '需先在「經驗」分頁載入資料才會出現。'],
    ['最近更新', FETCHED_AT
      ? FETCHED_AT.toLocaleString('zh-TW', { hour12: false }).replace(/:\d\d$/, '')
      : null, '本站取得這批資料的時間'],
  ].filter(([, v]) => v).forEach(([k, v, tip]) => {
    const r = el('div', 'icard-r');
    if (tip) r.title = tip;
    r.appendChild(el('span', 'icard-k' + (tip ? ' hinted' : ''), k));
    r.appendChild(el('span', 'icard-v', v));
    facts.appendChild(r);
  });

  if (basic.access_flag === 'true' || basic.access_flag === 'false') {
    const on = basic.access_flag === 'true';
    const st = el('div', 'hero-online' + (on ? ' on' : ''));
    st.appendChild(el('span', 'dot'));
    st.appendChild(document.createTextNode(on ? '近日登入' : '近日未登入'));
    facts.appendChild(st);
  }
  left.appendChild(facts);
  hero.appendChild(left);

  /* ---- 右：等級、經驗條、資訊卡 ---- */
  const right = el('div', 'hero-main');

  const rate = parseFloat(basic.character_exp_rate);
  const lvRow = el('div', 'hero-lv');
  lvRow.appendChild(el('b', null, 'Lv. ' + txt(basic.character_level)));
  if (Number.isFinite(rate)) {
    lvRow.appendChild(el('span', 'hero-rate', '(' + rate + '%)'));
  }
  if (QDATE) lvRow.appendChild(el('span', 'hero-asof', '📅 ' + QDATE + ' 快照'));
  right.appendChild(lvRow);

  if (Number.isFinite(rate)) {
    const bar = el('div', 'expbar');
    const fill = el('i');
    fill.style.width = Math.max(0, Math.min(100, rate)) + '%';
    bar.appendChild(fill);
    bar.title = 'EXP ' + num(basic.character_exp);
    right.appendChild(bar);
  }

  const cards = el('div', 'icards');
  const power = findStat(['戰鬥力', '전투력', 'Combat']);

  [
    infoCard('主要數值', [
      ['戰鬥力', power === null ? null : num(power)],
      ['BOSS傷害', findStat(['BOSS怪物傷害'])],
      ['無視防禦率', findStat(['無視防禦率'])],
      ['爆擊傷害', findStat(['爆擊傷害'])],
    ]),
    infoCard('武陵紀錄', dj ? [
      ['最高樓層', dj.dojang_best_floor ? dj.dojang_best_floor + 'F' : null],
      ['最快時間', dj.dojang_best_time !== undefined ? secs(dj.dojang_best_time) : null],
      ['記錄日期', dj.date_dojang_record
        ? String(dj.date_dojang_record).slice(0, 10).replace(/-/g, '/') : null],
    ] : []),
    infoCard('聯盟資訊', un ? [
      ['聯盟等級', num(un.union_level)],
      ['聯盟階級', un.union_grade],
      ['神器等級', num(un.union_artifact_level)],
    ] : []),
  ].forEach((c) => { if (c) cards.appendChild(c); });

  right.appendChild(cards);
  hero.appendChild(right);

  if (!QDATE) {
    const re = el('button', 'ghost hero-refresh', '↻ 重新整理');
    re.type = 'button';
    re.title = '跳過快取，重新向官方要一次最新資料';
    re.addEventListener('click', async () => {
      re.disabled = true;
      re.textContent = '重新整理中…';
      FRESH = true;
      try {
        await lookup(basic.character_name || name, '');
      } finally {
        FRESH = false;
      }
    });
    hero.appendChild(re);
  }
  return hero;
}

function kvGrid(pairs) {
  const grid = el('div', 'grid');
  pairs.forEach(([k, v]) => {
    const c = el('div', 'kv');
    c.appendChild(el('div', 'k', k));
    c.appendChild(el('div', 'v', v));
    grid.appendChild(c);
  });
  return grid;
}

function title(text) { return el('div', 'section-title', text); }

/**
 * 分頁切換器。
 * defs = [{ label, build:()=>Node }]，active 為預設選中的索引。
 * 各分頁的內容第一次點開才建，建好後留著重用。
 */
function presetTabs(defs, active) {
  const box = el('div', 'psets');
  const bar = el('div', 'pset-bar');
  const body = el('div', 'pset-body');
  const built = [];

  const idx = (active >= 0 && active < defs.length) ? active : 0;

  function show(i) {
    bar.querySelectorAll('.pset').forEach((x, j) => {
      x.classList.toggle('active', j === i);
    });
    body.innerHTML = '';
    if (!built[i]) built[i] = defs[i].build();
    body.appendChild(built[i]);
  }

  defs.forEach((dfn, i) => {
    const b = el('button', 'pset', dfn.label);
    b.type = 'button';
    b.addEventListener('click', () => show(i));
    bar.appendChild(b);
  });

  box.appendChild(bar);
  box.appendChild(body);
  show(idx);
  return box;
}

/** 依 preset_no 產生分頁標籤，使用中的那組加註記 */
function presetLabels(count, activeNo, prefix) {
  const out = [];
  for (let i = 1; i <= count; i++) {
    out.push((prefix || '第 ') + i + ' 組' + (Number(activeNo) === i ? '（使用中）' : ''));
  }
  return out;
}
function frag() { return document.createDocumentFragment(); }

function errLine(key) {
  const s = DATA[key];
  if (s && !s.ok) return el('div', 'err-line', (EP_LABEL[key] || key) + '：' + s.error);
  return null;
}

function addErrors(f, keys) {
  keys.forEach((k) => { const e = errLine(k); if (e) f.appendChild(e); });
}

/* ---------- 總覽 ---------- */

/**
 * 從經驗快照反推最後一次有活動的日期。
 *
 * API 沒有登入時間欄位，但經驗或等級有變動就代表那段期間有上線。
 * 注意快照語意：date=D 取得的是 D 當天 00:00 的狀態，所以 D-1 與 D 兩張
 * 快照之間的差異，是發生在「D-1 那一天」。
 *
 * 回傳 { label, exact } 或 null（資料不足）。
 */
function lastActiveFromExp(ocid, current) {
  const store = expLoad(ocid);
  const dates = Object.keys(store).filter((k) => store[k]).sort();
  if (!dates.length) return null;

  // 目前這筆（查最新時就是即時值）接在序列尾端
  const ymd = (s) => String(s).replace(/-/g, '/');

  const newest = store[dates[dates.length - 1]];
  if (current && Number.isFinite(current.lv)) {
    const g = gainInLevels(newest, current);
    if (g !== null && Math.abs(g) > 1e-9) {
      const tw = new Date(Date.now() + 8 * 3600 * 1000);
      return { label: ymd(tw.toISOString().slice(0, 10)), exact: true, today: true };
    }
  }

  for (let i = dates.length - 1; i >= 1; i--) {
    const g = gainInLevels(store[dates[i - 1]], store[dates[i]]);
    if (g !== null && Math.abs(g) > 1e-9) {
      return { label: ymd(dates[i - 1]), exact: true };
    }
  }
  return { label: ymd(dates[0]) + ' 之前', exact: false };
}

function renderOverview() {
  const f = frag();
  const basic = d('basic') || {};
  const stat = d('stat');
  const pop = d('popularity');
  const dojang = d('dojang');
  const ability = d('ability');
  const propensity = d('propensity');
  const hyper = d('hyperStat');

  // 角色卡上的「最後活動」需要經驗快照才算得出來，這裡只判斷有沒有資料
  const hasExp = OCID ? !!lastActiveFromExp(OCID, null) : false;

  f.appendChild(title('角色'));
  f.appendChild(kvGrid([
    ['角色名稱', txt(basic.character_name)],
    ['世界', txt(basic.world_name)],
    ['職業', txt(basic.character_class)],
    ['轉職階段', txt(basic.character_class_level)],
    ['等級', basic.character_level ? 'Lv.' + basic.character_level : '—'],
    ['性別', txt(basic.character_gender)],
    ['公會', txt(basic.character_guild_name)],
    ['解放進度', liberationLabel(basic.liberation_quest_clear)],
  ]));

  if (!hasExp) {
    f.appendChild(el('p', 'hint',
      'API 沒有登入時間欄位。角色卡上的「最後活動」是從經驗快照反推的 —— '
      + '到「經驗」分頁按一次載入後就會出現。'));
  }
  addErrors(f, ['basic', 'popularity', 'dojang']);

  if (stat && Array.isArray(stat.final_stat)) {
    f.appendChild(title('綜合能力值'));
    f.appendChild(kvGrid(stat.final_stat.map((s) => [s.stat_name, num(s.stat_value)])));
    if (stat.remain_ap !== undefined) {
      f.appendChild(el('p', 'hint', '剩餘 AP：' + num(stat.remain_ap)));
    }
  } else {
    addErrors(f, ['stat']);
  }

  if (hyper) {
    const defs = [];
    presetLabels(3, hyper.use_preset_no).forEach((label, i) => {
      const n = i + 1;
      const arr = hyper['hyper_stat_preset_' + n];
      if (!Array.isArray(arr)) return;
      const rows = arr.filter((h) => h.stat_level);
      if (!rows.length) return;
      defs.push({
        label: label,
        build: () => {
          const box = el('div');
          box.appendChild(kvGrid(rows.map((h) =>
            [h.stat_type, 'Lv.' + h.stat_level + '　' + txt(h.stat_increase)])));
          const remain = hyper['hyper_stat_preset_' + n + '_remain_point'];
          if (remain !== undefined) {
            box.appendChild(el('p', 'hint', '剩餘點數：' + num(remain)));
          }
          return box;
        },
      });
    });
    if (defs.length) {
      f.appendChild(title('極限屬性'));
      f.appendChild(presetTabs(defs, Math.max(0, n0(hyper.use_preset_no) - 1)));
    }
  }

  if (ability) {
    const defs = [];
    presetLabels(3, ability.preset_no).forEach((label, i) => {
      const p = ability['ability_preset_' + (i + 1)];
      const info = p && p.ability_info;
      if (!Array.isArray(info) || !info.length) return;
      defs.push({
        label: label + (p.ability_preset_grade ? '　' + p.ability_preset_grade : ''),
        build: () => kvGrid(info.map((a) =>
          ['第 ' + a.ability_no + ' 行 · ' + txt(a.ability_grade), txt(a.ability_value)])),
      });
    });

    if (defs.length) {
      f.appendChild(title('潛能能力（' + txt(ability.ability_grade) + '）'));
      f.appendChild(presetTabs(defs, Math.max(0, n0(ability.preset_no) - 1)));
    } else if (Array.isArray(ability.ability_info)) {
      f.appendChild(title('潛能能力（' + txt(ability.ability_grade) + '）'));
      f.appendChild(kvGrid(ability.ability_info.map((a) =>
        ['第 ' + a.ability_no + ' 行 · ' + txt(a.ability_grade), txt(a.ability_value)])));
    }
    if (ability.remain_fame !== undefined) {
      f.appendChild(el('p', 'hint', '剩餘名聲值：' + num(ability.remain_fame)));
    }
  }

  if (propensity) {
    f.appendChild(title('性向'));
    f.appendChild(kvGrid([
      ['領導力', num(propensity.charisma_level)],
      ['感受性', num(propensity.sensibility_level)],
      ['洞察力', num(propensity.insight_level)],
      ['意志', num(propensity.willingness_level)],
      ['手技', num(propensity.handicraft_level)],
      ['魅力', num(propensity.charm_level)],
    ]));
  }
  return f;
}

/* ---------- 裝備 ---------- */

const POT_CLASS = {
  '稀有': 'rare', '史詩': 'epic', '罕見': 'unique', '傳說': 'legendary',
  '레어': 'rare', '에픽': 'epic', '유니크': 'unique', '레전드리': 'legendary',
  'Rare': 'rare', 'Epic': 'epic', 'Unique': 'unique', 'Legendary': 'legendary',
};

function itemCard(opts) {
  const card = el('div', 'item');

  const icon = el('div', 'item-icon');
  attachIcon(icon, opts.icon, String(opts.name || '?').slice(0, 2));
  card.appendChild(icon);

  const body = el('div', 'item-body');
  body.appendChild(el('div', 'item-part', txt(opts.part)));

  const nameLine = el('div', 'item-name', txt(opts.name));
  if (opts.star) nameLine.appendChild(el('span', 'star', '★' + opts.star));
  body.appendChild(nameLine);

  const list = el('div', 'item-opts');
  (opts.lines || []).forEach((line) => {
    if (line) list.appendChild(el('div', null, line));
  });

  /* 主潛能與附加潛能並列在同一張卡，不再拆成兩張 */
  (opts.pots || []).forEach((p) => {
    const real = (p.lines || []).filter(Boolean);
    if (!p.grade && !real.length) return;

    const block = el('div', 'potblock ' + (POT_CLASS[p.grade] || ''));
    const head = el('div', 'potblock-head');
    head.appendChild(el('span', 'potblock-label', p.label));
    if (p.grade) head.appendChild(el('span', 'pot', p.grade));
    block.appendChild(head);
    real.forEach((l) => block.appendChild(el('div', 'potblock-line', l)));
    list.appendChild(block);
  });

  body.appendChild(list);
  card.appendChild(body);

  if (opts.raw) {
    card.classList.add('clickable');
    card.title = '點擊看完整詳情';
    card.addEventListener('click', () => showItemTip(opts.raw));
  }
  return card;
}

/* ---------- 裝備完整詳情 ---------- */

/* 數值欄位；順序比照遊戲內的排列 */
const OPT_FIELDS = [
  ['str', 'STR'], ['dex', 'DEX'], ['int', 'INT'], ['luk', 'LUK'],
  ['max_hp', '最大HP'], ['max_mp', '最大MP'],
  ['max_hp_rate', '最大HP%'], ['max_mp_rate', '最大MP%'],
  ['attack_power', '攻擊力'], ['magic_power', '魔法攻擊力'],
  ['armor', '防禦力'], ['speed', '移動速度'], ['jump', '跳躍力'],
  ['boss_damage', 'BOSS怪物傷害%'], ['ignore_monster_armor', '無視怪物防禦率%'],
  ['damage', '傷害%'], ['all_stat', '全屬性%'],
  ['equipment_level_decrease', '裝備等級降低'],
];

/* 四個來源各自的顏色，對應遊戲裡的拆解顯示 */
const OPT_SOURCES = [
  ['item_base_option',      'base',  '基礎'],
  ['item_add_option',       'add',   '追加'],
  ['item_etc_option',       'etc',   '卷軸'],
  ['item_starforce_option', 'star',  '星力'],
];

function n0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function showItemTip(it) {
  const tip = $('#itemTip');
  tip.innerHTML = '';

  const total = it.item_total_option || {};

  /* 星力 */
  const sf = n0(it.starforce);
  if (sf > 0) {
    const stars = el('div', 'tip-stars');
    for (let i = 0; i < sf; i++) {
      stars.appendChild(el('span', 'st', '★'));
      // 每五顆換一組，比照遊戲的分組排列
      if ((i + 1) % 5 === 0 && i + 1 < sf) stars.appendChild(el('span', 'stgap', ' '));
    }
    if (it.starforce_scroll_flag === '使用') {
      stars.appendChild(el('span', 'sfnote', '（星力卷軸）'));
    }
    tip.appendChild(stars);
  }

  tip.appendChild(el('div', 'tip-name', txt(it.item_name)));

  if (it.item_shape_name && it.item_shape_name !== it.item_name) {
    tip.appendChild(el('div', 'tip-shape', '外觀：' + it.item_shape_name));
  }

  /* 圖示 + 分類 */
  const head = el('div', 'tip-head');
  const iconBox = el('div', 'tip-icon');
  attachIcon(iconBox, it.item_icon, String(it.item_name || '?').slice(0, 2));
  head.appendChild(iconBox);

  const tags = el('div', 'tip-tags');
  [it.item_equipment_part, it.item_equipment_slot]
    .filter(Boolean)
    .forEach((t) => tags.appendChild(el('span', 'tag', t)));
  head.appendChild(tags);
  tip.appendChild(head);

  /* 基本欄位 */
  const base = it.item_base_option || {};
  const meta = [];
  if (base.base_equipment_level) meta.push(['要求等級', 'Lv.' + base.base_equipment_level]);
  if (it.equipment_level_increase) meta.push(['等級上限增加', '+' + it.equipment_level_increase]);
  if (it.growth_level) meta.push(['成長等級', 'Lv.' + it.growth_level
    + (it.growth_exp ? '（EXP ' + num(it.growth_exp) + '）' : '')]);
  if (it.special_ring_level) meta.push(['特殊戒指等級', 'Lv.' + it.special_ring_level]);
  if (it.date_expire) meta.push(['到期', String(it.date_expire).slice(0, 10)]);
  if (meta.length) {
    const box = el('div', 'tip-meta');
    meta.forEach(([k, v]) => {
      const row = el('div', 'tip-metarow');
      row.appendChild(el('span', 'k', k));
      row.appendChild(el('span', 'v', v));
      box.appendChild(row);
    });
    tip.appendChild(box);
  }

  /* 數值拆解 — 總計 (基礎 +追加 +卷軸 +星力) */
  const statBox = el('div', 'tip-stats');
  let anyStat = false;
  OPT_FIELDS.forEach(([key, label]) => {
    const tot = n0(total[key]);
    const parts = OPT_SOURCES.map(([src, cls]) => [n0((it[src] || {})[key]), cls]);
    const hasParts = parts.some(([v]) => v !== 0);
    if (tot === 0 && !hasParts) return;
    anyStat = true;

    const row = el('div', 'tip-statrow');
    row.appendChild(el('span', 'sname', label));

    const val = el('span', 'sval');
    val.appendChild(el('b', null, (tot >= 0 ? '+' : '') + num(tot)));

    if (hasParts) {
      const brk = el('span', 'sbreak');
      brk.appendChild(document.createTextNode(' ('));
      let first = true;
      parts.forEach(([v, cls]) => {
        if (v === 0 && cls !== 'base') return;
        if (!first) brk.appendChild(document.createTextNode(' '));
        brk.appendChild(el('span', 'p-' + cls,
          (first ? '' : (v >= 0 ? '+' : '')) + num(v)));
        first = false;
      });
      brk.appendChild(document.createTextNode(')'));
      val.appendChild(brk);
    }
    row.appendChild(val);
    statBox.appendChild(row);
  });
  if (anyStat) {
    tip.appendChild(statBox);
    const legend = el('div', 'tip-legend');
    [['base', '基礎'], ['add', '追加'], ['etc', '卷軸'], ['star', '星力']]
      .forEach(([cls, label]) => {
        legend.appendChild(el('span', 'p-' + cls, label));
      });
    tip.appendChild(legend);
  }

  /* 強化狀態 */
  const up = [];
  if (it.scroll_upgrade !== undefined) {
    up.push('卷軸強化 ' + n0(it.scroll_upgrade) + ' 次'
      + (n0(it.scroll_upgradeable_count) > 0
          ? '（可再 ' + it.scroll_upgradeable_count + ' 次）'
          : '（無法追加強化）'));
  }
  if (n0(it.scroll_resilience_count) > 0) up.push('回復卷軸 ' + it.scroll_resilience_count + ' 次');
  if (n0(it.cuttable_count) > 0 && n0(it.cuttable_count) < 255) {
    up.push('剪刀可用 ' + it.cuttable_count + ' 次');
  }
  // 實測回傳的是字串 "0"/"1" —— 直接判真假的話 "0" 也是 true，會誤顯示
  if (String(it.golden_hammer_flag) === '1') up.push('已使用黃金鎚');
  if (up.length) {
    const box = el('div', 'tip-upgrade');
    up.forEach((u) => box.appendChild(el('div', null, u)));
    tip.appendChild(box);
  }

  /* 潛在能力 */
  [['潛在能力', it.potential_option_grade,
    [it.potential_option_1, it.potential_option_2, it.potential_option_3]],
   ['附加潛在能力', it.additional_potential_option_grade,
    [it.additional_potential_option_1, it.additional_potential_option_2,
     it.additional_potential_option_3]]
  ].forEach(([label, grade, lines]) => {
    const real = lines.filter(Boolean);
    if (!grade && !real.length) return;
    const box = el('div', 'tip-pot ' + (POT_CLASS[grade] || ''));
    const head2 = el('div', 'tip-pothead');
    head2.appendChild(el('span', 'potlabel', label));
    if (grade) head2.appendChild(el('span', 'potgrade', grade));
    box.appendChild(head2);
    real.forEach((l) => {
      const li = el('div', 'potline');
      li.appendChild(el('span', 'dot', '•'));
      li.appendChild(document.createTextNode(l));
      box.appendChild(li);
    });
    tip.appendChild(box);
  });

  /* 靈魂武器 */
  if (it.soul_name || it.soul_option) {
    const box = el('div', 'tip-soul');
    box.appendChild(el('div', 'soulhead', '靈魂武器'));
    if (it.soul_name) box.appendChild(el('div', null, it.soul_name));
    if (it.soul_option) box.appendChild(el('div', 'soulopt', it.soul_option));
    tip.appendChild(box);
  }

  /* 特殊選項 */
  const exc = it.item_exceptional_option || {};
  const excParts = OPT_FIELDS
    .map(([k, label]) => [label, n0(exc[k])])
    .filter(([, v]) => v !== 0)
    .map(([label, v]) => label + ' +' + num(v));
  if (excParts.length) {
    const box = el('div', 'tip-upgrade');
    box.appendChild(el('div', null, '特殊選項：' + excParts.join('、')));
    tip.appendChild(box);
  }

  if (it.item_description) {
    tip.appendChild(el('div', 'tip-desc', it.item_description));
  }

  const close = el('button', 'ghost tip-close', '關閉');
  close.type = 'button';
  close.addEventListener('click', () => { $('#itemModal').hidden = true; });
  tip.appendChild(close);

  $('#itemModal').hidden = false;
  tip.scrollTop = 0;
}

/**
 * 裝備欄版面。中央第 3 欄留給角色圖，左右各兩欄。
 * 值必須完全等於 API 的 item_equipment_slot；空字串代表該格不放東西。
 * 這是照遊戲裝備視窗排的重建版本，要調位置改這張表就好。
 */
const EQUIP_GRID = [
  ['戒指1',    '帽子',     '輔助特殊技能戒指', '披風'],
  ['戒指2',    '臉飾',     '眼飾',           '上衣'],
  ['戒指3',    '耳環',     '墜飾',           '褲/裙'],
  ['戒指4',    '肩膀裝飾',  '墜飾2',          '鞋子'],
  ['口袋道具',  '手套',     '腰帶',           '輔助武器'],
  ['機器心臟',  '武器',     '勳章',           '胸章'],
  ['徽章',     '寶石',     '',              ''],
];

/* 這幾類不在主裝備視窗裡，另外成區 */
const EQUIP_EXTRA = [
  ['圖騰', /^圖騰\d*$/],
  ['拼圖', /^拼圖\d*$/],
];

function equipCell(slot, item) {
  if (!slot) return el('div', 'eqcell blank');

  const cell = el('div', 'eqcell' + (item ? '' : ' empty'));
  cell.title = item ? (slot + '：' + item.item_name) : (slot + '（未裝備）');

  if (!item) {
    cell.appendChild(el('span', 'eq-slotname', slot));
    return cell;
  }

  const grade = POT_CLASS[item.potential_option_grade];
  if (grade) cell.classList.add('pot-' + grade);

  cell.appendChild(iconImg(item.item_icon, 34,
    String(item.item_name || '?').slice(0, 2)));

  const sf = n0(item.starforce);
  if (sf > 0) cell.appendChild(el('span', 'eq-star', '★' + sf));

  cell.addEventListener('click', () => showItemTip(item));
  return cell;
}

function equipGrid(bySlot, used) {
  const box = el('div', 'eqgrid');

  EQUIP_GRID.forEach((row, r) => {
    const cols = [1, 2, 4, 5];
    row.forEach((slot, i) => {
      if (slot) used.add(slot);
      const cell = equipCell(slot, bySlot[slot]);
      cell.style.gridColumn = cols[i];
      cell.style.gridRow = r + 1;
      box.appendChild(cell);
    });
  });

  /* 中央角色圖，橫跨前六列 */
  const basic = d('basic') || {};
  const mid = el('div', 'eqpreview');
  mid.style.gridColumn = 3;
  mid.style.gridRow = '1 / span 6';
  if (basic.character_image) {
    const img = document.createElement('img');
    img.src = basic.character_image;
    img.alt = basic.character_name || '';
    img.addEventListener('error', () => { mid.textContent = '🍁'; });
    mid.appendChild(img);
  } else {
    mid.textContent = '🍁';
  }
  box.appendChild(mid);

  return box;
}

function renderEquip() {
  const f = frag();
  addErrors(f, ['equip']);
  const equip = d('equip');
  if (!equip || !Array.isArray(equip.item_equipment)) {
    if (!DATA.equip || DATA.equip.ok) f.appendChild(el('div', 'empty', '沒有裝備資料'));
    return f;
  }

  /* 目前穿戴之外，API 另外回傳三組預設，實測三組內容都不一樣 */
  const defs = [{ label: '目前穿戴', build: () => equipContent(equip.item_equipment) }];
  presetLabels(3, equip.preset_no).forEach((label, i) => {
    const arr = equip['item_equipment_preset_' + (i + 1)];
    if (Array.isArray(arr) && arr.length) {
      defs.push({ label: label, build: () => equipContent(arr) });
    }
  });
  f.appendChild(presetTabs(defs, 0));

  /* 套裝效果是全域的，不隨分頁改變 */
  const se = d('setEffect');
  if (se && Array.isArray(se.set_effect) && se.set_effect.length) {
    f.appendChild(title('套裝效果'));
    f.appendChild(kvGrid(se.set_effect
      .slice()
      .sort((a, b) => n0(b.total_set_count) - n0(a.total_set_count))
      .map((s) => [s.set_name, n0(s.total_set_count) + ' 件套'])));
  }
  return f;
}

function equipContent(items) {
  const f = el('div');
  const bySlot = {};
  items.forEach((it) => { bySlot[it.item_equipment_slot] = it; });

  /* 兩種檢視：裝備欄版面 / 詳細清單 */
  const toggle = el('div', 'eqtoggle');
  const btnGrid = el('button', 'tab active', '裝備欄');
  const btnList = el('button', 'tab', '詳細清單');
  btnGrid.type = btnList.type = 'button';
  toggle.appendChild(btnGrid);
  toggle.appendChild(btnList);
  f.appendChild(toggle);

  const viewGrid = el('div');
  const viewList = el('div');
  viewList.hidden = true;

  btnGrid.addEventListener('click', () => {
    btnGrid.classList.add('active'); btnList.classList.remove('active');
    viewGrid.hidden = false; viewList.hidden = true;
  });
  btnList.addEventListener('click', () => {
    btnList.classList.add('active'); btnGrid.classList.remove('active');
    viewList.hidden = false; viewGrid.hidden = true;
  });

  /* --- 裝備欄版面 --- */
  const used = new Set();
  viewGrid.appendChild(equipGrid(bySlot, used));

  EQUIP_EXTRA.forEach(([label, re]) => {
    const slots = Object.keys(bySlot)
      .filter((s) => re.test(s))
      .sort((a, b) => n0(a.replace(/\D/g, '')) - n0(b.replace(/\D/g, '')));
    if (!slots.length) return;
    slots.forEach((s) => used.add(s));
    viewGrid.appendChild(title(label + '（' + slots.length + '）'));
    const row = el('div', 'eqrow');
    slots.forEach((s) => row.appendChild(equipCell(s, bySlot[s])));
    viewGrid.appendChild(row);
  });

  /* 版面表沒涵蓋到的欄位不能默默消失 */
  const rest = Object.keys(bySlot).filter((s) => !used.has(s));
  if (rest.length) {
    viewGrid.appendChild(title('其他（' + rest.length + '）'));
    const row = el('div', 'eqrow');
    rest.forEach((s) => row.appendChild(equipCell(s, bySlot[s])));
    viewGrid.appendChild(row);
  }

  viewGrid.appendChild(el('p', 'hint',
    '點任一格看完整詳情。外框顏色代表潛能等級。共 ' + items.length + ' 件。'));

  f.appendChild(viewGrid);
  f.appendChild(viewList);

  /* --- 詳細清單 --- */
  const wrap = el('div', 'items');
  items.forEach((it) => {
    const total = it.item_total_option || {};
    const stats = [
      ['STR', total.str], ['DEX', total.dex], ['INT', total.int], ['LUK', total.luk],
      ['攻擊力', total.attack_power], ['魔力', total.magic_power],
      ['全屬性%', total.all_stat], ['BOSS傷%', total.boss_damage],
      ['無視防禦%', total.ignore_monster_armor],
    ].filter(([, v]) => v && Number(v) !== 0).map(([k, v]) => k + ' +' + v);

    const lines = [];
    if (stats.length) lines.push(stats.join('　'));
    if (it.scroll_upgrade && Number(it.scroll_upgrade) > 0) {
      lines.push('卷軸 ' + it.scroll_upgrade + ' 次'
        + (it.scroll_upgradeable_count ? '（可再 ' + it.scroll_upgradeable_count + '）' : ''));
    }
    if (it.soul_name) lines.push('靈魂：' + it.soul_name + ' ' + txt(it.soul_option));
    if (it.date_expire) lines.push('到期：' + String(it.date_expire).slice(0, 10));

    wrap.appendChild(itemCard({
      part: it.item_equipment_part || it.slot_name,
      name: it.item_name,
      icon: it.item_icon,
      star: it.starforce && Number(it.starforce) > 0 ? it.starforce : null,
      lines: lines,
      pots: [
        {
          label: '潛能',
          grade: it.potential_option_grade,
          lines: [it.potential_option_1, it.potential_option_2, it.potential_option_3],
        },
        {
          label: '附加潛能',
          grade: it.additional_potential_option_grade,
          lines: [it.additional_potential_option_1, it.additional_potential_option_2,
                  it.additional_potential_option_3],
        },
      ],
      raw: it,
    }));
  });
  viewList.appendChild(wrap);
  return f;
}

/* ---------- 寵物 ---------- */

function renderPets() {
  const f = frag();
  const pet = d('pet');
  addErrors(f, ['pet']);
  if (!pet) {
    if (!DATA.pet || DATA.pet.ok) f.appendChild(el('div', 'empty', '沒有寵物資料'));
    return f;
  }

  let any = 0;
  for (let i = 1; i <= 3; i++) {
    const p = (k) => pet['pet_' + i + '_' + k];
    if (!p('name')) continue;
    any++;

    const card = el('div', 'petcard');

    /* ---- 標頭 ---- */
    const head = el('div', 'pet-head');
    const iconBox = el('div', 'pet-icon');
    attachIcon(iconBox, p('icon'), String(p('name')).slice(0, 2));
    head.appendChild(iconBox);

    const hi = el('div', 'pet-head-info');
    hi.appendChild(el('div', 'pet-name', txt(p('name'))));

    const tags = el('div', 'pet-tags');
    if (p('nickname') && p('nickname') !== p('name')) {
      tags.appendChild(el('span', 'pet-tag', '暱稱：' + p('nickname')));
    }
    if (p('pet_type')) tags.appendChild(el('span', 'pet-tag type', p('pet_type')));
    if (p('date_expire')) {
      const exp = String(p('date_expire')).slice(0, 10).replace(/-/g, '/');
      // 2079 之類的日期實際上就是「無期限」的表示方式
      const far = Number(exp.slice(0, 4)) >= 2070;
      tags.appendChild(el('span', 'pet-tag', far ? '無期限' : '到期 ' + exp));
    }
    hi.appendChild(tags);
    head.appendChild(hi);
    card.appendChild(head);

    if (p('description')) {
      card.appendChild(el('div', 'pet-desc', p('description')));
    }

    const body = el('div', 'pet-body');

    /* ---- 潛能 ---- */
    const pots = (p('potential') || []).filter((x) => x && x.potential_type);
    if (pots.length) {
      const sec = el('div', 'pet-sec');
      sec.appendChild(el('div', 'pet-sec-h', '寵物潛能'));
      pots.forEach((x) => {
        const row = el('div', 'icard-r');
        row.appendChild(el('span', 'icard-k', x.potential_type));
        const inc = [x.potential_increase1, x.potential_increase2]
          .filter((v) => v !== null && v !== undefined && v !== '')
          .join(' / ');
        row.appendChild(el('span', 'icard-v',
          (inc ? '+' + inc : '—') + (x.potential_step ? '（' + x.potential_step + '階）' : '')));
        sec.appendChild(row);
      });
      body.appendChild(sec);
    }

    /* ---- 自動技能 ---- */
    const au = p('auto_skill') || {};
    const auto = [[au.skill_1, au.skill_1_icon], [au.skill_2, au.skill_2_icon]]
      .filter(([n2]) => n2);
    if (auto.length) {
      const sec = el('div', 'pet-sec');
      sec.appendChild(el('div', 'pet-sec-h', '自動技能'));
      auto.forEach(([n2, ic]) => {
        const row = el('div', 'hexa-skill');
        row.appendChild(iconImg(ic, 22, '·'));
        row.appendChild(el('span', null, n2));
        sec.appendChild(row);
      });
      body.appendChild(sec);
    }

    /* ---- 寵物裝備 ---- */
    const eq = p('equipment');
    if (eq && eq.item_name) {
      const sec = el('div', 'pet-sec');
      sec.appendChild(el('div', 'pet-sec-h', '寵物裝備'));
      const row = el('div', 'cmp-item');
      row.appendChild(iconImg(eq.item_icon, 26, String(eq.item_name).slice(0, 2)));
      const info = el('div', 'cmp-item-info');
      info.appendChild(el('div', 'cmp-item-name', eq.item_name));
      const opts = (eq.item_option || [])
        .filter((o) => o && o.option_type)
        .map((o) => o.option_type + ' +' + o.option_value);
      if (n0(eq.scroll_upgrade) > 0) opts.push('卷軸 ' + eq.scroll_upgrade + ' 次');
      if (opts.length) info.appendChild(el('div', 'cmp-pot', opts.join('　')));
      row.appendChild(info);
      sec.appendChild(row);
      body.appendChild(sec);
    }

    card.appendChild(body);

    /* ---- 技能列表 ---- */
    const skills = p('skill') || [];
    if (skills.length) {
      const sec = el('div', 'pet-sec wide');
      sec.appendChild(el('div', 'pet-sec-h', '寵物技能（' + skills.length + '）'));
      const chips = el('div', 'pet-skills');
      skills.forEach((s) => chips.appendChild(el('span', 'pet-skill', s)));
      sec.appendChild(chips);
      card.appendChild(sec);
    }

    f.appendChild(card);
  }

  if (!any) f.appendChild(el('div', 'empty', '這個角色沒有寵物'));
  return f;
}

/* ---------- 萌獸 ---------- */

/** 一隻萌獸的選項列表 */
function familiarOptions(f) {
  const list = el('div', 'item-opts');
  (f.option || []).forEach((o) => {
    if (!o || !o.option_name) return;
    const row = el('div');
    row.appendChild(document.createTextNode(o.option_name + '　'));
    row.appendChild(el('b', null, txt(o.option_value)));
    list.appendChild(row);
  });
  return list;
}

function familiarCard(f, badge) {
  const card = el('div', 'item famcard');

  const box = el('div', 'item-icon');
  box.appendChild(el('span', 'fam-initial', String(f.familiar_name || '?').slice(0, 2)));
  card.appendChild(box);

  const body = el('div', 'item-body');

  const head = el('div', 'hexa-head');
  head.appendChild(el('span', 'item-name', txt(f.familiar_name)));
  if (f.option_level) head.appendChild(el('span', 'hexa-lv', '選項 Lv.' + f.option_level));
  body.appendChild(head);

  const tags = el('div', 'pet-tags');
  if (badge) tags.appendChild(el('span', 'pet-tag type', badge));
  if (f.familiar_nickname && f.familiar_nickname !== f.familiar_name) {
    tags.appendChild(el('span', 'pet-tag', '暱稱：' + f.familiar_nickname));
  }
  if (f.familiar_level) tags.appendChild(el('span', 'pet-tag', 'Lv.' + f.familiar_level));
  // familiar_grade 的值實測是「爆擊機率」「BOSS怪物傷害」這類，不是稀有度，
  // 所以標成中性的「類型」而不是「等級」
  if (f.familiar_grade) tags.appendChild(el('span', 'pet-tag', '類型：' + f.familiar_grade));
  if (f.skill_name) tags.appendChild(el('span', 'pet-tag', '技能：' + f.skill_name));
  body.appendChild(tags);

  body.appendChild(familiarOptions(f));
  card.appendChild(body);
  return card;
}

function renderFamiliar() {
  const f = frag();
  addErrors(f, ['familiar']);
  const fam = d('familiar');
  if (!fam) {
    if (!DATA.familiar || DATA.familiar.ok) f.appendChild(el('div', 'empty', '沒有萌獸資料'));
    return f;
  }

  const list = fam.familiar_info || [];
  const slots = fam.familiar_link_slot || [];

  /* ---- 召喚中 ---- */
  const summoned = list.filter((x) => x.summoned_flag === 'true');
  if (summoned.length) {
    f.appendChild(title('召喚中'));
    const wrap = el('div', 'items');
    summoned.forEach((x) => wrap.appendChild(familiarCard(x, '召喚中')));
    f.appendChild(wrap);
  }

  /* ---- 羈絆欄位 ---- */
  if (slots.length) {
    f.appendChild(title('萌獸羈絆（' + slots.length + ' 格）'));
    const grid = el('div', 'grid');
    slots.forEach((s) => {
      const c = el('div', 'kv famslot' + (s.active_flag === 'true' ? ' on' : ''));
      c.appendChild(el('div', 'k', '第 ' + txt(s.slot_id) + ' 格'));
      c.appendChild(el('div', 'v', s.familiar_name || '未使用'));
      if (s.expire_date) {
        c.appendChild(el('div', 'famslot-exp',
          '到期 ' + String(s.expire_date).slice(0, 10).replace(/-/g, '/')));
      }
      grid.appendChild(c);
    });
    f.appendChild(grid);
  }

  /* ---- 已羈絆的萌獸 ---- */
  const linked = list.filter((x) => x.familiar_state === 'linked');
  if (linked.length) {
    f.appendChild(title('已羈絆（' + linked.length + '）'));
    const wrap = el('div', 'items');
    linked.forEach((x) => wrap.appendChild(familiarCard(x, '羈絆中')));
    f.appendChild(wrap);
  }

  /* ---- 其餘已登錄的 ---- */
  const rest = list.filter((x) => x.familiar_state !== 'linked'
    && x.summoned_flag !== 'true');
  if (rest.length) {
    const det = el('details', 'exp-table');
    det.appendChild(el('summary', null, '已登錄的萌獸（' + rest.length + '）'));
    const wrap = el('div', 'items');
    rest.forEach((x) => wrap.appendChild(familiarCard(x, null)));
    det.appendChild(wrap);
    f.appendChild(det);
  }

  if (!list.length && !slots.length) {
    f.appendChild(el('div', 'empty', '這個角色沒有萌獸'));
  } else {
    f.appendChild(el('p', 'hint',
      'API 沒有提供萌獸圖示，也沒有遊戲內顯示的稀有度（傳說／罕見等）欄位；'
      + '「類型」欄位是官方回傳的 familiar_grade，實際內容是效果分類而非稀有度。'));
  }
  return f;
}

/* ---------- 造型 ---------- */

function cashCards(list) {
  const wrap = el('div', 'items');
  list.forEach((c) => wrap.appendChild(itemCard({
    part: c.cash_item_equipment_part,
    name: c.cash_item_name,
    icon: c.cash_item_icon,
    lines: [
      (c.cash_item_option || [])
        .map((o) => o.option_type + ' ' + o.option_value).join('　'),
      c.date_expire ? '到期：' + String(c.date_expire).slice(0, 10) : '',
    ],
  })));
  return wrap;
}

function renderCosmetic() {
  const f = frag();
  const beauty = d('beauty');
  const android = d('android');
  const cash = d('cash');

  if (beauty) {
    f.appendChild(title('外觀'));
    f.appendChild(kvGrid([
      ['髮型', txt(beauty.character_hair && beauty.character_hair.hair_name)],
      ['臉型', txt(beauty.character_face && beauty.character_face.face_name)],
      ['膚色', txt(beauty.character_skin && beauty.character_skin.skin_name)],
    ]));
  }

  /* 寵物移到自己的分頁了 —— 那裡才放得下潛能、技能、寵物裝備 */

  if (android && android.android_name) {
    f.appendChild(title('機器人'));
    const wrap = el('div', 'items');
    wrap.appendChild(itemCard({
      part: txt(android.android_nickname),
      name: android.android_name,
      icon: android.android_icon,
    }));
    f.appendChild(wrap);
  }

  if (cash) {
    const defs = [];
    if (Array.isArray(cash.cash_item_equipment_base) && cash.cash_item_equipment_base.length) {
      defs.push({ label: '目前穿戴',
                  build: () => cashCards(cash.cash_item_equipment_base) });
    }
    presetLabels(3, cash.preset_no).forEach((label, i) => {
      const arr = cash['cash_item_equipment_preset_' + (i + 1)];
      if (Array.isArray(arr) && arr.length) {
        defs.push({ label: label, build: () => cashCards(arr) });
      }
    });
    if (defs.length) {
      f.appendChild(title('時裝'));
      f.appendChild(presetTabs(defs, 0));
    }
  }

  addErrors(f, ['beauty', 'android', 'cash']);
  if (!f.childNodes.length) f.appendChild(el('div', 'empty', '沒有造型資料'));
  return f;
}

/* ---------- 符文 ---------- */

function renderSymbol() {
  const f = frag();
  addErrors(f, ['symbol']);
  const sym = d('symbol');
  if (!sym || !Array.isArray(sym.symbol) || !sym.symbol.length) {
    if (!DATA.symbol || DATA.symbol.ok) f.appendChild(el('div', 'empty', '沒有符文資料'));
    return f;
  }

  const wrap = el('div', 'items');
  sym.symbol.forEach((s) => {
    const stats = [
      ['STR', s.symbol_str], ['DEX', s.symbol_dex],
      ['INT', s.symbol_int], ['LUK', s.symbol_luk], ['HP', s.symbol_hp],
    ].filter(([, v]) => v && Number(v) !== 0).map(([k, v]) => k + ' +' + num(v));

    wrap.appendChild(itemCard({
      part: 'Lv.' + txt(s.symbol_level) + '　力量 ' + num(s.symbol_force),
      name: s.symbol_name,
      icon: s.symbol_icon,
      lines: [
        stats.join('　'),
        s.symbol_growth_count !== undefined
          ? '成長 ' + num(s.symbol_growth_count) + ' / ' + num(s.symbol_require_growth_count)
          : '',
      ],
    }));
  });
  f.appendChild(wrap);
  return f;
}

/* ---------- 聯盟 ---------- */

function renderUnion() {
  const f = frag();
  const union = d('union');
  const raider = d('unionRaider');
  const artifact = d('unionArtifact');

  if (union) {
    f.appendChild(title('聯盟'));
    f.appendChild(kvGrid([
      ['聯盟等級', num(union.union_level)],
      ['聯盟等階', txt(union.union_grade)],
      ['神器等級', num(union.union_artifact_level)],
      ['神器經驗', num(union.union_artifact_exp)],
      ['神器點數', num(union.union_artifact_point)],
    ]));
  }

  /* 攻擊隊共五組分頁，每組都有自己的版圖與效果 */
  if (raider) {
    const defs = [];
    if (Array.isArray(raider.union_block) && raider.union_block.length) {
      defs.push({ label: '目前配置', build: () => raiderContent(raider) });
    }
    presetLabels(5, raider.use_preset_no).forEach((label, i) => {
      const p = raider['union_raider_preset_' + (i + 1)];
      if (p && (p.union_block || p.union_raider_stat)) {
        defs.push({ label: label, build: () => raiderContent(p) });
      }
    });
    if (defs.length) {
      f.appendChild(title('聯盟攻擊隊'));
      f.appendChild(presetTabs(defs, 0));
    }
  }

  if (artifact && Array.isArray(artifact.union_artifact_effect)) {
    f.appendChild(title('神器效果'));
    f.appendChild(kvGrid(artifact.union_artifact_effect.map((a) =>
      [txt(a.name), 'Lv.' + txt(a.level)])));
  }

  if (artifact && Array.isArray(artifact.union_artifact_crystal)
      && artifact.union_artifact_crystal.length) {
    f.appendChild(title('神器水晶'));
    const wrap = el('div', 'items');
    artifact.union_artifact_crystal.forEach((c) => {
      const opts = [c.crystal_option_name_1, c.crystal_option_name_2,
                    c.crystal_option_name_3].filter(Boolean);
      wrap.appendChild(itemCard({
        part: 'Lv.' + txt(c.level)
          + (c.date_expire ? '　到期 ' + String(c.date_expire).slice(0, 10) : ''),
        name: c.name,
        lines: opts,
      }));
    });
    f.appendChild(wrap);
  }

  /* 聯盟冠軍 */
  const champ = d('unionChampion');
  if (champ && Array.isArray(champ.union_champion) && champ.union_champion.length) {
    f.appendChild(title('聯盟冠軍'));
    const wrap = el('div', 'items');
    champ.union_champion
      .slice()
      .sort((a, b) => n0(a.champion_slot) - n0(b.champion_slot))
      .forEach((c) => {
        const card = el('div', 'item champ-card');

        /* 冠軍端點沒有角色圖，要用名字反查。先放等階當佔位，
           圖抓回來再換掉，避免整頁等它。 */
        const box = el('div', 'champ-img');
        box.appendChild(el('span', 'champ-grade', txt(c.champion_grade)));
        card.appendChild(box);
        fillChampionImage(box, c.champion_name);

        const body = el('div', 'item-body');
        const head = el('div', 'hexa-head');
        head.appendChild(el('span', 'item-name', txt(c.champion_name)));
        head.appendChild(el('span', 'hexa-lv', '#' + txt(c.champion_slot)));
        body.appendChild(head);
        body.appendChild(el('div', 'item-part',
          txt(c.champion_class) + '　' + txt(c.champion_grade)));

        const list = el('div', 'item-opts');
        (c.champion_badge_info || []).forEach((b) => {
          if (b && b.stat) list.appendChild(el('div', null, b.stat));
        });
        body.appendChild(list);
        card.appendChild(body);
        wrap.appendChild(card);
      });
    f.appendChild(wrap);
    f.appendChild(el('p', 'hint',
      '冠軍端點只給名字，頭像是用名字反查來的（每位 2 次 API，'
      + '本次工作階段內只查一次）。查不到的會維持顯示等階。'));

    const totals = (champ.champion_badge_total_info || [])
      .map((b) => b && b.stat).filter(Boolean);
    if (totals.length) {
      f.appendChild(title('徽章總效果'));
      const list = el('div', 'grid');
      totals.forEach((s) => {
        const c = el('div', 'kv');
        c.appendChild(el('div', 'v', s));
        list.appendChild(c);
      });
      f.appendChild(list);
    }
  }

  addErrors(f, ['union', 'unionRaider', 'unionArtifact', 'unionChampion']);
  if (!f.childNodes.length) f.appendChild(el('div', 'empty', '沒有聯盟資料'));
  return f;
}

/* ---------- 聯盟冠軍頭像 ---------- */

/* union-champion 只給名字，沒有角色圖，得用名字反查（查 ocid + 查 basic，
   每位 2 次 API）。用 Promise 當快取：同一個名字只會發一次請求，
   切分頁回來也不會重抓。 */
const CHAMP_IMG = {};

function championImage(name) {
  if (!CHAMP_IMG[name]) {
    CHAMP_IMG[name] = (async () => {
      try {
        const id = await api('id', { character_name: name });
        const b = await api('character/basic', { ocid: id.ocid });
        return b.character_image || '';
      } catch (e) {
        return '';          // 查不到就放棄，別重試
      }
    })();
  }
  return CHAMP_IMG[name];
}

async function fillChampionImage(box, name) {
  if (!name) return;
  const url = await championImage(name);
  if (!url) return;

  const img = document.createElement('img');
  img.src = url;
  img.alt = name;
  img.loading = 'lazy';
  img.addEventListener('load', () => {
    box.innerHTML = '';     // 圖確定載入後才把等階佔位換掉
    box.appendChild(img);
  });
}

/* ---------- 聯盟版圖 ---------- */

/* 依職業分支上色。取自已驗證的類別配色（深色模式階），
   前五個是主要分支，其餘一律歸「其他」——
   單塊的特殊方塊各給一個顏色只會讓圖例變雜訊。 */
const BLOCK_COLORS = {
  '劍士':   '#3987e5',
  '法師':   '#d95926',
  '弓箭手': '#199e70',
  '盜賊':   '#c98500',
  '海盜':   '#d55181',
};
const BLOCK_OTHER = '#008300';

function unionBoard(blocks) {
  const cells = [];
  blocks.forEach((b) => {
    (b.block_position || []).forEach((p) => cells.push({ p: p, b: b }));
  });
  if (!cells.length) return null;

  const xs = cells.map((c) => c.p.x);
  const ys = cells.map((c) => c.p.y);
  const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;

  /* 固定格子尺寸而非用 1fr —— 版圖有 22 欄，用比例分配會被壓到看不清楚。
     太寬時由外層容器橫向捲動。 */
  const CELL = 26;
  const box = el('div', 'uboard');
  box.style.gridTemplateColumns = 'repeat(' + cols + ', ' + CELL + 'px)';
  box.style.gridTemplateRows = 'repeat(' + rows + ', ' + CELL + 'px)';

  cells.forEach(({ p, b }) => {
    const cell = el('div', 'ucell');
    cell.style.gridColumn = (p.x - minX + 1);
    cell.style.gridRow = (maxY - p.y + 1);      // y 往上為正，畫面往下遞增
    cell.style.background = BLOCK_COLORS[b.block_type] || BLOCK_OTHER;

    const cp = b.block_control_point;
    if (cp && cp.x === p.x && cp.y === p.y) cell.classList.add('ctrl');

    cell.title = b.block_class + '（' + b.block_type + '）Lv.' + b.block_level;
    box.appendChild(cell);
  });

  return { board: box, cols: cols, rows: rows, cells: cells.length };
}

/** 一組攻擊隊配置：版圖 + 三類效果。目前配置與各預設組都用這個渲染 */
function raiderContent(src) {
  const box = el('div');

  const blocks = src.union_block;
  if (Array.isArray(blocks) && blocks.length) {
    const built = unionBoard(blocks);
    if (built) {
      box.appendChild(unionLegend(blocks));
      const scroller = el('div', 'uboard-wrap');
      scroller.appendChild(built.board);
      box.appendChild(scroller);
      box.appendChild(el('p', 'hint',
        blocks.length + ' 塊、佔用 ' + built.cells + ' 格（'
        + built.cols + '×' + built.rows + '）。淺色外框是控制點；'
        + '滑鼠移到方塊上可看職業與等級。'));
    }
  }

  [['攻擊隊效果', src.union_raider_stat],
   ['佔領效果', src.union_occupied_stat],
   ['內部效果', src.union_inner_stat]].forEach(([label, arr]) => {
    if (!Array.isArray(arr) || !arr.length) return;
    box.appendChild(title(label + '（' + arr.length + '）'));
    const list = el('div', 'grid');
    arr.forEach((row) => {
      const c = el('div', 'kv');
      if (typeof row === 'string') {
        c.appendChild(el('div', 'v', row));
      } else {
        c.appendChild(el('div', 'k', txt(row.stat_field_id)));
        c.appendChild(el('div', 'v', txt(row.stat || row.stat_field_effect)));
      }
      list.appendChild(c);
    });
    box.appendChild(list);
  });

  return box;
}

function unionLegend(blocks) {
  const counts = {};
  blocks.forEach((b) => {
    const key = BLOCK_COLORS[b.block_type] ? b.block_type : '其他';
    counts[key] = (counts[key] || 0) + 1;
  });

  const legend = el('div', 'ulegend');
  Object.keys(BLOCK_COLORS).concat(['其他']).forEach((k) => {
    if (!counts[k]) return;
    const item = el('span', 'uleg');
    const sw = el('span', 'usw');
    sw.style.background = BLOCK_COLORS[k] || BLOCK_OTHER;
    item.appendChild(sw);
    item.appendChild(document.createTextNode(k + ' ' + counts[k]));
    legend.appendChild(item);
  });
  return legend;
}

/* ---------- HEXA / V ---------- */

/* 官方對「沒有圖示的道具」不是回 404，而是 308 轉到 /static/empty_img.png。
   請求本身會成功，所以 onerror 永遠不會觸發，畫面只會空一格。
   那張空白圖固定是 256x256，而真實道具圖示都很小（32x32、40x34 之類），
   所以用尺寸就能可靠分辨。 */
const BLANK_ICON_MIN = 200;

/** 把圖塞進容器；抓不到或拿到官方空白圖時，改顯示 fallback 文字 */
function attachIcon(box, src, fallback) {
  const alt = fallback || '·';
  if (!src) {
    box.textContent = alt;
    box.classList.add('noicon');
    return box;
  }
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    box.textContent = alt;
    box.classList.add('noicon');
  });
  img.addEventListener('load', () => {
    if (img.naturalWidth >= BLANK_ICON_MIN && img.naturalHeight >= BLANK_ICON_MIN) {
      box.innerHTML = '';
      box.textContent = alt;
      box.classList.add('noicon');
      box.title = (box.title ? box.title + '　' : '') + '（官方未提供圖示）';
    }
  });
  box.appendChild(img);
  return box;
}

/** 小圖示 */
function iconImg(src, size, fallback) {
  const box = el('span', 'hicon');
  if (size) { box.style.width = size + 'px'; box.style.height = size + 'px'; }
  return attachIcon(box, src, fallback);
}

function hexaCard(c, icons) {
  const linked = (c.linked_skill || [])
    .map((l) => (typeof l === 'string' ? l : (l.hexa_skill_id || l.skill_name)))
    .filter(Boolean);

  // 先用核心名找圖示，找不到再退而用第一個對得上的連結技能
  let icon = icons[c.hexa_core_name];
  if (!icon) {
    for (const n of linked) {
      if (icons[n]) { icon = icons[n]; break; }
    }
  }

  const card = el('div', 'item hexa-card');
  const big = el('div', 'item-icon');
  big.appendChild(iconImg(icon, 38));
  card.appendChild(big);

  const body = el('div', 'item-body');

  const head = el('div', 'hexa-head');
  head.appendChild(el('span', 'item-name', txt(c.hexa_core_name)));
  head.appendChild(el('span', 'hexa-lv', 'Lv.' + txt(c.hexa_core_level)));
  body.appendChild(head);

  // 連結多個技能時才列出來，單一技能與卡片標題重複就不列
  if (linked.length > 1) {
    const row = el('div', 'hexa-linked');
    linked.forEach((n) => {
      const chip = el('span', 'hexa-skill');
      chip.appendChild(iconImg(icons[n], 22));
      chip.appendChild(el('span', null, n));
      row.appendChild(chip);
    });
    body.appendChild(row);
  }

  card.appendChild(body);
  return card;
}

function hexaStatCard(c, label) {
  const card = el('div', 'item hexa-card');

  const box = el('div', 'item-icon');
  box.appendChild(el('span', 'hexa-slot', label || txt(c.slot_id)));
  card.appendChild(box);

  const body = el('div', 'item-body');
  const head = el('div', 'hexa-head');
  head.appendChild(el('span', 'item-name', '能力值核心 ' + (label || txt(c.slot_id))));
  if (c.stat_grade) head.appendChild(el('span', 'hexa-lv', 'Lv.' + c.stat_grade));
  body.appendChild(head);

  const list = el('div', 'item-opts');
  [[c.main_stat_name, c.main_stat_level, true],
   [c.sub_stat_name_1, c.sub_stat_level_1, false],
   [c.sub_stat_name_2, c.sub_stat_level_2, false]]
    .filter(([n]) => n)
    .forEach(([n, lv, main]) => {
      const line = el('div', main ? 'hexa-main' : null);
      line.appendChild(document.createTextNode(n + '　'));
      line.appendChild(el('b', null, 'Lv.' + txt(lv)));
      list.appendChild(line);
    });
  body.appendChild(list);

  card.appendChild(body);
  return card;
}

/**
 * 名稱 -> 圖示。技能端點是唯一的圖示來源，核心本身沒有這個欄位。
 * keys 依序查，先命中的優先。
 */
function skillIconMap(keys) {
  const map = {};
  keys.forEach((k) => {
    const s = d(k);
    if (s && Array.isArray(s.character_skill)) {
      s.character_skill.forEach((sk) => {
        if (sk.skill_name && sk.skill_icon && !map[sk.skill_name]) {
          map[sk.skill_name] = sk.skill_icon;
        }
      });
    }
  });
  return map;
}

function renderVMatrix() {
  const f = frag();
  const vm = d('vmatrix');
  const icons = skillIconMap(['skill5', 'skill4']);

  /** 強化核心叫「強化X」或「強化A/B」，本身不是技能名，要剝前綴再拆斜線 */
  function resolveIcon(name) {
    if (icons[name]) return icons[name];
    const base = name.indexOf('強化') === 0 ? name.slice(2) : name;
    for (const part of base.split('/')) {
      const p = part.trim();
      if (icons[p]) return icons[p];
    }
    return null;
  }

  const cores = ((vm && vm.character_v_core_equipment) || [])
    .filter((c) => c.v_core_name);

  if (cores.length) {
    const groups = {};
    cores.forEach((c) => {
      const t = c.v_core_type || '其他';
      (groups[t] = groups[t] || []).push(c);
    });

    const ORDER = ['技能核心', '強化核心', '共用核心', '特殊核心'];
    Object.keys(groups)
      .sort((a, b) => {
        const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .forEach((t) => {
        f.appendChild(title('V · ' + t + '（' + groups[t].length + '）'));
        const wrap = el('div', 'items');
        groups[t].forEach((c) => {
          const card = el('div', 'item hexa-card');
          const box = el('div', 'item-icon');
          box.appendChild(iconImg(resolveIcon(c.v_core_name), 38));
          card.appendChild(box);

          const body = el('div', 'item-body');
          const head = el('div', 'hexa-head');
          head.appendChild(el('span', 'item-name', txt(c.v_core_name)));
          head.appendChild(el('span', 'hexa-lv', 'Lv.' + txt(c.v_core_level)));
          body.appendChild(head);

          const linked = [c.v_core_skill_1, c.v_core_skill_2, c.v_core_skill_3]
            .filter(Boolean);
          if (linked.length > 1) {
            const row = el('div', 'hexa-linked');
            linked.forEach((n) => {
              const chip = el('span', 'hexa-skill');
              chip.appendChild(iconImg(icons[n], 22));
              chip.appendChild(el('span', null, n));
              row.appendChild(chip);
            });
            body.appendChild(row);
          }
          card.appendChild(body);
          wrap.appendChild(card);
        });
        f.appendChild(wrap);
      });

    const noIcon = cores.filter((c) => !resolveIcon(c.v_core_name)).length;
    if (noIcon) {
      f.appendChild(el('p', 'hint',
        noIcon + ' 個核心在 4 轉與 5 轉技能清單裡都找不到同名技能，沒有圖示可用。'));
    }
  }

  addErrors(f, ['vmatrix', 'skill5', 'skill4']);
  if (!f.childNodes.length) f.appendChild(el('div', 'empty', '沒有 V 矩陣資料'));
  return f;
}

function renderHexa() {
  const f = frag();
  const hexa = d('hexa');
  const hexaStat = d('hexaStat');

  const icons = skillIconMap(['skill6']);

  if (hexa && Array.isArray(hexa.character_hexa_core_equipment)
      && hexa.character_hexa_core_equipment.length) {

    /* 依核心類型分組 */
    const groups = {};
    hexa.character_hexa_core_equipment.forEach((c) => {
      const t = c.hexa_core_type || '其他';
      (groups[t] = groups[t] || []).push(c);
    });

    const ORDER = ['技能核心', '精通核心', '強化核心', '共用核心'];
    const types = Object.keys(groups).sort((a, b) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    types.forEach((t) => {
      f.appendChild(title('HEXA · ' + t));
      const wrap = el('div', 'items');
      groups[t].forEach((c) => wrap.appendChild(hexaCard(c, icons)));
      f.appendChild(wrap);
    });
  }

  if (hexaStat) {
    // 能力值核心共三組，分別在 _core、_core_2、_core_3。三組的 slot_id 都是 0，
    // 所以標題要用組別序號，不能用 slot_id
    const groups = [
      ['character_hexa_stat_core', 'I'],
      ['character_hexa_stat_core_2', 'II'],
      ['character_hexa_stat_core_3', 'III'],
    ];

    const cards = [];
    groups.forEach(([key, label]) => {
      (hexaStat[key] || []).forEach((c) => cards.push(hexaStatCard(c, label)));
    });

    if (cards.length) {
      f.appendChild(title('HEXA 能力值'));
      const wrap = el('div', 'items');
      cards.forEach((c) => wrap.appendChild(c));
      f.appendChild(wrap);
    }

    /* 預設組合本來就一起回傳了，展開來看不會多打 API */
    const presets = [
      ['preset_hexa_stat_core', 'I'],
      ['preset_hexa_stat_core_2', 'II'],
      ['preset_hexa_stat_core_3', 'III'],
    ].filter(([key]) => (hexaStat[key] || []).length);

    if (presets.length) {
      const det = el('details', 'exp-table');
      det.appendChild(el('summary', null, '預設組合'));
      presets.forEach(([key, label]) => {
        const wrap = el('div', 'items');
        (hexaStat[key] || []).forEach((c, i) => {
          wrap.appendChild(hexaStatCard(c, label + '-' + (i + 1)));
        });
        det.appendChild(wrap);
      });
      f.appendChild(det);
    }
  }

  addErrors(f, ['hexa', 'hexaStat', 'skill6']);
  if (!f.childNodes.length) f.appendChild(el('div', 'empty', '沒有 HEXA 資料'));
  return f;
}

/* ---------- 技能 ---------- */

function renderSkills() {
  const f = frag();
  const link = d('linkSkill');

  if (link) {
    const skillCards = (list) => {
      const wrap = el('div', 'items');
      list.forEach((s) => wrap.appendChild(itemCard({
        part: 'Lv.' + txt(s.skill_level),
        name: s.skill_name,
        icon: s.skill_icon,
        lines: [s.skill_effect || s.skill_description].filter(Boolean),
      })));
      return wrap;
    };

    const defs = [];
    const cur = link.character_link_skill;
    if (Array.isArray(cur) && cur.length) {
      defs.push({ label: '目前套用', build: () => skillCards(cur) });
    }
    // 連結技能沒有 preset_no 欄位，無法標出使用中的是哪一組
    presetLabels(3, null).forEach((label, i) => {
      const arr = link['character_link_skill_preset_' + (i + 1)];
      if (Array.isArray(arr) && arr.length) {
        defs.push({ label: label, build: () => skillCards(arr) });
      }
    });

    if (defs.length) {
      f.appendChild(title('連結技能'));
      f.appendChild(presetTabs(defs, 0));
    }

    const owned = link.character_owned_link_skill;
    const ownedList = Array.isArray(owned) ? owned : (owned ? [owned] : []);
    if (ownedList.length) {
      f.appendChild(title('自身連結技能'));
      f.appendChild(skillCards(ownedList));
    }
  }
  addErrors(f, ['linkSkill']);

  f.appendChild(title('技能查詢（點選才會消耗一次 API）'));
  const pick = el('div', 'raw-pick');
  const sel = document.createElement('select');
  sel.appendChild(new Option('選擇技能階段…', ''));
  SKILL_GRADES.forEach((g) => sel.appendChild(new Option(g + ' 轉／階', g)));
  pick.appendChild(sel);
  f.appendChild(pick);

  const out = el('div');
  f.appendChild(out);

  sel.addEventListener('change', async () => {
    const grade = sel.value;
    out.innerHTML = '';
    if (!grade) return;
    out.appendChild(el('div', 'empty', '載入中…'));

    const r = await trySection('character/skill', {
      ocid: OCID, date: QDATE, character_skill_grade: grade,
    });
    out.innerHTML = '';
    if (!r.ok) { out.appendChild(el('div', 'err-line', r.error)); return; }

    const skills = r.data.character_skill || [];
    if (!skills.length) {
      out.appendChild(el('div', 'empty', '這個階段沒有技能資料'));
      return;
    }
    const wrap = el('div', 'items');
    skills.forEach((s) => wrap.appendChild(itemCard({
      part: 'Lv.' + txt(s.skill_level),
      name: s.skill_name,
      icon: s.skill_icon,
      lines: [s.skill_effect || s.skill_description].filter(Boolean),
    })));
    out.appendChild(wrap);
  });
  return f;
}

/* ---------- 原始資料 ---------- */

function renderRaw() {
  const f = frag();

  const bar = el('div', 'raw-pick');
  const sel = document.createElement('select');
  bar.appendChild(sel);

  const fetchAll = el('button', 'ghost', '抓取全部端點（21 次 API）');
  fetchAll.type = 'button';
  fetchAll.style.marginLeft = '8px';
  bar.appendChild(fetchAll);

  const dl = el('button', 'ghost', '下載 JSON');
  dl.type = 'button';
  dl.style.marginLeft = '8px';
  bar.appendChild(dl);

  f.appendChild(bar);
  const pre = el('pre', 'raw');
  f.appendChild(pre);

  function fill() {
    const keep = sel.value;
    sel.innerHTML = '';
    Object.keys(EP).forEach((k) => {
      const s = DATA[k];
      const state = !s ? '（未載入）' : (s.ok ? '' : '  ⚠');
      sel.appendChild(new Option(EP_LABEL[k] + '  ' + EP[k] + state, k));
    });
    if (keep) sel.value = keep;
    show();
  }

  function show() {
    const s = DATA[sel.value];
    pre.textContent = !s ? '（尚未載入 — 切到對應分頁或按「抓取全部端點」）'
      : (s.ok ? JSON.stringify(s.data, null, 2) : '錯誤：' + s.error);
  }

  sel.addEventListener('change', show);

  fetchAll.addEventListener('click', async () => {
    fetchAll.disabled = true;
    fetchAll.textContent = '抓取中…';
    await need(Object.keys(EP));
    fetchAll.textContent = '抓取全部端點（21 次 API）';
    fetchAll.disabled = false;
    fill();
  });

  dl.addEventListener('click', () => {
    const dump = { ocid: OCID, date: QDATE, character_name: $('#nameInput').value };
    Object.keys(EP).forEach((k) => {
      const s = DATA[k];
      dump[EP[k]] = !s ? null : (s.ok ? s.data : { _error: s.error });
    });
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ($('#nameInput').value || 'character') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  fill();
  return f;
}

/* ================================================================== *
 * 經驗追蹤
 * ================================================================== */

/* 歷史快照不會再變動，所以存起來就永久有效，同一天不會重抓 */
const EXP_KEY = 'tms.exp.';

function expLoad(ocid) {
  try {
    return JSON.parse(localStorage.getItem(EXP_KEY + ocid) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function expSave(ocid, store) {
  try {
    localStorage.setItem(EXP_KEY + ocid, JSON.stringify(store));
  } catch (e) { /* 空間不足就算了 */ }
}

/** 從 QDATE 往回數 n 天的日期字串 */
function dateRange(endDate, n) {
  const out = [];
  const base = new Date(endDate + 'T00:00:00Z');
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * 抓某一天的快照。
 * 這裡刻意不用 api() —— 它在失敗時會改成不帶 date 重試，
 * 那會把「最新資料」誤植成某個歷史日期，讓整條曲線失真。
 */
async function expFetchDay(date) {
  const r = await rawCall('character/basic', { ocid: OCID, date: date });
  refreshQuota();
  if (!r.ok || !r.body) return null;
  const b = r.body;
  if (b.character_level === undefined || b.character_level === null) return null;
  return {
    lv: Number(b.character_level),
    exp: Number(b.character_exp),
    rate: parseFloat(b.character_exp_rate),
  };
}

/**
 * 兩個快照之間的成長，換算成「級份」。
 * character_exp 是「本級累積」而非總經驗，跨等級無法直接相減，
 * 但 (等級差 + 百分比差) 在跨級時仍然正確。
 */
function gainInLevels(prev, cur) {
  if (!prev || !cur) return null;
  const dl = cur.lv - prev.lv;
  const dr = (Number.isFinite(cur.rate) ? cur.rate : 0)
           - (Number.isFinite(prev.rate) ? prev.rate : 0);
  return dl + dr / 100;
}

function fmtLevels(v) {
  if (v === null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + ' 級';
}

function renderExp() {
  const f = frag();

  f.appendChild(title('經驗追蹤'));

  const bar = el('div', 'exp-controls');

  const sel = document.createElement('select');
  [[7, '最近 7 天'], [14, '最近 14 天'], [30, '最近 30 天']]
    .forEach(([v, label]) => sel.appendChild(new Option(label, v)));
  bar.appendChild(sel);

  const go = el('button', null, '載入');
  go.type = 'button';
  bar.appendChild(go);

  const cost = el('span', 'exp-cost');
  bar.appendChild(cost);

  f.appendChild(bar);

  const note = el('p', 'hint',
    '每一天各需一次 API，另加一次取「今日」的即時值。'
    + '歷史日期抓過就永久存在瀏覽器，之後重看只會重抓今日那一筆。');
  f.appendChild(note);

  const out = el('div', 'exp-out');
  f.appendChild(out);

  let live = null;      // 「今日」那一列，不帶 date 取得，只留在本次工作階段

  function missingCount() {
    const store = expLoad(OCID);
    const days = dateRange(QDATE || latestDataDate(), Number(sel.value));
    return days.filter((d) => store[d] === undefined).length + (live ? 0 : 1);
  }

  function syncCost() {
    const m = missingCount();
    cost.textContent = m ? ('需 ' + m + ' 次 API') : '已全部快取，免費';
    cost.className = 'exp-cost' + (m ? '' : ' free');
  }

  sel.addEventListener('change', () => { syncCost(); draw(); });
  syncCost();

  go.addEventListener('click', async () => {
    go.disabled = true;
    const days = dateRange(QDATE || latestDataDate(), Number(sel.value));
    const store = expLoad(OCID);

    const todo = days.filter((d) => store[d] === undefined);
    let done = 0;
    const total = todo.length + 1;
    for (const day of todo) {
      go.textContent = '載入中 ' + (++done) + '/' + total;
      const snap = await expFetchDay(day);
      store[day] = snap;          // null 也存，代表那天查不到，不用再試
      expSave(OCID, store);
    }

    // 最後抓「今日」——不帶 date，拿的是當下狀態
    go.textContent = '載入中 ' + (++done) + '/' + total;
    live = await expFetchDay('');

    go.textContent = '載入';
    go.disabled = false;
    syncCost();
    draw();
  });

  function draw() {
    out.innerHTML = '';
    const store = expLoad(OCID);
    const days = dateRange(QDATE || latestDataDate(), Number(sel.value));
    const known = days.filter((d) => store[d]);

    if (known.length < 2) {
      out.appendChild(el('div', 'empty',
        known.length ? '至少要兩天的資料才能算出成長，請按「載入」。'
                     : '尚未載入資料，按「載入」開始。'));
      return;
    }

    /* 由舊到新排成一串，最後接上「今日」的即時值 */
    const seq = known.map((d) => ({ date: d, snap: store[d], live: false }));
    if (live) seq.push({ date: null, snap: live, live: true });

    const rows = seq.map((e, i) => {
      const prev = i > 0 ? seq[i - 1].snap : null;
      return {
        label: e.live ? '今日' : daysAgoLabel(e.date),
        date: e.date,
        live: e.live,
        snap: e.snap,
        gain: prev ? gainInLevels(prev, e.snap) : null,
        leveled: prev ? (e.snap.lv - prev.lv) : 0,
        expDelta: (prev && prev.lv === e.snap.lv) ? (e.snap.exp - prev.exp) : null,
      };
    });

    /* 清單：新的在上 */
    out.appendChild(expListView(rows.slice().reverse()));

    /* 圖表沿用同一份逐日成長（去掉最舊那列，它沒有增量） */
    const points = rows.filter((r) => r.gain !== null).map((r) => ({
      date: r.live ? '今日' : r.date.slice(5),
      gain: r.gain,
      lv: r.snap.lv,
      leveled: r.leveled,
      expDelta: r.expDelta,
    }));

    if (points.length) {
      out.appendChild(el('div', 'section-title', '每日成長'));
      out.appendChild(expChart(points));
      out.appendChild(expTable(points));
    }
  }

  draw();
  return f;
}

/** 依日期算出「N日前」；今天的日期則回「今日」 */
function daysAgoLabel(dateStr) {
  const tw = new Date(Date.now() + 8 * 3600 * 1000);
  const today = tw.toISOString().slice(0, 10);
  const diff = Math.round(
    (Date.parse(today + 'T00:00:00Z') - Date.parse(dateStr + 'T00:00:00Z')) / 86400000);
  if (diff <= 0) return '今日';
  return diff + '日前';
}

/* ---------- 逐日清單 ---------- */

function expListView(rows) {
  const box = el('div', 'explist');

  rows.forEach((r) => {
    const row = el('div', 'explist-row' + (r.live ? ' live' : ''));

    row.appendChild(el('span', 'el-label', r.label));

    const lv = el('span', 'el-lv');
    lv.appendChild(el('b', null, 'Lv.' + r.snap.lv));
    const rate = Number.isFinite(r.snap.rate) ? r.snap.rate : 0;
    lv.appendChild(el('span', 'el-pct', '(' + rate.toFixed(2) + '%)'));
    row.appendChild(lv);

    const g = el('span', 'el-gain');
    if (r.gain !== null && Number.isFinite(r.gain)) {
      const v = r.gain * 100;
      g.appendChild(el('span', 'el-gainval' + (Math.abs(v) < 0.005 ? ' zero' : ''),
        '[' + (v >= 0 ? '+' : '') + v.toFixed(2) + '%]'));
      if (r.leveled > 0) {
        g.appendChild(el('span', 'el-lvup', '▲' + (r.leveled > 1 ? r.leveled : '')));
      }
    }
    row.appendChild(g);

    if (!r.live && r.date) row.title = r.date;
    box.appendChild(row);
  });

  return box;
}

/* ---------- 長條圖 ---------- */

const SERIES = '#cf7418';   // 通過 dataviz 六項檢查（深色底 #1c2130）

function expChart(points) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 760, H = 260;
  const padL = 52, padR = 14, padT = 16, padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const wrap = el('div', 'chart-wrap');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '每日經驗成長長條圖，單位為級份');

  const vals = points.map((p) => (Number.isFinite(p.gain) ? p.gain : 0));
  const hi = Math.max(0, Math.max.apply(null, vals));
  const lo = Math.min(0, Math.min.apply(null, vals));
  const span = (hi - lo) || 1;
  const y = (v) => padT + plotH * (1 - (v - lo) / span);
  const zeroY = y(0);

  function mk(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach((k) => n.setAttribute(k, attrs[k]));
    return n;
  }

  /* 格線 —— 保持退居背景 */
  [hi, (hi + lo) / 2, lo].forEach((v) => {
    if (!Number.isFinite(v)) return;
    svg.appendChild(mk('line', {
      x1: padL, x2: W - padR, y1: y(v), y2: y(v),
      class: (Math.abs(v) < 1e-9 ? 'grid zero' : 'grid'),
    }));
    const t = mk('text', { x: padL - 9, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' });
    t.textContent = v.toFixed(2);
    svg.appendChild(t);
  });

  const slot = plotW / points.length;
  // 相鄰長條之間留 2px 底色間隙；上限 44px，天數少時才不會變成粗胖的色塊
  const barW = Math.min(44, Math.max(3, slot - 2));
  const labelEvery = Math.ceil(points.length / 7);
  const bestIdx = vals.indexOf(Math.max.apply(null, vals));

  points.forEach((p, i) => {
    const v = Number.isFinite(p.gain) ? p.gain : 0;
    const x = padL + i * slot + (slot - barW) / 2;
    const top = Math.min(y(v), zeroY);
    const h = Math.abs(y(v) - zeroY);
    const r = Math.min(4, barW / 2, h);        // 只有離基線的那一端做圓角

    if (h > 0.4) {
      const up = v >= 0;
      const d = up
        ? ['M', x, zeroY, 'V', top + r, 'Q', x, top, x + r, top,
           'H', x + barW - r, 'Q', x + barW, top, x + barW, top + r,
           'V', zeroY, 'Z'].join(' ')
        : ['M', x, zeroY, 'V', top + h - r, 'Q', x, top + h, x + r, top + h,
           'H', x + barW - r, 'Q', x + barW, top + h, x + barW, top + h - r,
           'V', zeroY, 'Z'].join(' ');
      svg.appendChild(mk('path', { d: d, class: 'bar' }));
    }

    /* 升級當天標記 —— 用符號而非顏色，避免只靠顏色傳達資訊 */
    if (p.leveled > 0) {
      const up = mk('text', {
        x: x + barW / 2, y: Math.min(y(v), zeroY) - 6,
        class: 'lvup', 'text-anchor': 'middle',
      });
      up.textContent = '▲';
      svg.appendChild(up);
    }

    /* 直接標示只給最佳單日，不是每根都標 */
    if (i === bestIdx && v > 0) {
      const lab = mk('text', {
        x: x + barW / 2, y: y(v) - (p.leveled > 0 ? 18 : 6),
        class: 'barlabel', 'text-anchor': 'middle',
      });
      lab.textContent = v.toFixed(2);
      svg.appendChild(lab);
    }

    if (i % labelEvery === 0 || i === points.length - 1) {
      const t = mk('text', {
        x: x + barW / 2, y: H - padB + 18, class: 'axis', 'text-anchor': 'middle',
      });
      t.textContent = p.date.slice(5);
      svg.appendChild(t);
    }

    /* 命中區比長條本身寬，整欄都可觸發 */
    const hit = mk('rect', {
      x: padL + i * slot, y: padT, width: slot, height: plotH, class: 'hit',
    });
    hit.addEventListener('mouseenter', () => showTip(p, hit));
    hit.addEventListener('mouseleave', hideTip);
    svg.appendChild(hit);
  });

  wrap.appendChild(svg);

  const tip = el('div', 'charttip');
  tip.hidden = true;
  wrap.appendChild(tip);

  function showTip(p, node) {
    tip.innerHTML = '';
    tip.appendChild(el('div', 'tt-date', p.date));
    tip.appendChild(el('div', 'tt-main', fmtLevels(p.gain)));
    const sub = ['Lv.' + p.lv];
    if (p.leveled > 0) sub.push('升 ' + p.leveled + ' 級');
    if (p.expDelta !== null) sub.push('EXP ' + (p.expDelta >= 0 ? '+' : '') + num(p.expDelta));
    tip.appendChild(el('div', 'tt-sub', sub.join('　')));

    const box = node.getBoundingClientRect();
    const host = wrap.getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = Math.max(4, Math.min(
      box.left - host.left + box.width / 2 - tip.offsetWidth / 2,
      host.width - tip.offsetWidth - 4)) + 'px';
    tip.style.top = '6px';
  }
  function hideTip() { tip.hidden = true; }

  return wrap;
}

/* ---------- 表格檢視（圖表的等價替代） ---------- */

function expTable(points) {
  const wrap = el('details', 'exp-table');
  const sum = el('summary', null, '表格檢視');
  wrap.appendChild(sum);

  const tw = el('div', 'tablewrap');
  const table = el('table', 'rank');
  const thead = el('thead');
  const htr = el('tr');
  ['日期', '成長（級份）', '等級', '升級', 'EXP 增減'].forEach((h) => {
    htr.appendChild(el('th', null, h));
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tb = el('tbody');
  points.slice().reverse().forEach((p) => {
    const tr = el('tr');
    tr.appendChild(el('td', null, p.date));
    tr.appendChild(el('td', null, fmtLevels(p.gain)));
    tr.appendChild(el('td', null, 'Lv.' + p.lv));
    tr.appendChild(el('td', null, p.leveled > 0 ? '+' + p.leveled : '—'));
    tr.appendChild(el('td', null,
      p.expDelta === null ? '（跨等級）'
                          : (p.expDelta >= 0 ? '+' : '') + num(p.expDelta)));
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  tw.appendChild(table);
  wrap.appendChild(tw);
  return wrap;
}

/* ================================================================== *
 * 裝備比對
 * ================================================================== */

const CMP_DATA = {};        // name -> 已抓好的資料，只存活於本次工作階段

/* 加總用的欄位；順序即顯示順序 */
const CMP_SUM_FIELDS = [
  ['str', 'STR'], ['dex', 'DEX'], ['int', 'INT'], ['luk', 'LUK'],
  ['attack_power', '攻擊力'], ['magic_power', '魔力'],
  ['max_hp', '最大HP'], ['max_mp', '最大MP'], ['armor', '防禦力'],
  ['boss_damage', 'BOSS傷害%'], ['ignore_monster_armor', '無視防禦%'],
  ['all_stat', '全屬性%'], ['damage', '傷害%'],
];

/** 一位角色需 4 次 API：id、basic、stat、item-equipment */
async function cmpFetch(name) {
  const id = await api('id', { character_name: name });
  const ocid = id.ocid;

  const [basic, stat, equip] = await Promise.all([
    trySection('character/basic', { ocid: ocid }),
    trySection('character/stat', { ocid: ocid }),
    trySection('character/item-equipment', { ocid: ocid }),
  ]);

  const b = basic.ok ? basic.data : {};
  const s = stat.ok ? stat.data : {};
  const eq = equip.ok ? equip.data : {};

  /* 保留所有裝備頁，讓比對時可以切換 —— 有些角色目前穿戴的不是最強的那套。
     注意「目前穿戴」含圖騰、拼圖等不受預設組管理的欄位，件數會比預設組多。 */
  const sets = [];
  if (Array.isArray(eq.item_equipment) && eq.item_equipment.length) {
    sets.push({ key: 'cur', label: '目前穿戴', items: eq.item_equipment });
  }
  for (let i = 1; i <= 3; i++) {
    const arr = eq['item_equipment_preset_' + i];
    if (Array.isArray(arr) && arr.length) {
      sets.push({
        key: 'p' + i,
        label: '預設 ' + i + (n0(eq.preset_no) === i ? '（使用中）' : ''),
        items: arr,
      });
    }
  }

  /* final_stat 有四十幾項，全部留著 —— 這是解釋戰鬥力差距的關鍵，
     而且資料已經抓回來了，不留等於白丟。 */
  const stats = {};
  const statOrder = [];
  (s.final_stat || []).forEach((row) => {
    if (!row.stat_name) return;
    const v = parseFloat(row.stat_value);
    stats[row.stat_name] = Number.isFinite(v) ? v : null;
    statOrder.push(row.stat_name);
  });
  const power = stats['戰鬥力'] !== undefined ? stats['戰鬥力'] : null;

  return {
    name: b.character_name || name,
    world: b.world_name || '',
    cls: b.character_class || '',
    level: Number(b.character_level) || 0,
    image: b.character_image || '',
    power: power,
    stats: stats,
    statOrder: statOrder,
    sets: sets,
  };
}

/**
 * 從一組裝備算出比對要用的所有衍生數值。
 * 抽出來是為了讓切換裝備頁時能重算，不必重打 API。
 */
function cmpDerive(items) {
  const list = items || [];
  const bySlot = {};
  list.forEach((it) => { bySlot[it.item_equipment_slot] = it; });

  const totals = {};
  const potTotals = {};        // 「名稱|單位」-> 全身潛能加總
  const etcTotals = {};        // 卷軸貢獻（item_etc_option）加總
  let starTotal = 0;
  let scrollTotal = 0;         // 卷軸總次數
  let potUnparsedTotal = 0;

  list.forEach((it) => {
    const t = it.item_total_option || {};
    CMP_SUM_FIELDS.forEach(([k]) => { totals[k] = (totals[k] || 0) + n0(t[k]); });
    starTotal += n0(it.starforce);

    /* item_etc_option 就是卷軸那一段，除以卷數即平均每卷幾攻 */
    const sc = n0(it.scroll_upgrade);
    if (sc > 0) {
      scrollTotal += sc;
      const etc = it.item_etc_option || {};
      CMP_SUM_FIELDS.forEach(([k]) => { etcTotals[k] = (etcTotals[k] || 0) + n0(etc[k]); });
    }

    const ps = potSummary(it);
    Object.keys(ps).forEach((k) => { potTotals[k] = (potTotals[k] || 0) + ps[k]; });
    potUnparsedTotal += potUnparsed(it);
  });

  return {
    bySlot: bySlot,
    totals: totals,
    potTotals: potTotals,
    potUnparsedTotal: potUnparsedTotal,
    etcTotals: etcTotals,
    starTotal: starTotal,
    scrollTotal: scrollTotal,
    count: list.length,
  };
}

/** 取某一方目前選定的裝備頁，並把衍生數值併進來 */
function cmpSide(name, whichSel) {
  const raw = CMP_DATA[name];
  if (!raw) return null;
  const sets = raw.sets || [];
  if (!sets.length) return null;

  const want = whichSel ? whichSel.value : '';
  const set = sets.filter((s) => s.key === want)[0] || sets[0];
  return Object.assign({}, raw, cmpDerive(set.items), { setLabel: set.label });
}

/** 平均每卷幾攻：卷軸貢獻的攻擊值 ÷ 卷軸次數 */
function scrollAvg(side, atkKey) {
  if (!side.scrollTotal) return null;
  return n0(side.etcTotals[atkKey]) / side.scrollTotal;
}

/* 同類多格的欄位。這些槽位編號是任意的 —— 你最強的戒指可能在 3 號位、
   對方最強的在 1 號位，按編號配對比出來沒有意義，所以預設改成依數值排序後配對。 */
const CMP_GROUPS = [
  ['戒指', /^戒指\d+$/],
  ['墜飾', /^墜飾\d*$/],
  ['圖騰', /^圖騰\d*$/],
  ['拼圖', /^拼圖\d*$/],
];

/** 排序鍵：主屬性優先，同分再看主攻擊。兩者都是可直接比大小的數字。 */
function cmpItemScore(it, prof) {
  if (!it) return -1;
  const t = it.item_total_option || {};
  return n0(t[prof.mainKey]) * 1000 + n0(t[prof.atkKey]);
}

/**
 * 產生比對列。
 * mode='value'：同類多格先各自依數值排序，再一對一配（最強對最強）。
 * mode='slot' ：完全照欄位名稱配。
 */
function cmpPairs(a, b, prof, mode) {
  const rows = [];
  const taken = new Set();

  /* 同一件裝備對比：跨欄位以道具名稱配對。
     同名可能不只一件（實測有角色帶兩條同名墜飾），所以要處理一對多。 */
  if (mode === 'name') {
    const byName = (side) => {
      const m = {};
      Object.keys(side.bySlot).forEach((s) => {
        const it = side.bySlot[s];
        const k = it.item_name || '（未命名）';
        (m[k] = m[k] || []).push(it);
      });
      return m;
    };
    const ma = byName(a), mb = byName(b);
    const desc = (x, y) => cmpItemScore(y, prof) - cmpItemScore(x, prof);

    // 兩邊的欄位名會重複（都有「帽子」），所以各自記各自的
    const doneA = new Set(), doneB = new Set();

    Object.keys(ma).filter((k) => mb[k]).sort().forEach((name) => {
      const la = ma[name].slice().sort(desc);
      const lb = mb[name].slice().sort(desc);
      const n = Math.max(la.length, lb.length);
      for (let i = 0; i < n; i++) {
        const ia = la[i] || null, ib = lb[i] || null;
        if (ia) doneA.add(ia.item_equipment_slot);
        if (ib) doneB.add(ib.item_equipment_slot);
        const slots = [];
        if (ia) slots.push('我：' + ia.item_equipment_slot);
        if (ib) slots.push('對方：' + ib.item_equipment_slot);
        rows.push({
          label: name + (n > 1 ? ' #' + (i + 1) : ''),
          note: slots.join('　'),
          ia: ia,
          ib: ib,
        });
      }
    });

    /* 配不到同名的，先試著用欄位配 —— 同一格穿不同東西仍然可以比，
       標成「僅一方持有」會讓人誤以為沒偵測到裝備。 */
    const restA = Object.keys(a.bySlot).filter((s) => !doneA.has(s));
    const restB = Object.keys(b.bySlot).filter((s) => !doneB.has(s));

    restA.sort().forEach((s) => {
      if (!doneB.has(s) && b.bySlot[s]) {
        doneA.add(s); doneB.add(s);
        rows.push({
          label: s,
          note: '同欄位，不同道具',
          ia: a.bySlot[s],
          ib: b.bySlot[s],
        });
      }
    });

    /* 同類多格（戒指、墜飾…）：名稱配對可能把欄位號錯開，
       例如同名的配走了對方的「墜飾」，剩下自己的「墜飾」對上對方的「墜飾2」。
       它們同屬一類，仍然該配在一起，所以再用類別掃一次。 */
    CMP_GROUPS.forEach(([, re]) => {
      const leftA = Object.keys(a.bySlot).filter((s) => re.test(s) && !doneA.has(s));
      const leftB = Object.keys(b.bySlot).filter((s) => re.test(s) && !doneB.has(s));
      if (!leftA.length || !leftB.length) return;

      // 各自依數值由高到低排，強的對強的
      leftA.sort((x, y) => cmpItemScore(a.bySlot[y], prof) - cmpItemScore(a.bySlot[x], prof));
      leftB.sort((x, y) => cmpItemScore(b.bySlot[y], prof) - cmpItemScore(b.bySlot[x], prof));

      const n = Math.min(leftA.length, leftB.length);
      for (let i = 0; i < n; i++) {
        doneA.add(leftA[i]);
        doneB.add(leftB[i]);
        rows.push({
          label: leftA[i] + ' ↔ ' + leftB[i],
          note: '同類別，依數值配對',
          ia: a.bySlot[leftA[i]],
          ib: b.bySlot[leftB[i]],
        });
      }
    });

    /* 到這裡還配不到的，才是真的只有一方有這個欄位 */
    [[a, doneA, 'ia', '我'], [b, doneB, 'ib', '對方']]
      .forEach(([side, done, key, who]) => {
        Object.keys(side.bySlot).sort().forEach((s) => {
          if (done.has(s)) return;
          done.add(s);
          const it = side.bySlot[s];
          if (!it) return;
          const row = { label: s,
                        note: who + '才有這個欄位',
                        ia: null, ib: null };
          row[key] = it;
          rows.push(row);
        });
      });

    return rows;
  }

  if (mode === 'value') {
    CMP_GROUPS.forEach(([label, re]) => {
      const pick = (side) => Object.keys(side.bySlot)
        .filter((s) => re.test(s))
        .map((s) => side.bySlot[s]);

      const la = pick(a), lb = pick(b);
      if (!la.length && !lb.length) return;

      Object.keys(a.bySlot).forEach((s) => { if (re.test(s)) taken.add(s); });
      Object.keys(b.bySlot).forEach((s) => { if (re.test(s)) taken.add(s); });

      /* 組內先配同名的 —— 同一件裝備對決才看得出差在星力還是選項。
         同名可能不只一件，所以配掉的要記起來避免重複使用。 */
      const usedA = new Set(), usedB = new Set();
      const pairs = [];
      la.forEach((ia, i) => {
        for (let k = 0; k < lb.length; k++) {
          if (usedB.has(k)) continue;
          if (lb[k].item_name !== ia.item_name) continue;
          usedA.add(i); usedB.add(k);
          pairs.push({ ia: ia, ib: lb[k], byName: true });
          return;
        }
      });

      /* 配不到同名的，才退而依數值排序一對一 */
      const desc = (x, y) => cmpItemScore(y, prof) - cmpItemScore(x, prof);
      const restA = la.filter((_, i) => !usedA.has(i)).sort(desc);
      const restB = lb.filter((_, k) => !usedB.has(k)).sort(desc);
      const rest = Math.max(restA.length, restB.length);
      for (let i = 0; i < rest; i++) {
        pairs.push({ ia: restA[i] || null, ib: restB[i] || null, byName: false });
      }

      pairs.forEach((p, i) => rows.push({
        label: label + ' #' + (i + 1),
        note: p.byName ? '同名配對' : '無同名，依數值配對',
        ia: p.ia,
        ib: p.ib,
      }));
    });
  }

  cmpSlotOrder(a, b).forEach((slot) => {
    if (taken.has(slot)) return;
    const ia = a.bySlot[slot], ib = b.bySlot[slot];
    if (!ia && !ib) return;
    rows.push({ label: slot, ia: ia || null, ib: ib || null });
  });

  return rows;
}

/** 兩邊欄位聯集，依裝備欄版面的順序排 */
function cmpSlotOrder(a, b) {
  const seen = new Set();
  const out = [];
  EQUIP_GRID.forEach((row) => row.forEach((s) => {
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }));

  const rest = [];
  [a, b].forEach((side) => Object.keys(side.bySlot).forEach((s) => {
    if (!seen.has(s)) { seen.add(s); rest.push(s); }
  }));
  // 圖騰1/拼圖10 之類要照數字排，不能用字串排
  rest.sort((x, y) => {
    const bx = x.replace(/\d+$/, ''), by = y.replace(/\d+$/, '');
    if (bx !== by) return bx.localeCompare(by, 'zh-Hant');
    return n0(x.replace(/\D/g, '')) - n0(y.replace(/\D/g, ''));
  });
  return out.concat(rest);
}

/**
 * 判定這隻角色吃哪些數值：四維取最大的當主屬性，攻擊力/魔力取大的那個。
 * 實測兩隻角色都判對（陰陽師與夜光皆為 INT / 魔力）。
 */
function cmpProfile(side) {
  const KEYS = [['INT', 'int'], ['LUK', 'luk'], ['STR', 'str'], ['DEX', 'dex']];
  let mainKey = 'str', mainLabel = 'STR', best = -1;
  KEYS.forEach(([label, key]) => {
    const v = side.stats[label];
    if (v !== null && v !== undefined && v > best) {
      best = v; mainKey = key; mainLabel = label;
    }
  });
  const magic = n0(side.stats['魔法攻擊力']) > n0(side.stats['攻擊力']);
  return {
    mainKey: mainKey,
    mainLabel: mainLabel,
    atkKey: magic ? 'magic_power' : 'attack_power',
    atkLabel: magic ? '魔攻' : '物攻',
  };
}

/* 潛能詞條解析。
   API 只給文字，格式實測為「<名稱> <+/-><數字><單位?>」，
   單位是 %、秒 或無。83 種實際詞條裡 82 種吃得下，
   唯一的例外是「可以使用<某技能>」那種給技能的，本來就沒有數值可比。 */
const POT_LINE = /^(.+?)\s*([+-])\s*(\d+(?:\.\d+)?)\s*(%|秒)?$/;

function parsePotLine(text) {
  if (!text) return null;
  const m = POT_LINE.exec(String(text).trim());
  if (!m) return null;
  const v = parseFloat(m[3]);
  if (!Number.isFinite(v)) return null;
  return {
    stat: m[1].trim(),
    unit: m[4] || '',
    value: (m[2] === '-' ? -v : v),
  };
}

/**
 * 一件裝備的潛能總和，key 是「名稱|單位」。
 * 百分比與固定值分開計，因為那是不同的量，加在一起沒有意義。
 */
function potSummary(it) {
  const out = {};
  if (!it) return out;
  ['potential_option_', 'additional_potential_option_'].forEach((pre) => {
    for (let i = 1; i <= 3; i++) {
      const p = parsePotLine(it[pre + i]);
      if (!p) continue;
      const key = p.stat + '|' + p.unit;
      out[key] = (out[key] || 0) + p.value;
    }
  });
  return out;
}

/** 有幾條潛能是解析不了的（顯示用，避免讓人以為全都算進去了） */
function potUnparsed(it) {
  let n = 0;
  if (!it) return 0;
  ['potential_option_', 'additional_potential_option_'].forEach((pre) => {
    for (let i = 1; i <= 3; i++) {
      const t = it[pre + i];
      if (t && !parsePotLine(t)) n++;
    }
  });
  return n;
}

/**
 * 換裝評估：把對方那件裝到「我」身上，各項數值是正還是負。
 *
 * 只比 item_total_option 裡的數值。潛能與附加潛能在 API 裡是純文字
 * （像 "INT +10%"），沒有對應的數值欄位 —— 實測 total 恰好等於
 * 基礎+追加+卷軸+星力 四段和，證明潛能不在其中。所以這個評估
 * 【不包含潛能】，而潛能對高階裝往往才是大頭。
 */
function cmpSwap(mine, theirs, prof) {
  const val = (it, key) => (it ? n0((it.item_total_option || {})[key]) : 0);

  /* 裝備本身的數值（基礎＋追加＋卷軸＋星力） */
  const base = [
    [prof.mainLabel, val(theirs, prof.mainKey) - val(mine, prof.mainKey), '', false],
    [prof.atkLabel, val(theirs, prof.atkKey) - val(mine, prof.atkKey), '', false],
    ['BOSS', val(theirs, 'boss_damage') - val(mine, 'boss_damage'), '%', false],
    ['無視', val(theirs, 'ignore_monster_armor')
             - val(mine, 'ignore_monster_armor'), '%', false],
    ['全屬', val(theirs, 'all_stat') - val(mine, 'all_stat'), '%', false],
    ['★', n0(theirs && theirs.starforce) - n0(mine && mine.starforce), '', false],
  ];

  /* 潛能與附加潛能，依「名稱|單位」比對；% 與固定值分開 */
  const pa = potSummary(mine), pb = potSummary(theirs);
  const keys = Object.keys(pa).concat(Object.keys(pb))
    .filter((k, i, arr) => arr.indexOf(k) === i);
  const pots = keys.map((k) => {
    const [stat, unit] = k.split('|');
    return [stat, n0(pb[k]) - n0(pa[k]), unit, true];
  });

  const metrics = base.concat(pots).filter(([, d]) => d !== 0);

  let verdict = 'same';
  if (metrics.length) {
    const ups = metrics.filter(([, d]) => d > 0).length;
    const downs = metrics.filter(([, d]) => d < 0).length;
    verdict = (ups && downs) ? 'mixed' : (ups ? 'up' : 'down');
  }
  return {
    metrics: metrics,
    verdict: verdict,
    unparsed: potUnparsed(mine) + potUnparsed(theirs),
  };
}

const CMP_VERDICT = {
  up:    ['升級', 'up'],
  down:  ['降級', 'down'],
  mixed: ['互有優劣', 'mixed'],
  same:  ['數值相同', 'same'],
};

/** 一方的裝備格內容（圖示、名稱、星力、潛能） */
/**
 * 比對表的一格。lab 會寫進 data-lab —— 手機版把表格拆成直式卡片後
 * 表頭就看不到了，靠這個標籤才知道這格是誰的裝備。
 */
function cmpItemCell(it, prof, lab) {
  const td = el('td');
  if (lab) td.dataset.lab = lab;
  if (!it) {
    td.appendChild(el('span', 'cmp-none', '未裝備'));
    return td;
  }
  const box = el('div', 'cmp-item');
  box.appendChild(iconImg(it.item_icon, 26, String(it.item_name || '?').slice(0, 2)));

  const info = el('div', 'cmp-item-info');
  info.appendChild(el('div', 'cmp-item-name', txt(it.item_name)));

  const tags = el('div', 'cmp-item-tags');
  const sf = n0(it.starforce);
  if (sf > 0) tags.appendChild(el('span', 'cmp-star', '★' + sf));
  if (it.potential_option_grade) {
    tags.appendChild(el('span', 'pot ' + (POT_CLASS[it.potential_option_grade] || ''),
      it.potential_option_grade));
  }
  const sc = n0(it.scroll_upgrade);
  if (sc > 0) {
    let label = '卷' + it.scroll_upgrade;
    if (prof) {
      // 這件裝備自己的每卷效率
      const gain = n0((it.item_etc_option || {})[prof.atkKey]);
      if (gain) label += '（' + (Math.round(gain / sc * 10) / 10) + '/卷）';
    }
    tags.appendChild(el('span', 'cmp-scroll', label));
  }
  info.appendChild(tags);

  /* 潛能無法計入換裝評估（API 只給文字），所以列出來讓人自己判斷 */
  [[it.potential_option_1, it.potential_option_2, it.potential_option_3],
   [it.additional_potential_option_1, it.additional_potential_option_2,
    it.additional_potential_option_3]].forEach((lines, i) => {
    const real = lines.filter(Boolean);
    if (!real.length) return;
    const p = el('div', 'cmp-pot' + (i ? ' add' : ''));
    p.textContent = (i ? '附' : '潛') + '　' + real.join('、');
    info.appendChild(p);
  });

  box.appendChild(info);
  box.style.cursor = 'pointer';
  box.title = '點擊看完整詳情';
  box.addEventListener('click', () => showItemTip(it));
  td.appendChild(box);
  return td;
}

/** 差異數字：正數綠、負數紅、相同灰 */
function cmpDelta(va, vb, suffix) {
  const d = n0(va) - n0(vb);
  const span = el('span', 'cmp-delta ' + (d > 0 ? 'up' : (d < 0 ? 'down' : 'same')));
  span.textContent = (d > 0 ? '+' : '') + num(d) + (suffix || '');
  return span;
}

function cmpRender() {
  const out = $('#cmpResult');
  out.innerHTML = '';

  const nameA = $('#cmpA').value.trim();
  const nameB = $('#cmpB').value.trim();
  const a = cmpSide(nameA, $('#cmpSetA'));
  const b = cmpSide(nameB, $('#cmpSetB'));
  if (!a || !b) return;

  /* 「目前穿戴」含圖騰、拼圖等不受預設組管理的欄位，件數會比預設組多。
     兩邊挑到件數差很多的組合時，總和類的比較就不對等，要講清楚。 */
  if (Math.abs(a.count - b.count) >= 5) {
    const warn = el('div', 'cmp-warn');
    warn.appendChild(el('b', null, '兩邊裝備件數差距大'));
    warn.appendChild(el('div', null,
      a.name + '「' + a.setLabel + '」' + a.count + ' 件　vs　'
      + b.name + '「' + b.setLabel + '」' + b.count + ' 件。'));
    warn.appendChild(el('div', null,
      '「目前穿戴」包含圖騰、拼圖、寶石等不受預設組管理的欄位，'
      + '拿它跟預設組相比，總和類的數字不對等。逐格比對仍然有意義。'));
    out.appendChild(warn);
  }

  /* ---- 兩位角色的摘要 ---- */
  const head = el('div', 'cmp-heads');
  [a, b].forEach((side) => {
    const card = el('div', 'cmp-head');
    const box = el('div', 'hero-img');
    attachIcon(box, side.image, '🍁');
    card.appendChild(box);
    const info = el('div');
    info.appendChild(el('div', 'cmp-head-name', side.name));
    info.appendChild(el('div', 'cmp-head-sub',
      [side.world, side.cls, 'Lv.' + side.level].filter(Boolean).join(' · ')));
    info.appendChild(el('div', 'cmp-head-power',
      side.power === null ? '戰鬥力 —' : '戰鬥力 ' + num(side.power)));
    info.appendChild(el('div', 'cmp-head-sub',
      side.count + ' 件裝備　星力合計 ' + num(side.starTotal)));
    card.appendChild(info);
    head.appendChild(card);
  });
  out.appendChild(head);

  /* ---- 戰鬥力差距 ---- */
  if (a.power !== null && b.power !== null) {
    const hi = a.power >= b.power ? a : b;
    const lo = a.power >= b.power ? b : a;
    const diff = hi.power - lo.power;
    const ratio = lo.power > 0 ? (hi.power / lo.power) : null;

    const box = el('div', 'pwr');
    const l = el('div', 'pwr-side');
    l.appendChild(el('div', 'pwr-name', a.name));
    l.appendChild(el('div', 'pwr-val' + (a.power >= b.power ? ' win' : ''), num(a.power)));
    box.appendChild(l);

    const mid = el('div', 'pwr-mid');
    mid.appendChild(el('div', 'pwr-label', '戰鬥力差距'));
    mid.appendChild(el('div', 'pwr-diff', num(diff)));
    const note = [hi.name + ' 較高'];
    if (ratio !== null) note.push(ratio.toFixed(2) + ' 倍');
    mid.appendChild(el('div', 'pwr-note', note.join('　·　')));
    box.appendChild(mid);

    const r = el('div', 'pwr-side');
    r.appendChild(el('div', 'pwr-name', b.name));
    r.appendChild(el('div', 'pwr-val' + (b.power > a.power ? ' win' : ''), num(b.power)));
    box.appendChild(r);

    out.appendChild(box);
  }

  /* ---- 完整能力值對照：解釋差距從哪來 ---- */
  const statNames = a.statOrder.slice();
  b.statOrder.forEach((n) => { if (statNames.indexOf(n) === -1) statNames.push(n); });

  const statRows = statNames.filter((n) => {
    if (n === '戰鬥力') return false;             // 已經在上面單獨呈現
    const va = a.stats[n], vb = b.stats[n];
    return !((va === null || va === undefined || va === 0)
          && (vb === null || vb === undefined || vb === 0));
  });

  if (statRows.length) {
    out.appendChild(title('能力值對照（' + statRows.length + ' 項）'));
    const sw = el('div', 'tablewrap');
    const stt = el('table', 'rank');
    const sh0 = el('tr');
    ['能力值', a.name, b.name, 'A − B'].forEach((h) => sh0.appendChild(el('th', null, h)));
    const th0 = el('thead'); th0.appendChild(sh0); stt.appendChild(th0);

    const tb0 = el('tbody');
    statRows.forEach((n) => {
      const va = a.stats[n], vb = b.stats[n];
      const tr = el('tr');
      tr.appendChild(el('td', 'rank-name', n));
      tr.appendChild(el('td', null, (va === null || va === undefined) ? '—' : num(va)));
      tr.appendChild(el('td', null, (vb === null || vb === undefined) ? '—' : num(vb)));
      const td = el('td');
      td.appendChild(cmpDelta(va, vb));
      tr.appendChild(td);
      tb0.appendChild(tr);
    });
    stt.appendChild(tb0);
    sw.appendChild(stt);
    out.appendChild(sw);
  }

  /* ---- 數值總和比較 ---- */
  out.appendChild(title('裝備數值總和'));
  const sumWrap = el('div', 'tablewrap');
  const sumTable = el('table', 'rank');
  const sh = el('tr');
  ['項目', a.name, b.name, 'A − B'].forEach((h) => sh.appendChild(el('th', null, h)));
  const sthead = el('thead'); sthead.appendChild(sh); sumTable.appendChild(sthead);

  const stb = el('tbody');
  const starRow = el('tr');
  starRow.appendChild(el('td', null, '星力合計'));
  starRow.appendChild(el('td', null, num(a.starTotal)));
  starRow.appendChild(el('td', null, num(b.starTotal)));
  const sd = el('td'); sd.appendChild(cmpDelta(a.starTotal, b.starTotal));
  starRow.appendChild(sd);
  stb.appendChild(starRow);

  CMP_SUM_FIELDS.forEach(([k, label]) => {
    const va = n0(a.totals[k]), vb = n0(b.totals[k]);
    if (va === 0 && vb === 0) return;
    const tr = el('tr');
    tr.appendChild(el('td', null, label));
    tr.appendChild(el('td', null, num(va)));
    tr.appendChild(el('td', null, num(vb)));
    const td = el('td');
    td.appendChild(cmpDelta(va, vb));
    tr.appendChild(td);
    stb.appendChild(tr);
  });
  sumTable.appendChild(stb);
  sumWrap.appendChild(sumTable);
  out.appendChild(sumWrap);

  const prof = cmpProfile(a);

  /* ---- 卷軸效率 ---- */
  const avgA = scrollAvg(a, prof.atkKey), avgB = scrollAvg(b, prof.atkKey);
  if (avgA !== null || avgB !== null) {
    out.appendChild(title('卷軸效率（' + prof.atkLabel + '）'));
    const sw2 = el('div', 'tablewrap');
    const st2 = el('table', 'rank');
    const h2 = el('tr');
    ['項目', a.name, b.name, 'A − B'].forEach((x) => h2.appendChild(el('th', null, x)));
    const th2 = el('thead'); th2.appendChild(h2); st2.appendChild(th2);
    const tb2 = el('tbody');

    [['卷軸總次數', a.scrollTotal, b.scrollTotal, ''],
     ['卷軸' + prof.atkLabel + '總和', n0(a.etcTotals[prof.atkKey]),
      n0(b.etcTotals[prof.atkKey]), ''],
     ['平均每卷' + prof.atkLabel,
      avgA === null ? null : Math.round(avgA * 100) / 100,
      avgB === null ? null : Math.round(avgB * 100) / 100, '']
    ].forEach(([label, va, vb]) => {
      const tr = el('tr');
      tr.appendChild(el('td', 'rank-name', label));
      tr.appendChild(el('td', 'bd-metric', va === null ? '—' : num(va)));
      tr.appendChild(el('td', 'bd-metric', vb === null ? '—' : num(vb)));
      const td = el('td');
      td.appendChild(cmpDelta(va, vb));
      tr.appendChild(td);
      tb2.appendChild(tr);
    });
    st2.appendChild(tb2);
    sw2.appendChild(st2);
    out.appendChild(sw2);
    out.appendChild(el('p', 'hint',
      '卷軸貢獻取自 item_etc_option（四段拆解裡的「卷軸」那一段），除以卷軸次數。'
      + '只計算有卷過的裝備。'));
  }

  /* ---- 潛能：主屬性、全屬性、其他分開 ---- */
  const potKeys = Object.keys(a.potTotals).concat(Object.keys(b.potTotals))
    .filter((k, i, arr) => arr.indexOf(k) === i)
    .filter((k) => n0(a.potTotals[k]) !== 0 || n0(b.potTotals[k]) !== 0);

  const potTable = (keys, heading) => {
    if (!keys.length) return;
    keys.sort((x, y) => Math.abs(n0(b.potTotals[y]) - n0(a.potTotals[y]))
                      - Math.abs(n0(b.potTotals[x]) - n0(a.potTotals[x])));
    out.appendChild(title(heading));
    const pw = el('div', 'tablewrap');
    const pt = el('table', 'rank');
    const ph = el('tr');
    ['潛能項目', a.name, b.name, 'A − B'].forEach((h) => ph.appendChild(el('th', null, h)));
    const pthead = el('thead'); pthead.appendChild(ph); pt.appendChild(pthead);

    const ptb = el('tbody');
    keys.forEach((k) => {
      const [stat, unit] = k.split('|');
      const va = n0(a.potTotals[k]), vb = n0(b.potTotals[k]);
      const tr = el('tr');
      tr.appendChild(el('td', 'rank-name', stat + (unit ? '（' + unit + '）' : '')));
      tr.appendChild(el('td', null, num(va) + unit));
      tr.appendChild(el('td', null, num(vb) + unit));
      const td = el('td');
      td.appendChild(cmpDelta(va, vb, unit));
      tr.appendChild(td);
      ptb.appendChild(tr);
    });
    pt.appendChild(ptb);
    pw.appendChild(pt);
    out.appendChild(pw);
  };

  /* 主潛能 = 這隻角色吃的主屬性；全屬性另計，因為它同時加四維，
     跟純主屬性不是同一回事 */
  const isMain = (k) => k.split('|')[0] === prof.mainLabel;
  const isAll = (k) => k.split('|')[0] === '全屬性';

  potTable(potKeys.filter(isMain), '主潛能 · ' + prof.mainLabel);
  potTable(potKeys.filter(isAll), '全屬性潛能');
  potTable(potKeys.filter((k) => !isMain(k) && !isAll(k)), '其他潛能');

  const un = n0(a.potUnparsedTotal) + n0(b.potUnparsedTotal);
  if (un) {
    out.appendChild(el('p', 'hint',
      '另有 ' + un + ' 條潛能沒有數值可比（例如「可以使用〈某技能〉」），未列入。'));
  }

  /* ---- 逐格比對 ---- */
  const filter = $('#cmpFilter').value;

  out.appendChild(title('逐格比對　·　換裝評估以 ' + a.name + ' 為基準（'
    + prof.mainLabel + ' / ' + prof.atkLabel + '）'));

  const wrap = el('div', 'tablewrap');
  const table = el('table', 'rank cmp-table');
  const th = el('tr');
  ['欄位', a.name + '（我）', b.name + '（對方）', '換到我這邊']
    .forEach((h) => th.appendChild(el('th', null, h)));
  const thead = el('thead'); thead.appendChild(th); table.appendChild(thead);

  const tb = el('tbody');
  let shown = 0;
  const tally = { up: 0, down: 0, mixed: 0, same: 0 };

  cmpPairs(a, b, prof, $('#cmpPair').value).forEach((row) => {
    const ia = row.ia, ib = row.ib;
    if (!ia && !ib) return;
    if (filter === 'both' && !(ia && ib)) return;

    const swap = cmpSwap(ia, ib, prof);
    if (filter === 'diff' && swap.verdict === 'same') return;

    shown++;
    tally[swap.verdict]++;

    const tr = el('tr');
    const nameTd = el('td', 'rank-name');
    nameTd.appendChild(document.createTextNode(row.label));
    if (row.note) nameTd.appendChild(el('small', 'cmp-note', row.note));
    tr.appendChild(nameTd);
    tr.appendChild(cmpItemCell(ia, prof, a.name + '（我）'));
    tr.appendChild(cmpItemCell(ib, prof, b.name + '（對方）'));

    const td = el('td', 'cmp-swap');
    td.dataset.lab = '換到我這邊';
    const [label, cls] = CMP_VERDICT[swap.verdict];
    td.appendChild(el('span', 'swap-badge ' + cls, label));
    if (swap.metrics.length) {
      const list = el('div', 'swap-metrics');
      swap.metrics.forEach(([name, dd, unit, isPot]) => {
        const m = el('span', 'swap-m ' + (dd > 0 ? 'up' : 'down')
          + (isPot ? ' pot' : ''));
        m.textContent = (isPot ? '潛·' : '') + name + ' '
          + (dd > 0 ? '+' : '') + num(dd) + unit;
        list.appendChild(m);
      });
      td.appendChild(list);
    }
    if (swap.unparsed) {
      td.appendChild(el('div', 'swap-unparsed',
        swap.unparsed + ' 條潛能無數值可比'));
    }
    tr.appendChild(td);
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  wrap.appendChild(table);
  out.appendChild(wrap);

  if (!shown) {
    out.appendChild(el('div', 'empty', '這個篩選條件下沒有可顯示的欄位。'));
    return;
  }

  out.appendChild(kvGrid([
    ['換過來會升級', tally.up + ' 格'],
    ['換過來會降級', tally.down + ' 格'],
    ['互有優劣', tally.mixed + ' 格'],
    ['數值相同', tally.same + ' 格'],
  ]));

  out.appendChild(el('p', 'hint',
    '評估含裝備數值（基礎＋追加＋卷軸＋星力）與潛能／附加潛能。'
    + '潛能在 API 裡是文字，本站以「名稱 +數值單位」的格式解析，'
    + '標「潛·」的就是潛能項目；百分比與固定值分開計算，不會混加。'
    + '「以角色等級為準每9級 INT」這類條件式詞條維持原樣單獨計，不換算成實際數值。'));
}

function cmpSyncCost() {
  const box = $('#cmpCost');
  if (!box) return;
  const names = [$('#cmpA').value.trim(), $('#cmpB').value.trim()].filter(Boolean);
  const missing = names.filter((n) => !CMP_DATA[n]).length;
  box.textContent = missing ? ('需 ' + (missing * 4) + ' 次 API') : '已載入，切換篩選免費';
  box.className = 'exp-cost' + (missing ? '' : ' free');
}

function cmpFillNames() {
  const dl = $('#cmpNames');
  if (!dl) return;
  const set = new Set();
  histLoad().forEach((h) => set.add(h.name));
  dl.innerHTML = '';
  Array.from(set).sort().forEach((n) => dl.appendChild(new Option(n)));
}

/** 兩邊都載入後，把各自的裝備頁填進選單；只有一組時就沒必要顯示 */
function cmpFillSets() {
  const row = $('#cmpSetRow');
  const pairs = [
    [$('#cmpA').value.trim(), $('#cmpSetA')],
    [$('#cmpB').value.trim(), $('#cmpSetB')],
  ];

  let anyChoice = false;
  pairs.forEach(([name, sel]) => {
    const raw = CMP_DATA[name];
    const sets = (raw && raw.sets) || [];
    const keep = sel.value;
    sel.innerHTML = '';
    sets.forEach((s) => sel.appendChild(new Option(s.label, s.key)));
    // 換角色後舊的選擇可能不存在，存在才沿用
    if (keep && sets.some((s) => s.key === keep)) sel.value = keep;
    if (sets.length > 1) anyChoice = true;
  });

  row.hidden = !anyChoice;
}

function wireCompare() {
  $('#cmpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const names = [$('#cmpA').value.trim(), $('#cmpB').value.trim()];
    if (!names[0] || !names[1]) return;

    const box = $('#cmpStatus');
    $('#cmpGo').disabled = true;
    try {
      for (const n of names) {
        if (CMP_DATA[n]) continue;
        spinner(box, '載入 ' + n + '…');
        CMP_DATA[n] = await cmpFetch(n);
      }
      box.textContent = '';
      cmpSyncCost();
      cmpFillSets();
      cmpRender();
    } catch (err) {
      showError(box, '查詢失敗：' + err.message);
      $('#cmpResult').innerHTML = '';
    } finally {
      $('#cmpGo').disabled = false;
    }
  });

  $('#cmpFilter').addEventListener('change', cmpRender);
  $('#cmpPair').addEventListener('change', cmpRender);
  $('#cmpSetA').addEventListener('change', cmpRender);
  $('#cmpSetB').addEventListener('change', cmpRender);
  ['#cmpA', '#cmpB'].forEach((sel) => {
    $(sel).addEventListener('input', cmpSyncCost);
  });

  cmpFillNames();
  cmpSyncCost();
}

/* ================================================================== *
 * 查詢紀錄
 * ================================================================== */

const HIST_KEY = 'tms.history';
const HIST_MAX = 15;

function histLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function histSave(list) {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, HIST_MAX)));
  } catch (e) { /* 隱私模式或空間不足就算了 */ }
}

/** 查詢成功後補上角色資訊；同名的往前提，不重複 */
function histAdd(name, basic) {
  const list = histLoad().filter((h) => h.name !== name);
  list.unshift({
    name: name,
    world: (basic && basic.world_name) || '',
    cls: (basic && basic.character_class) || '',
    level: (basic && basic.character_level) || '',
    at: Date.now(),
  });
  histSave(list);
  histRender();
}

function histRemove(name) {
  histSave(histLoad().filter((h) => h.name !== name));
  histRender();
}

function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '剛剛';
  if (s < 3600) return Math.floor(s / 60) + ' 分鐘前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小時前';
  return Math.floor(s / 86400) + ' 天前';
}

function histRender() {
  const box = $('#history');
  const list = histLoad();
  box.innerHTML = '';
  if (!list.length) return;

  box.appendChild(el('span', 'hist-label', '最近查詢：'));

  list.forEach((h) => {
    const chip = el('span', 'chip');

    const go = el('button', 'chip-go');
    go.type = 'button';
    go.appendChild(el('b', null, h.name));
    const sub = [h.world, h.level ? 'Lv.' + h.level : '', h.cls]
      .filter(Boolean).join(' · ');
    if (sub) go.appendChild(el('small', null, sub));
    go.title = sub ? (sub + '　' + ago(h.at)) : ago(h.at);
    go.addEventListener('click', () => {
      $('#nameInput').value = h.name;
      lookup(h.name, $('#dateInput').value);
    });
    chip.appendChild(go);

    const del = el('button', 'chip-x', '×');
    del.type = 'button';
    del.title = '從紀錄移除';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      histRemove(h.name);
    });
    chip.appendChild(del);

    box.appendChild(chip);
  });

  const clear = el('button', 'chip-clear', '清除全部');
  clear.type = 'button';
  clear.addEventListener('click', () => { histSave([]); histRender(); });
  box.appendChild(clear);
}

/* ================================================================== *
 * 檢視切換 / 金鑰
 * ================================================================== */

function switchView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
}

async function refreshKeyState() {
  try {
    const s = await (await apiFetch('status')).json();
    const box = $('#keyState');
    if (s.has_key) {
      box.className = 'key-state ok';
      /* 線上模式：不報配額（一律 0 / 0），也不報金鑰前綴 ——
         測試者不需要知道伺服器端金鑰長什麼樣子。 */
      box.textContent = HOSTED
        ? '封測碼有效，可以開始查詢。'
        : '目前金鑰：' + s.key_hint + '（' + s.key_tier
          + '，來源 ' + s.source + '）　今日已用 '
          + s.quota_used + ' / ' + s.quota_budget;
    } else {
      box.className = 'key-state bad';
      box.textContent = HOSTED ? '尚未輸入封測碼，查詢會失敗。'
                               : '尚未設定金鑰，查詢會失敗。';
    }
    return s.has_key;
  } catch (e) {
    return false;
  }
}

function wireKeyModal() {
  const modal = $('#keyModal');
  const open = () => { modal.hidden = false; refreshKeyState(); $('#keyInput').focus(); };
  const close = () => { modal.hidden = true; };

  $('#keyBtn').addEventListener('click', open);
  $('#keyCancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  $('#cacheClear').addEventListener('click', async () => {
    if (HOSTED) {
      // Worker 的快取由 Cloudflare 管理，前端清不掉
      $('#keyState').className = 'key-state';
      $('#keyState').textContent = '線上模式的快取由 Worker 管理，無法從這裡清除。';
      return;
    }
    await apiFetch('cache/clear');
    $('#keyState').className = 'key-state ok';
    $('#keyState').textContent = '快取已清空。';
    refreshQuota();
  });

  $('#keySave').addEventListener('click', async () => {
    const key = $('#keyInput').value.trim();
    if (!key) return;
    const box0 = $('#keyState');

    /* 線上模式輸入的是封測碼，不是 API 金鑰 —— 金鑰在 Worker 端，
       前端拿不到也不該拿到。存本機後直接驗一次。 */
    if (HOSTED) {
      const bad = betaTokenProblem(key);
      if (bad) {
        box0.className = 'key-state bad';
        box0.textContent = bad;
        return;
      }
      setBetaToken(key);
      $('#keyInput').value = '';
      const ok = await refreshKeyState();
      if (ok) {
        box0.className = 'key-state ok';
        box0.textContent = '封測碼已儲存。';
        refreshQuota();
        setTimeout(close, 900);
      } else {
        box0.className = 'key-state bad';
        box0.textContent = '封測碼不正確，或這個網域未被允許。';
      }
      return;
    }

    const res = await apiFetch('key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key }),
    });
    const body = await res.json();
    const box = $('#keyState');
    if (body.ok) {
      $('#keyInput').value = '';
      box.className = 'key-state ok';
      box.textContent = '已儲存。';
      refreshQuota();
      setTimeout(close, 900);
    } else {
      box.className = 'key-state bad';
      box.textContent = body.message || '儲存失敗';
    }
  });
  return open;
}

/* ================================================================== *
 * 啟動
 * ================================================================== */

(async function init() {
  const y = latestDataDate();

  // 實測：帶今天的日期會被拒（OPENAPI00004），但「不帶 date」會回傳比昨天
  // 更新的一筆。所以角色查詢預設留空＝最新，日期只在要看歷史時才填。
  $('#dateInput').value = '';
  $('#dateInput').max = y;
  $('#dateInput').title = '選擇歷史快照日期，最新可填 ' + y;

  /* 線上模式輸入的是封測碼，不是 API 金鑰 —— 介面文案要跟著換，
     否則會誤導測試者去貼自己的 NEXON 金鑰。 */
  if (HOSTED) {
    const btn = $('#keyBtn');
    if (btn) { btn.textContent = '🎫 封測碼'; btn.title = '輸入封測通行碼'; }
    const h2 = document.querySelector('#keyModal h2');
    if (h2) h2.textContent = '封測通行碼';
    const note = document.querySelector('#keyModal .modal-note');
    if (note) {
      note.textContent = 'API 金鑰保存在伺服器端，你不需要（也拿不到）它。'
        + '請輸入管理者發給你的封測碼，只會存在這台裝置的瀏覽器裡。'
        + '封測碼限半形英數字與符號（不支援中文與 emoji）。';
    }
    const inp = $('#keyInput');
    if (inp) inp.placeholder = '輸入封測碼（半形英數字）';
    const cc = $('#cacheClear');
    if (cc) cc.hidden = true;
    // 先藏起來，別等 status 回來才閃一下
    const q = $('#quota');
    if (q) q.hidden = true;
  }

  const openModal = wireKeyModal();

  $$('.navbtn').forEach((b) => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });

  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#nameInput').value.trim();
    if (name) lookup(name, $('#dateInput').value);
  });

  histRender();
  wireCompare();

  // 裝備詳情：點背景或按 Esc 關閉
  $('#itemModal').addEventListener('click', (e) => {
    if (e.target.id === 'itemModal') $('#itemModal').hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#itemModal').hidden = true;
      $('#keyModal').hidden = true;
    }
  });

  refreshQuota();
  const hasKey = await refreshKeyState();
  if (!hasKey) {
    const s = $('#status');
    s.className = 'status info';
    s.innerHTML = '';
    s.appendChild(document.createTextNode(HOSTED
      ? '⚠ 尚未輸入封測碼，無法查詢角色 — '
      : '⚠ 尚未設定 API 金鑰，無法查詢角色 — '));
    const a = el('a', null, '點此設定');
    a.href = '#';
    a.addEventListener('click', (ev) => { ev.preventDefault(); openModal(); });
    s.appendChild(a);
    setWelcome(true);
  } else {
    setWelcome(true);
  }
})();
