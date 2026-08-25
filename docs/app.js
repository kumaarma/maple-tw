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

/**
 * index.html 的 sprite 圖示。
 *
 * 不用 emoji：同一個字在 Windows／Android／iOS 是三套完全不同的畫風，
 * 大小與基線也各自為政，擺進按鈕裡對不齊。SVG 三個平台長得一樣，
 * 而且描邊吃 currentColor，按鈕變色時圖示自己會跟著變。
 *
 * 一律 aria-hidden：這些圖示旁邊都有文字，讓螢幕閱讀器唸兩次只是吵。
 */
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.appendChild(use);
  return svg;
}

/** 圖示 + 文字，中間補一個空白 */
function iconText(name, text) {
  const frag = document.createDocumentFragment();
  frag.appendChild(icon(name));
  frag.appendChild(document.createTextNode(' ' + text));
  return frag;
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
 * 大數字改用「億／萬」分段。
 *
 * 戰鬥力動輒十位數，1,025,399,544 這種千分位讀不出量級 —— 要數逗號才知道
 * 是十億還是一億。10億2539萬9544 一眼就看得出來。
 *
 * 中段補零到四位是刻意的：1 億又 1 點戰鬥力寫成「1億1」會被讀成 1 億 1 萬，
 * 寫「1億0000萬0001」才不會有歧義。尾段是零就整段省略（2億5000萬）。
 */
function fmtBig(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return txt(v);
  if (Math.abs(n) < 10000) return String(n);

  const sign = n < 0 ? '-' : '';
  const a = Math.abs(Math.trunc(n));
  const yi = Math.floor(a / 1e8);
  const wan = Math.floor((a % 1e8) / 1e4);
  const ones = a % 1e4;
  const pad = (x) => String(x).padStart(4, '0');

  let out = '';
  if (yi) out += yi + '億';
  if (wan || (yi && ones)) out += (yi ? pad(wan) : String(wan)) + '萬';
  if (ones) out += (yi || wan) ? pad(ones) : String(ones);
  return sign + out;
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

/**
 * 把目前查的角色寫進網址，這樣重新整理、加書籤、直接複製網址列都還在同一個
 * 角色上（卡片的「分享」也是複製這個形式）。用 replaceState 而不是 pushState：
 * 查十個角色不該在瀏覽器裡堆十筆上一頁。
 */
function syncUrl(name, date) {
  if (!window.history || !history.replaceState) return;
  const qs = new URLSearchParams();
  qs.set('name', name);
  if (date) qs.set('date', date);
  try {
    history.replaceState(null, '', location.pathname + '?' + qs.toString());
  } catch (e) { /* file:// 不給改，無所謂 */ }
}

/**
 * 開站時的 ?name=／?date=，讓分享出去的網址直接落在那個角色上。
 * search 參數只給測試餵值用 —— 正常呼叫不帶，就讀真的網址。
 */
function urlTarget(search) {
  try {
    const qs = new URLSearchParams(search === undefined ? location.search : search);
    const name = (qs.get('name') || '').trim();
    return name ? { name: name, date: (qs.get('date') || '').trim() } : null;
  } catch (e) {
    return null;
  }
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
  histAdd(name, d('basic'), d('stat'));
  syncUrl(name, date);
}

const TABS = [
  /* 裝備併進總覽了，不再另立分頁 —— 預設組切換就在 EQUIPMENT 面板裡。
     代價是 setEffect 也變成一定會抓（套裝效果跟著搬過來）。 */
  ['總覽',     ['basic', 'stat', 'popularity', 'ability', 'hyperStat', 'propensity', 'dojang',
               'equip', 'setEffect', 'android', 'pet'], renderOverview],
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
  const hint = el('p', 'tabs-hint');
  hint.appendChild(iconText('pointer',
    '點選分頁查看詳細資料 · 各分頁首次開啟才會向 API 請求，節省配額'));
  tabsWrap.appendChild(hint);

  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  const panels = el('div', 'panels');

  /* 手機版分頁列是一排橫捲的，用鍵盤或程式切到看不見的分頁時要自己捲過去。
     不用 scrollIntoView：那個會連整頁一起捲，點分頁時畫面會跳。 */
  function revealTab(btn) {
    const left = btn.offsetLeft;
    const right = left + btn.offsetWidth;
    if (left < tabs.scrollLeft) {
      tabs.scrollLeft = left - 12;
    } else if (right > tabs.scrollLeft + tabs.clientWidth) {
      // 右緣有 26px 的漸層遮罩，多讓一點才不會停在半透明底下
      tabs.scrollLeft = right - tabs.clientWidth + 26;
    }
  }

  TABS.forEach(([label, needs, fn], i) => {
    const btn = el('button', 'tab' + (i === 0 ? ' active loaded' : ''), label);
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.id = 'tab-' + i;
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    btn.setAttribute('aria-controls', 'panel-' + i);
    /* roving tabindex：整列分頁只佔一個 Tab 停留點，進到列上之後用左右鍵走。
       11 個分頁各自可 Tab 的話，鍵盤使用者要按 11 次才跳得過這一列。 */
    btn.tabIndex = i === 0 ? 0 : -1;

    const panel = el('div', 'panel' + (i === 0 ? ' active' : ''));
    panel.id = 'panel-' + i;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', 'tab-' + i);
    // 面板內容可能很長又沒有可聚焦元素，給 0 才捲得到
    panel.tabIndex = 0;
    let loaded = false;

    async function activate() {
      tabs.querySelectorAll('.tab').forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
        t.tabIndex = -1;
      });
      panels.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      btn.tabIndex = 0;
      panel.classList.add('active');
      revealTab(btn);

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
        collapsify(panel, label);
        btn.classList.add('loaded');
      } catch (err) {
        panel.appendChild(el('div', 'err-line', '這一區渲染失敗：' + err.message));
        btn.classList.add('loaded');
      }
    }

    btn.addEventListener('click', activate);

    /* WAI-ARIA 的 tablist 鍵盤約定：左右鍵換分頁、Home/End 跳頭尾。
       換過去要真的把焦點帶過去，不然螢幕閱讀器唸的還是原本那顆。 */
    btn.addEventListener('keydown', (e) => {
      const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
      const move = keys[e.key];
      if (move === undefined) return;
      e.preventDefault();
      const all = Array.from(tabs.querySelectorAll('.tab'));
      const at = all.indexOf(btn);
      let next;
      if (move === 'first') next = 0;
      else if (move === 'last') next = all.length - 1;
      else next = (at + move + all.length) % all.length;   // 走到頭接回另一端
      all[next].focus();
      all[next].click();
    });

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
  if (QDATE) {
    const asof = el('span', 'hero-asof');
    asof.appendChild(iconText('calendar', QDATE + ' 快照'));
    lvRow.appendChild(asof);
  }
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
    const re = el('button', 'ghost hero-refresh');
    re.appendChild(iconText('refresh', '重新整理'));
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

/* ================================================================== *
 * 遊戲版面的能力值面板
 * ================================================================== */

/**
 * 億／萬 的中文數字寫法，跟遊戲面板一致：20億 9568萬 437。
 *
 * 只有大數字才拆。遊戲裡 HP 是「71,599」不是「7萬1599」，所以門檻設在
 * 一億 —— 戰鬥力與屬性攻擊力會拆，其餘維持千分位。
 */
function fmtWan(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) < 1e8) return num(v);
  const neg = n < 0;
  let x = Math.abs(Math.trunc(n));
  const yi = Math.floor(x / 1e8); x -= yi * 1e8;
  const wan = Math.floor(x / 1e4); x -= wan * 1e4;
  const out = [];
  if (yi) out.push(yi.toLocaleString('zh-TW') + '億');
  if (wan) out.push(wan + '萬');
  if (x) out.push(String(x));
  return (neg ? '-' : '') + out.join(' ');
}

/* 要補上百分號的欄位。API 只給數字，遊戲面板上這些是百分比 —— 對照
   遊戲畫面逐格確認過，沒有靠猜的。 */
const STAT_PCT = {
  '傷害': 1, 'BOSS怪物傷害': 1, '一般怪物傷害': 1, '最終傷害': 1,
  '無視防禦率': 1, '爆擊機率': 1, '爆擊傷害': 1, 'Buff持續時間': 1,
  '未套用冷卻時間': 1, '無視屬性耐性': 1, '狀態異常追加傷害': 1,
  '召喚獸持續時間增加': 1, '楓幣獲得量': 1, '道具掉落率': 1,
  '獲得額外經驗值': 1, '狀態異常耐性': 0, '攻擊速度': 0,
};

/* 遊戲「屬性」面板的兩欄配對與順序。左右各一格，順序照遊戲畫面。
   null 代表那一格要特別組（屬性攻擊力是 最低~最高、冷卻時間減少是 秒/%）。 */
const GAME_STAT_PAIRS = [
  ['@eleAtk',        '傷害'],
  ['最終傷害',       'BOSS怪物傷害'],
  ['無視防禦率',     '一般怪物傷害'],
  ['攻擊力',         '爆擊機率'],
  ['魔法攻擊力',     '爆擊傷害'],
  ['@cooldown',      'Buff持續時間'],
  ['未套用冷卻時間', '無視屬性耐性'],
  ['狀態異常追加傷害', '召喚獸持續時間增加'],
  ['楓幣獲得量',     '星力'],
  ['道具掉落率',     '神秘力量'],
  ['獲得額外經驗值', '真實之力'],
];

/* 基礎六格，遊戲面板上排在戰鬥力底下 */
const GAME_STAT_BASE = [['HP', 'MP'], ['STR', 'DEX'], ['INT', 'LUK']];

/** 這些已經在面板上出現過，不要再進「其他」區塊重複一次 */
function gameStatUsed() {
  const used = { '戰鬥力': 1, '最低屬性攻擊力': 1, '最高屬性攻擊力': 1,
                 '冷卻時間減少(秒)': 1, '冷卻時間減少(％)': 1 };
  GAME_STAT_BASE.forEach((row) => row.forEach((k) => { used[k] = 1; }));
  GAME_STAT_PAIRS.forEach((row) => row.forEach((k) => {
    if (k && k.charAt(0) !== '@') used[k] = 1;
  }));
  return used;
}

/** 一格的顯示值。@ 開頭是要合併多個 API 欄位的特例 */
function gameStatValue(get, key) {
  if (key === '@eleAtk') {
    const lo = get('最低屬性攻擊力'), hi = get('最高屬性攻擊力');
    if (lo === null && hi === null) return null;
    if (lo === null || hi === null || String(lo) === String(hi)) {
      return fmtWan(hi === null ? lo : hi);
    }
    /* 遊戲只顯示一個數字，API 給的是區間。併成「A ~ B」會撐成兩行把格子
       擠歪，所以主值取最高、最低降成副標 —— 兩個數字都留著，不挑一個
       當唯一真相。 */
    return { main: fmtWan(hi), sub: '最低 ' + fmtWan(lo) };
  }
  if (key === '@cooldown') {
    const s = get('冷卻時間減少(秒)'), p = get('冷卻時間減少(％)');
    if (s === null && p === null) return null;
    return (s === null ? '—' : s + '秒') + ' / ' + (p === null ? '—' : p + '%');
  }
  const v = get(key);
  if (v === null) return null;
  return num(v) + (STAT_PCT[key] ? '%' : '');
}

const GAME_STAT_LABEL = {
  '@eleAtk': '屬性攻擊力', '@cooldown': '冷卻時間減少',
  '未套用冷卻時間': '無視冷卻時間', 'BOSS怪物傷害': 'Boss怪物傷害',
  '無視屬性耐性': '無視屬性抗性', '召喚獸持續時間增加': '增加召喚獸持續時間',
  '獲得額外經驗值': '額外獲得經驗值', '真實之力': '真實力量',
};

/**
 * 照遊戲「屬性」視窗的排法畫能力值。
 *
 * 原本是照 API 回傳順序鋪成一排卡片 —— 資料沒錯，但玩家記得的是遊戲裡
 * 那個排列（戰鬥力一條帶、六個基礎值、然後兩欄成對的清單），照 API 順序
 * 找一格要掃過整片。
 *
 * API 沒有的東西不假裝有：遊戲那些 ▲ 是「被加成過」的標記，API 只給最終
 * 值、不說哪些被加成，所以不畫。+／- 與「套用」是遊戲內的操作鈕，唯讀的
 * 查詢站放了也沒有意義。
 */
/**
 * 畫一組左右成對的格子。
 *
 * 少了一邊不能直接跳過 —— 兩欄格線會把後面的每一格往前擠一位，整個面板
 * 的配對就全錯了（實測某筆資料沒有 MP，結果變成 HP｜STR、DEX｜INT）。
 * 只要有一邊拿得到值就兩邊都畫，缺的那邊補「—」；兩邊都沒有才整列不畫。
 */
function addStatPair(box, pair, valueOf, labelOf) {
  const vals = pair.map(valueOf);
  if (vals.every((v) => v === null)) return;
  pair.forEach((k, i) => {
    const v = vals[i];
    const cell = el('div', 'gstat-cell');
    cell.appendChild(el('span', 'gstat-k', labelOf(k)));
    if (v && typeof v === 'object') {
      const box2 = el('span', 'gstat-vbox');
      box2.appendChild(el('span', 'gstat-v', v.main));
      box2.appendChild(el('span', 'gstat-sub', v.sub));
      cell.appendChild(box2);
    } else {
      cell.appendChild(el('span', 'gstat-v' + (v === null ? ' gstat-none' : ''),
        v === null ? '—' : v));
    }
    box.appendChild(cell);
  });
}

/** 仿遊戲視窗的外框：標題列 + 內容。統一從這裡出，樣式才不會各寫一份 */
function gamePanel(head, body) {
  const panel = el('div', 'gpanel');
  panel.appendChild(el('div', 'gpanel-head', head));
  const inner = el('div', 'gpanel-body');
  inner.appendChild(body);
  panel.appendChild(inner);
  return panel;
}

function statGamePanel(stat) {
  const map = {};
  stat.final_stat.forEach((s) => { map[s.stat_name] = s.stat_value; });
  const get = (k) => (map[k] === undefined || map[k] === null || map[k] === '' ? null : map[k]);

  const panel = el('div', 'gpanel');
  panel.appendChild(el('div', 'gpanel-head', '屬性'));
  const body = el('div', 'gpanel-body');

  /* ---- 戰鬥力：獨立一條帶 ---- */
  const power = get('戰鬥力');
  if (power !== null) {
    const band = el('div', 'gstat-power');
    band.appendChild(el('span', 'gstat-power-k', '戰鬥力'));
    band.appendChild(el('span', 'gstat-power-v', fmtWan(power)));
    body.appendChild(band);
  }

  /* ---- 基礎六格 ---- */
  const base = el('div', 'gstat-rows gstat-base');
  GAME_STAT_BASE.forEach((pair) => addStatPair(base, pair,
    (k) => (get(k) === null ? null : num(get(k))), (k) => k));
  if (base.children.length) body.appendChild(base);

  /* ---- 兩欄成對的清單 ---- */
  const rows = el('div', 'gstat-rows');
  GAME_STAT_PAIRS.forEach((pair) => addStatPair(rows, pair,
    (k) => gameStatValue(get, k), (k) => GAME_STAT_LABEL[k] || k));
  if (rows.children.length) body.appendChild(rows);

  panel.appendChild(body);

  /* ---- 遊戲面板沒有、但 API 有的欄位 ---- */
  const used = gameStatUsed();
  const rest = stat.final_stat.filter((s) => !used[s.stat_name]);
  const extra = rest.length ? el('details', 'gpanel-extra') : null;
  if (extra) {
    extra.appendChild(el('summary', null, '其他欄位（' + rest.length + '）'));
    extra.appendChild(kvGrid(rest.map((s) =>
      [s.stat_name, num(s.stat_value) + (STAT_PCT[s.stat_name] ? '%' : '')])));
  }

  const wrap = frag();
  wrap.appendChild(panel);
  if (extra) wrap.appendChild(extra);
  return wrap;
}

/* 內在潛能的等級配色，跟遊戲 ABILITY 面板一致：傳說綠、罕見橘、稀有紫。
   API 這三個字串是從實際回傳撈出來確認的，不是照潛能那套猜的 —— 潛能有
   史詩，內在潛能沒有。 */
const ABILITY_GRADE = { '傳說': 'legend', '罕見': 'unique', '稀有': 'rare', '特殊': 'special' };

/**
 * 內在潛能畫成一行一條的顏色橫條。
 *
 * 原本是 kv 卡片，等級只是標籤上的兩個字。遊戲裡等級是靠整條的顏色講的，
 * 一眼就分得出哪一行是傳說。顏色之外仍然把等級寫出來 —— 只靠顏色傳達
 * 資訊的話，色覺障礙的人就讀不到了。
 */
function abilityBars(info) {
  const box = el('div', 'abars');
  info.forEach((a) => {
    const g = ABILITY_GRADE[a.ability_grade] || 'special';
    const row = el('div', 'abar ab-' + g);
    row.appendChild(el('span', 'abar-grade', txt(a.ability_grade)));
    row.appendChild(el('span', 'abar-text', txt(a.ability_value)));
    box.appendChild(row);
  });
  return box;
}

/**
 * 性向的六角雷達圖。
 *
 * 六個數值攤成六張卡片時，看得到數字卻看不出偏重哪一項。雷達圖把六項
 * 一起畫出來，形狀本身就是答案。滿級是 100，所以軸長固定 0~100 ——
 * 用當下最大值當軸長的話，全部 60 跟全部 100 會畫出一模一樣的圖。
 */
function propensityRadar(rows) {
  const NS = 'http://www.w3.org/2000/svg';
  const MAX = 100;
  const W = 300, C = 150, R = 96;
  const wrap = el('div', 'radar-wrap');

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + W);
  svg.setAttribute('class', 'radar');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '性向雷達圖：'
    + rows.map((r) => r[0] + ' ' + n0(r[1])).join('、'));

  const mk = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach((k) => n.setAttribute(k, attrs[k]));
    return n;
  };
  // 12 點鐘方向起算，順時針
  const at = (i, r) => {
    const th = -Math.PI / 2 + (Math.PI * 2 * i) / rows.length;
    return [C + Math.cos(th) * r, C + Math.sin(th) * r];
  };
  const poly = (r) => rows.map((_, i) => at(i, r).join(',')).join(' ');

  /* 背景格線：四圈 */
  [0.25, 0.5, 0.75, 1].forEach((f) => {
    svg.appendChild(mk('polygon', { points: poly(R * f), class: 'radar-grid' }));
  });
  rows.forEach((_, i) => {
    const [x, y] = at(i, R);
    svg.appendChild(mk('line', { x1: C, y1: C, x2: x, y2: y, class: 'radar-grid' }));
  });

  /* 數值 */
  const pts = rows.map((r, i) => at(i, R * Math.max(0, Math.min(n0(r[1]), MAX)) / MAX));
  svg.appendChild(mk('polygon', {
    points: pts.map((p) => p.join(',')).join(' '), class: 'radar-area',
  }));
  pts.forEach((p) => svg.appendChild(mk('circle', {
    cx: p[0], cy: p[1], r: 2.5, class: 'radar-dot',
  })));

  /* 軸標籤 */
  rows.forEach((r, i) => {
    const [x, y] = at(i, R + 18);
    const t = mk('text', {
      x: x, y: y + 4, class: 'radar-label',
      'text-anchor': Math.abs(x - C) < 6 ? 'middle' : (x > C ? 'start' : 'end'),
    });
    t.textContent = r[0] + ' ' + n0(r[1]);
    svg.appendChild(t);
  });

  wrap.appendChild(svg);
  return wrap;
}

/** 身分資訊的一排 chip。值是空的就不放那一顆 */
function idChips(pairs) {
  const box = el('div', 'idchips');
  pairs.forEach(([k, v]) => {
    if (v === null || v === undefined || v === '' || v === '—') return;
    const chip = el('span', 'idchip');
    chip.appendChild(el('span', 'idchip-k', k));
    chip.appendChild(el('span', 'idchip-v', v));
    box.appendChild(chip);
  });
  return box;
}

/**
 * 裝備面板：預設組切換 + 該組的格線。
 *
 * 預設組原本在「裝備」分頁自己一列，跟能力值分開兩個地方看。併進同一個
 * 視窗之後就跟遊戲一樣了 —— 遊戲的 EQUIPMENT 視窗底部就是 PRESETS 1 2 3。
 */
/**
 * 把「現在穿的機器人」補進目前穿戴。
 *
 * NEXON 把機器人放在 character/android-equipment，不塞進 item_equipment ——
 * 所以「目前穿戴」的機器人那格會空著，但預設組裡有（預設組是整份快照）。
 * 遊戲裡沒有這種區分，它永遠顯示現在穿的、包含機器人，所以這格空著算漏。
 *
 * 只在 item_equipment 沒有機器人時才補，免得跟預設組的資料打架。
 */
function withAndroid(items) {
  const list = items || [];
  if (list.some((it) => it.item_equipment_slot === '機器人')) return list;

  const a = d('android');
  if (!a || !a.android_name) return list;

  /* 湊成一件裝備的形狀。機器人沒有星力、卷軸與潛能 —— 這些欄位要整個
     不給，不能給 '0'：詳情彈窗是用 !== undefined 判斷要不要印那一行的，
     給 0 會多出一句沒意義的「卷軸強化 0 次」。 */
  return list.concat([{
    item_equipment_slot: '機器人',
    item_equipment_part: '機器人',
    item_name: a.android_name,
    item_icon: a.android_icon,
    item_description: a.android_description,
    item_total_option: {},
    item_base_option: {},
    _fromAndroid: true,
  }]);
}

/** 寵物面板裡的一格。沒有圖就退成佔位文字，格子仍然佔位，版面才不會塌 */
function petCell(icon, name, placeholder) {
  const cell = el('div', 'eqcell' + (icon ? '' : ' empty'));
  if (icon) {
    cell.title = txt(name);
    cell.appendChild(iconImg(icon, 30, String(name || '?').slice(0, 2)));
  } else {
    cell.appendChild(el('span', 'eq-slotname', placeholder));
  }
  return cell;
}

/**
 * 寵物面板，排法照遊戲的 PET 視窗。
 *
 * 一隻寵物是一個 2×2 區塊：上排是寵物本體與牠的裝備，中間是名字，
 * 下排兩格是自動技能。沒有的技能格子照樣留著（遊戲裡是灰色的
 * 「PET SKILL」），少畫的話三隻寵物的下排會對不齊。
 *
 * 只放圖，詳細的技能清單、說明與到期日留在「寵物」分頁 —— 那些遊戲的
 * PET 視窗也沒有。
 */
function petPanel() {
  const pet = d('pet');
  if (!pet) return null;

  const box = el('div', 'petgrid');
  let any = 0;

  for (let i = 1; i <= 3; i++) {
    const p = (k) => pet['pet_' + i + '_' + k];
    if (!p('name')) continue;
    any++;

    const blk = el('div', 'petblk');

    const top = el('div', 'petblk-row');
    top.appendChild(petCell(p('icon'), p('name'), '寵物'));
    const eq = p('equipment') || {};
    top.appendChild(petCell(eq.item_icon, eq.item_name, '無裝備'));
    blk.appendChild(top);

    blk.appendChild(el('div', 'petblk-name', txt(p('nickname') || p('name'))));

    const a = p('auto_skill') || {};
    const bot = el('div', 'petblk-row');
    bot.appendChild(petCell(a.skill_1_icon, a.skill_1, 'PET SKILL'));
    bot.appendChild(petCell(a.skill_2_icon, a.skill_2, 'PET SKILL'));
    blk.appendChild(bot);

    box.appendChild(blk);
  }

  if (!any) return null;
  const panel = gamePanel('PET', box);
  panel.classList.add('gpanel-pet');
  return panel;
}

function overviewEquip() {
  const equip = d('equip');
  if (!equip || !Array.isArray(equip.item_equipment) || !equip.item_equipment.length) {
    return null;
  }

  /* 目前穿戴之外，API 另外回傳三組預設，實測三組內容都不一樣 */
  const presetArrays = [1, 2, 3].map((i) => {
    const arr = equip['item_equipment_preset_' + i];
    return (Array.isArray(arr) && arr.length) ? arr : null;
  });
  // 圖騰、拼圖、寶石不隨分頁換裝，補回各預設組，否則切過去會整批不見
  const fixed = presetFixedItems(equip.item_equipment, presetArrays.filter(Boolean));

  const defs = [{
    label: '目前穿戴',
    build: () => equipContent(withAndroid(equip.item_equipment)),
  }];
  presetLabels(3, equip.preset_no).forEach((label, i) => {
    const arr = presetArrays[i];
    if (arr) defs.push({ label: label, build: () => equipContent(arr.concat(fixed)) });
  });

  const panel = el('div', 'gpanel gpanel-eq');
  panel.appendChild(el('div', 'gpanel-head', 'EQUIPMENT'));
  const body = el('div', 'gpanel-body');
  body.appendChild(presetTabs(defs, 0));
  panel.appendChild(body);

  const col = el('div', 'ov-col ov-col-eq');
  col.appendChild(panel);
  return col;
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

/* ================================================================== *
 * 區塊收合
 *
 * 一次把所有資料攤開會很難讀（封測回饋：眼花撩亂），所以讓每個區塊
 * 標題都能點擊折疊，並且記住使用者的選擇。
 *
 * 各 render 函式是把「標題、內容、標題、內容…」平舖成兄弟節點的，
 * 沒有包容器。與其去改每一個 render，這裡在渲染完成後掃一次
 * DOM，把標題與其後續兄弟節點收成一組。新增區塊不用另外接線。
 * ================================================================== */

const FOLD_KEY = 'tms.folds';

function foldLoad() {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch (e) { return {}; }
}

function foldSave(key, closed) {
  const m = foldLoad();
  if (closed) m[key] = 1; else delete m[key];
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(m)); } catch (e) { /* 隱私模式 */ }
}

/**
 * 把 root 底下的區塊變成可收合。
 * scope 用來區分不同分頁的同名標題（例如各處都有「基本資訊」）。
 */
function collapsify(root, scope) {
  const groups = [];
  let cur = null;
  Array.from(root.children).forEach((n) => {
    if (n.classList && n.classList.contains('section-title')) {
      cur = { head: n, body: [] };
      groups.push(cur);
    } else if (cur) {
      cur.body.push(n);
    }
  });

  const real = groups.filter((g) => g.body.length);
  if (real.length < 2) return;   // 只有一個區塊，折了也沒意義

  const closedState = foldLoad();
  const sections = [];

  real.forEach((g) => {
    const sec = el('div', 'fold');
    root.insertBefore(sec, g.head);      // 先卡位，再把標題與內容搬進去
    g.head.classList.add('fold-head');
    g.head.setAttribute('role', 'button');
    g.head.tabIndex = 0;
    sec.appendChild(g.head);

    const body = el('div', 'fold-body');
    g.body.forEach((n) => body.appendChild(n));
    sec.appendChild(body);

    const key = scope + '|' + g.head.textContent.trim();
    if (closedState[key] === 1) sec.classList.add('closed');
    sections.push(sec);

    function toggle() {
      sec.classList.toggle('closed');
      foldSave(key, sec.classList.contains('closed'));
    }
    g.head.addEventListener('click', toggle);
    g.head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  // 區塊多的時候，一個一個點太累
  if (real.length >= 3) {
    const bar = el('div', 'fold-all');
    [['全部收合', true], ['全部展開', false]].forEach(([label, close]) => {
      const b = el('button', 'linkish', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        sections.forEach((sec, i) => {
          sec.classList.toggle('closed', close);
          foldSave(scope + '|' + real[i].head.textContent.trim(), close);
        });
      });
      bar.appendChild(b);
    });
    // 放在第一個區塊前面，而不是整個容器最上面 —— 比對頁前面還有
    // 角色卡與警告，擺在那之前會很突兀
    root.insertBefore(bar, sections[0]);
  }
}

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
/**
 * 圖騰、拼圖、寶石這類欄位不受裝備分頁管理 —— 遊戲裡切分頁不會把它們
 * 換掉，但 API 的 item_equipment_preset_N 陣列裡也不會有。結果就是選了
 * 預設組之後這些裝備整批消失（實測是 16 個欄位）。
 *
 * 這裡回傳「目前穿戴」裡屬於這類的裝備，好併回各預設組。
 *
 * 判斷方式是「三組預設都沒出現過這個欄位」，而不是寫死圖騰/拼圖/寶石
 * 的清單 —— 某一組剛好沒穿副武器，不代表副武器不受分頁管理；反過來
 * 日後遊戲新增別的不受管理欄位，這裡也不用改。
 */
function presetFixedItems(current, presetArrays) {
  const managed = new Set();
  (presetArrays || []).forEach((arr) => {
    (arr || []).forEach((it) => managed.add(it.item_equipment_slot));
  });
  if (!managed.size) return [];   // 沒有任何預設組資料就無從判斷
  return (current || []).filter((it) => !managed.has(it.item_equipment_slot));
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

  /* 一排 chip，不是八張卡。八張裡有六張跟上方角色卡一字不差 —— 同一份
     資料佔兩塊版面，手機上要多捲一整屏才看得到下面的能力值。 */
  f.appendChild(title('角色'));
  f.appendChild(idChips([
    ['世界', txt(basic.world_name)],
    ['職業', txt(basic.character_class)],
    ['轉職階段', txt(basic.character_class_level)],
    ['等級', basic.character_level ? 'Lv.' + basic.character_level : null],
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
    /* 屬性與裝備並排，跟遊戲裡兩個視窗開在一起一樣。桌機上屬性面板只有
       640px，右邊整片空著；窄螢幕自動疊回上下。 */
    f.appendChild(title('能力值與裝備'));
    const cols = el('div', 'ov-cols');

    const left = el('div', 'ov-col');
    left.appendChild(statGamePanel(stat));
    if (stat.remain_ap !== undefined) {
      left.appendChild(el('p', 'hint', '剩餘 AP：' + num(stat.remain_ap)));
    }
    cols.appendChild(left);

    const eq = overviewEquip();
    if (eq) cols.appendChild(eq);

    f.appendChild(cols);
    addErrors(f, ['equip']);

    const pets = petPanel();
    if (pets) {
      f.appendChild(title('寵物'));
      f.appendChild(pets);
    }

    /* 套裝效果是全域的，不隨預設組改變，所以放在兩欄外面 */
    const se = d('setEffect');
    if (se && Array.isArray(se.set_effect) && se.set_effect.length) {
      f.appendChild(title('套裝效果'));
      f.appendChild(kvGrid(se.set_effect
        .slice()
        .sort((a, b) => n0(b.total_set_count) - n0(a.total_set_count))
        .map((s) => [s.set_name, n0(s.total_set_count) + ' 件套'])));
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

  /* 潛能與性向並排。橫條拉滿整個寬度太長，雷達圖靠左又空掉右半邊，
     兩個湊成一列剛好。兩份資料總覽本來就抓了，不用多打 API。 */
  const abCol = (function () {
    if (!ability) return null;
    const defs = [];
    presetLabels(3, ability.preset_no).forEach((label, i) => {
      const p = ability['ability_preset_' + (i + 1)];
      const info = p && p.ability_info;
      if (!Array.isArray(info) || !info.length) return;
      defs.push({
        label: label + (p.ability_preset_grade ? '　' + p.ability_preset_grade : ''),
        build: () => abilityBars(info),
      });
    });

    let inner = null;
    if (defs.length) {
      inner = presetTabs(defs, Math.max(0, n0(ability.preset_no) - 1));
    } else if (Array.isArray(ability.ability_info)) {
      inner = abilityBars(ability.ability_info);
    }
    if (!inner) return null;

    const col = el('div', 'ov-col');
    col.appendChild(gamePanel('潛能能力（' + txt(ability.ability_grade) + '）', inner));
    if (ability.remain_fame !== undefined) {
      col.appendChild(el('p', 'hint', '剩餘名聲值：' + num(ability.remain_fame)));
    }
    return col;
  }());

  const prCol = propensity ? (function () {
    const col = el('div', 'ov-col');
    col.appendChild(gamePanel('性向', propensityRadar([
      ['領導力', propensity.charisma_level],
      ['感受性', propensity.sensibility_level],
      ['洞察力', propensity.insight_level],
      ['意志', propensity.willingness_level],
      ['手技', propensity.handicraft_level],
      ['魅力', propensity.charm_level],
    ])));
    return col;
  }()) : null;

  if (abCol || prCol) {
    f.appendChild(title('潛能與性向'));
    const cols = el('div', 'ov-cols ov-cols-even');
    if (abCol) cols.appendChild(abCol);
    if (prCol) cols.appendChild(prCol);
    f.appendChild(cols);
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

/* ---------- 靈魂武器 ---------- */

/**
 * 靈魂武器的資料。API 有兩代欄位，同一件裝備上會並存：
 *
 *   舊：soul_name（威爾的靈魂之類）、soul_option
 *   新：soul_weapon_grade / _level / _option / _power_increase
 *
 * 改版後的靈魂武器實測只填新的那組，soul_name 與 soul_option 是 null。
 * 舊角色資料反過來只有舊的，所以兩組都要看，不能只認一邊。
 *
 * 遊戲畫面上還有「經驗 376/1704」「靈魂的鬥志」「各BOSS獲得量」與碎片存量，
 * 這些 API 都不給，抓不到就是抓不到，不要自己編一個進度條出來。
 */
function soulWeapon(it) {
  if (!it) return null;
  const s = {
    grade: it.soul_weapon_grade || '',
    level: it.soul_weapon_level || '',
    option: it.soul_weapon_option || it.soul_option || '',
    power: n0(it.soul_weapon_power_increase),
    name: it.soul_name || '',
  };
  // 全空就是沒有靈魂武器。等級 0 也算有，畢竟階級與烙印可能已經在了
  if (!s.grade && !s.level && !s.option && !s.power && !s.name) return null;
  return s;
}

/** 一行摘要，給裝備卡片用 */
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
  const soul = soulWeapon(it);
  if (soul) {
    const box = el('div', 'tip-soul');
    const sh = el('div', 'soulhead');
    sh.appendChild(el('span', null, '靈魂武器'));
    if (soul.grade) sh.appendChild(el('span', 'soulgrade', soul.grade + ' 階'));
    if (soul.level) sh.appendChild(el('span', 'soullv', 'Lv.' + soul.level));
    box.appendChild(sh);

    if (soul.name) box.appendChild(el('div', null, soul.name));
    if (soul.option) {
      const o = el('div', 'soulopt');
      o.appendChild(el('span', 'soulopt-lab', '烙印'));
      o.appendChild(document.createTextNode(soul.option));
      box.appendChild(o);
    }
    if (soul.power) {
      const r = el('div', 'soulopt');
      r.appendChild(el('span', 'soulopt-lab', '共鳴'));
      r.appendChild(document.createTextNode('物理攻擊力／魔法攻擊力 +' + num(soul.power)));
      box.appendChild(r);
    }
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
/* 位置照遊戲的裝備視窗，七欄六列。角色圖佔第 3～5 欄的第 1～4 列，
   所以上半每列只有 c1、c2、c6、c7 四格；第五列開始才是通欄。

   對應是照著遊戲畫面逐格核對來的，不是從圖示猜的 —— 遊戲的格子沒有
   文字標籤，用猜的只會把裝備排到錯的位置。

   欄位名要用 API 的原字串：褲子是「褲/裙」、副武器是「輔助武器」、
   肩膀是「肩膀裝飾」、心臟是「機器心臟」。 */
const EQUIP_GRID = [
  //  c1        c2        c6          c7
  ['戒指1',   '臉飾',   '帽子',     '披風'],
  ['戒指2',   '眼飾',   '上衣',     '手套'],
  ['戒指3',   '耳環',   '褲/裙',    '鞋子'],
  ['戒指4',   '墜飾',   '肩膀裝飾', '勳章'],
];

/* 第五、六列通欄。第六列只有頭尾兩格有東西，中間留空格佔位 ——
   桌機上位置才對得上，手機上那些空格會被收掉（見 style.css）。 */
const EQUIP_ROWS_WIDE = [
  ['腰帶', '墜飾2', '武器', '輔助武器', '徽章', '機器人', '機器心臟'],
  ['口袋道具', '', '', '', '', '', '胸章'],
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

  /* 上半四列：角色圖左邊兩欄（1、2）、右邊兩欄（6、7） */
  EQUIP_GRID.forEach((row, r) => {
    const cols = [1, 2, 6, 7];
    row.forEach((slot, i) => {
      if (slot) used.add(slot);
      const cell = equipCell(slot, bySlot[slot]);
      cell.style.gridColumn = cols[i];
      cell.style.gridRow = r + 1;
      box.appendChild(cell);
    });
  });

  /* 中央角色圖：三欄寬、四列高的大方塊，跟遊戲一樣 */
  const basic = d('basic') || {};
  const mid = el('div', 'eqpreview');
  mid.style.gridColumn = '3 / span 3';
  mid.style.gridRow = '1 / span ' + EQUIP_GRID.length;
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

  /* 下半的通欄格子放在另一個容器。同一個格線的話手機版沒辦法各自處理 ——
     上半要把角色圖那三欄收成 0（圖藏起來、左右四格才夠大按），可是下半
     正好要用到那三欄，收成 0 會把三格壓扁。分開之後上半照舊 2+2，
     下半自己換行。桌機上兩個都是七欄、間距相同，看起來仍是一整片。 */
  const wide = el('div', 'eqgrid eqgrid-wide');
  EQUIP_ROWS_WIDE.forEach((row) => row.forEach((slot) => {
    if (slot) used.add(slot);
    // 空字串要照樣放一格佔位，不然後面的欄位會整排往前擠
    wide.appendChild(equipCell(slot, bySlot[slot]));
  }));

  const out = frag();
  out.appendChild(box);
  if (wide.children.length) out.appendChild(wide);
  return out;
}

/**
 * 一組裝備的內容：格線 + 圖騰／拼圖 + 版面表沒涵蓋到的欄位。
 *
 * 原本這裡還有「詳細清單」檢視，把每件裝備攤成一張張卡片。拿掉了 ——
 * 那些數值點格子就看得到，而且彈窗裡拆得比清單細（基礎／追加／卷軸／
 * 星力四段），清單只是同一份資料的較差版本。
 */
function equipContent(items) {
  const viewGrid = el('div', 'eqcontent');
  const bySlot = {};
  items.forEach((it) => { bySlot[it.item_equipment_slot] = it; });

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

  return viewGrid;
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

/** 核心連到哪些技能。欄位有時是字串，有時是 { hexa_skill_id } */
function hexaLinkedNames(c) {
  return (c.linked_skill || [])
    .map((l) => (typeof l === 'string' ? l : (l.hexa_skill_id || l.skill_name)))
    .filter(Boolean);
}

/** 核心的圖示：先用核心名找，找不到再退而用第一個對得上的連結技能 */
function hexaCoreIcon(c, icons) {
  if (!c || !icons) return null;
  if (icons[c.hexa_core_name]) return icons[c.hexa_core_name];
  for (const n of hexaLinkedNames(c)) {
    if (icons[n]) return icons[n];
  }
  return null;
}

function hexaCard(c, icons) {
  const linked = hexaLinkedNames(c);
  const icon = hexaCoreIcon(c, icons);

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

/* ---------- 六轉進度 ---------- */

/** 核心滿級 */
const HEXA_CORE_MAX = 30;

/** 能力值核心的等級上限。實測 stat_grade 就是主 + 副1 + 副2 的總和（8+4+8=20） */
const HEXA_STAT_MAX = 20;
const HEXA_STAT_SLOTS = 3;

/**
 * 各類型核心的「應該有幾個」。
 *
 * API 只回已經開出來的核心，沒開的整筆不會出現，所以光看回應分不出
 * 「4 個精通核心都滿級」與「只開了 1 個而且滿級」—— 兩者算出來都是 100%。
 * 要算進度就得有分母，這份數量是目前台版的配置（實測 2/4/4/2，共 12 個）。
 *
 * 改版增減核心時改這裡。實際抓到比預期多時以實際為準，表沒跟上也不會把
 * 進度算成超過 100%。
 */
const HEXA_EXPECT = { 技能核心: 2, 精通核心: 4, 強化核心: 4, 共用核心: 2 };

/**
 * 升一級要花多少（靈魂艾爾達, 靈魂艾爾達碎片）。索引 i＝第 i 級升到 i+1 級，
 * 所以 [0] 是還沒開啟的核心要付的開啟費用。
 *
 * 數字來自 MapleStory Wiki 的 HEXA Matrix 頁。抽查對得上兩個獨立來源：
 * 技能核心 29→30 是 20 艾爾達 + 500 碎片（台版討論串），5 轉共用強化核心
 * 0→30 合計 137 / 4,035（namu wiki）。
 *
 * 官方 API 不回傳耗量，只回等級，所以這張表是寫死的；改版調整費用時要跟著改。
 */
const HEXA_COST = {
  /* 起源與昇華除了 0→1 的開啟費用之外每一級都一樣，這裡取昇華的開啟費用：
     起源是免費的而且人人都有，缺的那個必然是昇華。 */
  技能核心: [
  [5,100],[1,30],[1,35],[1,40],[2,45],[2,50],[2,55],[3,60],[3,65],[10,200],
  [3,80],[3,90],[4,100],[4,110],[4,120],[4,130],[4,140],[4,150],[5,160],
  [15,350],[5,170],[5,180],[5,190],[5,200],[5,210],[6,220],[6,230],[6,240],
  [7,250],[20,500],
  ],
  精通核心: [
  [3,50],[1,15],[1,18],[1,20],[1,23],[1,25],[1,28],[2,30],[2,33],[5,100],
  [2,40],[2,45],[2,50],[2,55],[2,60],[2,65],[2,70],[2,75],[3,80],[8,175],
  [3,85],[3,90],[3,95],[3,100],[3,105],[3,110],[3,115],[3,120],[4,125],
  [10,250],
  ],
  強化核心: [
  [4,75],[1,23],[1,27],[1,30],[2,34],[2,38],[2,42],[3,45],[3,49],[8,150],
  [3,60],[3,68],[3,75],[3,83],[3,90],[3,98],[3,105],[3,113],[4,120],
  [12,263],[4,128],[4,135],[4,143],[4,150],[4,158],[5,165],[5,173],[5,180],
  [6,188],[15,375],
  ],
  共用核心: [
  [7,125],[2,38],[2,44],[2,50],[3,57],[3,63],[3,69],[5,75],[5,82],[14,300],
  [5,110],[5,124],[6,138],[6,152],[6,165],[6,179],[6,193],[6,207],[7,220],
  [17,525],[7,234],[7,248],[7,262],[7,275],[7,289],[9,303],[9,317],[9,330],
  [10,344],[20,750],
  ],
};

const HEXA_TYPE_ORDER = ['技能核心', '精通核心', '強化核心', '共用核心'];

function hexaTypeRank(t) {
  const i = HEXA_TYPE_ORDER.indexOf(t);
  return i < 0 ? 99 : i;
}

/** 等級欄位偶爾是字串，統一轉成整數，壞值算 0。小數會被當成費用表的索引，所以要砍掉 */
function lvNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * 台版還沒實裝、但海外版已經公布的核心。
 *
 * 這裡刻意跟 HEXA_EXPECT 分開放：併進預期數量的話，所有人的完成度會無故
 * 掉一截，可是那不是他們沒練，是遊戲還沒開。所以進度與「還差」都只算現有
 * 內容，未開放的另外列一塊。
 *
 * 台版實裝那天要做一件事：把這筆從 HEXA_UPCOMING 拿掉，改成
 * HEXA_EXPECT.共用核心 2 -> 3。
 *
 * 只靠自動判斷不夠。已經開出這顆核心的人確實會走一般流程被算進分母
 * （commonCoreKind() 認得出來，這一塊也會自己消失），但實裝後還沒去開的人
 * 分母不會變 —— 那時候正確的顯示是「尚未開啟 1 個」，不是「台版未開放」。
 *
 * 費用表來自 MapleStory Wiki 的 HEXA Matrix → Common Nodes →
 * 5th Job Common Node Boosts，0→30 合計 137 / 4,035。
 */
const HEXA_COMMON3_COST = [
  [4,90],[1,25],[1,30],[1,35],[2,40],[2,45],[2,50],[3,55],[3,60],[9,180],
  [3,73],[3,81],[3,90],[3,98],[4,107],[4,115],[4,124],[4,132],[4,141],
  [14,315],[4,151],[5,160],[5,170],[5,179],[5,189],[5,198],[5,208],[5,217],
  [6,227],[18,450],
];

const HEXA_UPCOMING = [{
  type: '共用核心',
  name: '第三共用核心',
  note: '強化 5 轉共用技能',
  source: '海外版 v253（2026/08/18）公布',
  cost: HEXA_COMMON3_COST,
}];

/**
 * 職業 -> 第三共用核心的技能名（海外版 v253）。
 *
 * 用正規表示式而不是完全比對：官方回的職業名各版本寫法不一（標點、
 * 「大魔導士」之類的後綴），寫死字串很容易全部對不上。對不上就不顯示
 * 技能名，其餘照常，所以猜錯的代價只是少一行字。
 */
const HEXA_COMMON3_SKILL = [
  [/陰陽師|劍豪/,                         '綻放黎明 VI'],
  [/墨玄|琳/,                             '輪迴 VI'],
  [/英雄|聖騎士|黑騎士/,                   '閃擊護盾 VI'],
  [/火.?毒|冰.?雷|主教/,                   '奧義解放 VI'],
  [/箭神|神射手|開拓者/,                   '靈禽覺醒 VI'],
  [/夜使者|暗影神偷|双刀|雙刀/,            '究極隱身術 VI'],
  [/拳霸|槍神|重砲指揮官/,                 '海盜旗幟 VI'],
  [/米哈逸|破曉者|曉之劍士|烈焰巫師|火焰巫師|風靈使者|風之射手|夜行者|閃雷悍將|雷之打手/,
                                          '皇家騎士方陣 VI'],
  [/阿蘭|伊班|蜜兒|幻影俠盜|隱月|路米那斯/, '佛雷德的守護 VI'],
  [/惡魔殺手|惡魔復仇者/,                  '召喚瑪斯提馬 VI'],
  [/爆拳槍神|戰鬥法師|狂狼勇士|傑諾|機械師/, '反抗軍列兵 VI'],
  [/凱撒|凱因|卡蒂娜|天使破壞者/,           '萬神殿 VI'],
  [/阿黛爾|伊利恩|卡莉|阿克/,               '魔力迴路全開 VI'],
  [/蓮|菈菈|虎影/,                         '蓮花 VI'],
  [/神之子/,                               '超越 VI'],
  [/凱內西斯/,                             '異界殘像 VI'],
];

function hexaCommon3Skill(cls) {
  if (!cls) return null;
  for (const [re, skill] of HEXA_COMMON3_SKILL) {
    if (re.test(cls)) return skill;
  }
  return null;
}

/**
 * 共用核心有兩種，費用差很多（索爾 208/6,268、5 轉共用強化 137/4,035），
 * 但 API 兩種都回 hexa_core_type: '共用核心'，只能靠名字分。
 */
function commonCoreKind(name) {
  // 名字缺漏時當索爾 —— 分母預期的那兩顆就是索爾，猜這邊才不會把費用低估
  if (!name) return 'sol';
  return /雅努斯|赫卡忒|傑納斯|Janus|Hecate/i.test(name) ? 'sol' : 'boost';
}

/** 這顆核心該用哪張費用表。共用核心要再看名字分兩種 */
function hexaCostTable(type, name) {
  if (type === '共用核心' && commonCoreKind(name) === 'boost') return HEXA_COMMON3_COST;
  return HEXA_COST[type] || null;
}

/**
 * 從 level 升到滿級還要花多少。未知核心類型沒有費用表，回 null。
 */
function hexaRemain(type, level, name) {
  const tbl = hexaCostTable(type, name);
  if (!tbl) return null;
  const from = Math.max(0, Math.min(lvNum(level), HEXA_CORE_MAX));
  let erda = 0, frag = 0;
  for (let i = from; i < tbl.length; i++) { erda += tbl[i][0]; frag += tbl[i][1]; }
  return { erda: erda, frag: frag };
}

/** 「下一步最划算」要排幾級 */
const HEXA_PLAN_STEPS = 20;

/**
 * 接下來 HEXA_PLAN_STEPS 級最省碎片的點法。
 *
 * 不能用貪心。每 10 級有一次費用尖峰，貪心會為了閃尖峰跑去點別顆，
 * 結果尖峰照付、尖峰後面便宜的那一段又沒吃到，排出來的 20 級比最佳解貴
 * 一成以上。所以改成背包 DP：一顆核心「再點 k 級」的花費就是費用表的
 * 前綴和，在總級數 = HEXA_PLAN_STEPS 的限制下湊出碎片最少的組合。
 * 核心最多十幾顆、只排 20 級，格子小到直接算完就好。
 *
 * 算的是【等級效率】，不是傷害效率。哪一顆核心對輸出貢獻大要有職業技能
 * 係數才算得出來，API 不給，所以這裡不假裝知道 —— 畫面上也講明白。
 */
function hexaPlan(cores, types) {
  const cand = [];

  (cores || []).forEach((c) => {
    const t = c.hexa_core_type || '其他';
    const tbl = hexaCostTable(t, c.hexa_core_name);
    if (!tbl) return;                       // 沒有費用表就排不進來
    const lv = Math.max(0, Math.min(lvNum(c.hexa_core_level), HEXA_CORE_MAX));
    if (lv >= HEXA_CORE_MAX) return;
    cand.push({ name: c.hexa_core_name, type: t, lv: lv, tbl: tbl, src: c });
  });

  /* 預期有但還沒開的，第一步就是開啟費用（費用表的 [0]）。
     同一類缺兩顆以上就編號 —— 名字一樣的話表格會出現兩列「0 → 1」，
     看起來像重複的 bug，也分不出是哪一顆。 */
  types.forEach((g) => {
    const tbl = hexaCostTable(g.type, '');
    if (!tbl) return;
    const n = g.target - g.have;
    for (let i = 0; i < n; i++) {
      cand.push({
        name: '新開的' + g.type + (n > 1 ? ' #' + (i + 1) : ''),
        type: g.type, lv: 0, tbl: tbl, src: null,
      });
    }
  });
  if (!cand.length) return [];

  // pre[k] = 這顆再點 k 級要幾片。k 最多排到 HEXA_PLAN_STEPS 或滿級
  cand.forEach((c) => {
    const pre = [0];
    for (let k = 1; k <= HEXA_PLAN_STEPS && c.lv + k <= HEXA_CORE_MAX; k++) {
      pre.push(pre[k - 1] + c.tbl[c.lv + k - 1][1]);
    }
    c.pre = pre;
  });

  // 剩不到 HEXA_PLAN_STEPS 級可點的話，有幾級就排幾級
  let total = 0;
  cand.forEach((c) => { total += c.pre.length - 1; });
  total = Math.min(total, HEXA_PLAN_STEPS);
  if (!total) return [];

  // dp[j] = 前面幾顆核心一共點 j 級的最少碎片；take[i][j] 記第 i 顆點了幾級
  let dp = new Array(total + 1).fill(Infinity);
  dp[0] = 0;
  const take = [];
  cand.forEach((c) => {
    const next = new Array(total + 1).fill(Infinity);
    const pick = new Array(total + 1).fill(0);
    for (let j = 0; j <= total; j++) {
      for (let k = 0; k < c.pre.length && k <= j; k++) {
        if (dp[j - k] === Infinity) continue;
        const v = dp[j - k] + c.pre[k];
        if (v < next[j]) { next[j] = v; pick[j] = k; }
      }
    }
    dp = next;
    take.push(pick);
  });

  // 倒著把每顆分到幾級撈回來，再轉正 —— 一模一樣的核心（例如同一類的兩顆
  // 未開啟）平手時照原順序挑，編號才會從 #1 開始排
  const left = [];
  let rest = total;
  for (let i = cand.length - 1; i >= 0; i--) {
    const k = take[i][rest];
    if (k > 0) left.push({ c: cand[i], lv: cand[i].lv, n: k });
    rest -= k;
  }
  left.reverse();

  /* 先後順序不影響總花費，純粹是呈現：每次挑「當下最便宜的下一級」，
     同一顆的等級才會連續往上，看起來也才像真的照著點。 */
  const out = [];
  let erda = 0, frag = 0;
  while (out.length < total) {
    let best = null;
    left.forEach((s) => {
      if (!s.n) return;
      const cost = s.c.tbl[s.lv];
      if (!best || cost[1] < best.cost[1]) best = { s: s, cost: cost };
    });
    if (!best) break;

    const s = best.s, cost = best.cost;
    erda += cost[0];
    frag += cost[1];
    out.push({
      name: s.c.name, type: s.c.type, from: s.lv, to: s.lv + 1,
      erda: cost[0], frag: cost[1], cumErda: erda, cumFrag: frag, src: s.c.src,
    });
    s.lv += 1;
    s.n -= 1;
  }
  return out;
}

/**
 * 算六轉進度。
 *
 * 分母一律用「滿級」而不是「目前總和」，沒開的核心也算進去。
 * 回傳 { types, core, stat, low }。
 */
function hexaProgress(cores, stat, cls) {
  const byType = {};
  const low = [];

  /* 台版已經開了的話就走一般流程，這一塊不用再提 */
  const opened = {};
  (cores || []).forEach((c) => {
    if ((c.hexa_core_type || '') === '共用核心') {
      opened[commonCoreKind(c.hexa_core_name)] = true;
    }
  });

  (cores || []).forEach((c) => {
    const t = c.hexa_core_type || '其他';
    const g = byType[t] || (byType[t] = { type: t, have: 0, sum: 0, done: 0 });
    const level = lvNum(c.hexa_core_level);
    g.have += 1;
    g.sum += Math.min(level, HEXA_CORE_MAX);
    if (level >= HEXA_CORE_MAX) g.done += 1;
    else low.push({ name: c.hexa_core_name, type: t, level: level,
                   need: hexaRemain(t, level, c.hexa_core_name), src: c });
  });

  // 預期有、但一個都還沒開的類型也要進分母，不然整類漏掉反而看不出來
  Object.keys(HEXA_EXPECT).forEach((t) => {
    if (!byType[t]) byType[t] = { type: t, have: 0, sum: 0, done: 0 };
  });

  const types = Object.keys(byType)
    .sort((a, b) => hexaTypeRank(a) - hexaTypeRank(b))
    .map((t) => {
      const g = byType[t];
      g.target = Math.max(HEXA_EXPECT[t] || 0, g.have);
      g.max = g.target * HEXA_CORE_MAX;
      return g;
    });

  const core = { sum: 0, max: 0, have: 0, target: 0, done: 0,
                 erda: 0, frag: 0, unknown: 0 };
  types.forEach((g) => {
    core.sum += g.sum; core.max += g.max;
    core.have += g.have; core.target += g.target; core.done += g.done;
  });

  /* 還差多少材料。已開啟的核心從目前等級往上加，還沒開啟的從 0 起算
     —— 開啟費用（費用表的 [0]）也是要付的。 */
  low.forEach((c) => {
    if (c.need) { core.erda += c.need.erda; core.frag += c.need.frag; }
    else core.unknown += 1;
  });
  types.forEach((g) => {
    const missing = g.target - g.have;
    if (missing <= 0) return;
    // 沒開啟的核心沒有名字可查，共用核心會落回索爾的費用表（見 commonCoreKind）
    const need = hexaRemain(g.type, 0);
    if (need) { core.erda += need.erda * missing; core.frag += need.frag * missing; }
    else core.unknown += missing;
  });

  const statCores = [];
  [['character_hexa_stat_core', 'I'],
   ['character_hexa_stat_core_2', 'II'],
   ['character_hexa_stat_core_3', 'III']].forEach(([key, label]) => {
    ((stat && stat[key]) || []).forEach((c) => {
      // 三個等級加起來才是這顆核心的進度；stat_grade 只在等級欄位缺漏時當備援
      const bySum = lvNum(c.main_stat_level)
                  + lvNum(c.sub_stat_level_1)
                  + lvNum(c.sub_stat_level_2);
      statCores.push({ label: label, sum: bySum || lvNum(c.stat_grade) });
    });
  });

  const statSlots = Math.max(HEXA_STAT_SLOTS, statCores.length);
  const st = {
    cores: statCores,
    have: statCores.length,
    slots: statSlots,
    sum: statCores.reduce((a, c) => a + Math.min(c.sum, HEXA_STAT_MAX), 0),
    max: statSlots * HEXA_STAT_MAX,
  };

  low.sort((a, b) => a.level - b.level
    || hexaTypeRank(a.type) - hexaTypeRank(b.type));

  /* 未開放的核心。不併進 core，否則所有人的完成度會無故掉一截 */
  const upcoming = HEXA_UPCOMING
    .filter((u) => !(u.type === '共用核心' && opened.boost))
    .map((u) => {
      const erda = u.cost.reduce((a, r) => a + r[0], 0);
      const frag = u.cost.reduce((a, r) => a + r[1], 0);
      return { type: u.type, name: u.name, note: u.note, source: u.source,
               skill: hexaCommon3Skill(cls), erda: erda, frag: frag };
    });

  return { types: types, core: core, stat: st, low: low, upcoming: upcoming,
           plan: hexaPlan(cores, types) };
}

/** 進度條。滿了另外標 class，但滿級與否同時也有文字，不只靠顏色 */
function hexaBar(cur, max) {
  const bar = el('div', 'hxp-bar' + (max > 0 && cur >= max ? ' full' : ''));
  const fill = el('i');
  fill.style.width = (max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0) + '%';
  bar.appendChild(fill);
  return bar;
}

/** 差一點點時不進位到 100% —— 那會讓人以為已經滿了 */
function hexaPct(cur, max) {
  if (!max) return '—';
  if (cur >= max) return '100%';
  return Math.min(99.9, Math.round((cur / max) * 1000) / 10) + '%';
}

function hexaProgRow(name, cur, max, note) {
  const row = el('div', 'hxp-row');

  const label = el('div', 'hxp-name');
  label.appendChild(el('span', null, name));
  if (note) label.appendChild(el('span', 'hxp-note', note));
  row.appendChild(label);

  row.appendChild(hexaBar(cur, max));

  const val = el('div', 'hxp-val');
  val.appendChild(el('b', null, num(cur) + ' / ' + num(max)));
  val.appendChild(el('span', null, cur >= max && max > 0 ? '滿級' : hexaPct(cur, max)));
  row.appendChild(val);

  return row;
}

function renderHexaProgress(cores, stat, icons, cls) {
  const p = hexaProgress(cores, stat, cls);
  const f = frag();
  f.appendChild(title('六轉進度'));

  /* ---- 總計 ---- */
  const top = el('div', 'hxp-top');
  top.appendChild(el('div', 'hxp-pct', hexaPct(p.core.sum, p.core.max)));

  const info = el('div', 'hxp-topinfo');
  info.appendChild(el('div', 'hxp-toplabel', '核心等級'));
  info.appendChild(el('div', 'hxp-topnum',
    num(p.core.sum) + ' / ' + num(p.core.max) + ' 級'));
  info.appendChild(hexaBar(p.core.sum, p.core.max));

  const left = p.core.max - p.core.sum;
  info.appendChild(el('div', 'hxp-topsub', left > 0
    ? ('還差 ' + num(left) + ' 級　·　已滿級 ' + p.core.done + ' / ' + p.core.target + ' 個核心')
    : ('全部 ' + p.core.target + ' 個核心都已滿級')));
  top.appendChild(info);
  f.appendChild(top);

  /* ---- 分類 ---- */
  const rows = el('div', 'hxp-rows');
  p.types.forEach((g) => {
    rows.appendChild(hexaProgRow(
      g.type, g.sum, g.max,
      g.have < g.target ? ('尚未開啟 ' + (g.target - g.have) + ' 個') : (g.have + ' 個')
    ));
  });

  if (p.stat.max) {
    rows.appendChild(hexaProgRow(
      'HEXA 能力值', p.stat.sum, p.stat.max,
      p.stat.have < p.stat.slots
        ? ('尚未開啟 ' + (p.stat.slots - p.stat.have) + ' 組')
        : (p.stat.have + ' 組')
    ));
  }
  f.appendChild(rows);

  /* ---- 還差多少材料 ---- */
  if (p.core.erda || p.core.frag) {
    const need = el('div', 'hxp-need');
    need.appendChild(el('span', 'hxp-need-label', '還差'));
    [['靈魂艾爾達', p.core.erda], ['碎片', p.core.frag]].forEach(([k, v]) => {
      const cell = el('div', 'hxp-need-item');
      cell.appendChild(el('span', 'k', k));
      cell.appendChild(el('b', null, num(v)));
      need.appendChild(cell);
    });
    // 未知類型沒有費用表，寧可講明白也不要讓總數看起來是全部
    if (p.core.unknown) {
      need.appendChild(el('div', 'hxp-need-warn',
        '（不含 ' + p.core.unknown + ' 個沒有費用表的核心）'));
    }
    f.appendChild(need);
  }

  /* ---- 接下來最划算的順序 ---- */
  if (p.plan.length) {
    const det = el('details', 'exp-table hxp-plan');
    det.appendChild(el('summary', null, '下一步最划算（接下來 ' + p.plan.length + ' 級）'));

    const wrap = el('div', 'tablewrap');
    const table = el('table', 'rank');
    const thead = el('thead');
    const th = el('tr');
    ['#', '核心', '等級', '這一級', '累計'].forEach((h) => th.appendChild(el('th', null, h)));
    thead.appendChild(th);
    table.appendChild(thead);

    const tb = el('tbody');
    p.plan.forEach((step, i) => {
      const tr = el('tr');
      tr.appendChild(el('td', 'hxp-plan-n', String(i + 1)));

      const nameTd = el('td', 'rank-name');
      const box = el('span', 'hxp-plan-name');
      box.appendChild(iconImg(hexaCoreIcon(step.src, icons), 20));
      box.appendChild(el('span', null, txt(step.name)));
      nameTd.appendChild(box);
      nameTd.appendChild(el('small', 'cmp-note', step.type));
      tr.appendChild(nameTd);

      tr.appendChild(el('td', 'hxp-plan-lv', step.from + ' → ' + step.to));
      tr.appendChild(el('td', 'hxp-plan-cost',
        '艾爾達 ' + num(step.erda) + '　碎片 ' + num(step.frag)));
      tr.appendChild(el('td', 'hxp-plan-cum',
        num(step.cumErda) + ' / ' + num(step.cumFrag)));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(table);
    det.appendChild(wrap);

    det.appendChild(el('p', 'hint',
      '這 ' + p.plan.length + ' 級是碎片花最少的組合 —— 不是每步挑最便宜的那種排法，'
      + '那樣會為了閃過每 10 級的費用尖峰跑去點別顆，尖峰照付、後面便宜的一段又沒吃到。'
      + '列的先後只是照「當下最便宜」排給你看，中途停手的話省下來的不一定最多。'
      + '這裡排的是【等級效率】，不是傷害效率：哪一顆對你的輸出貢獻大，'
      + '要有職業技能係數才算得出來，官方 API 不提供，所以這份順序不會告訴你那件事。'));

    f.appendChild(det);
  }

  /* ---- 台版還沒開放的核心 ---- */
  if (p.upcoming.length) {
    const box = el('div', 'hxp-soon');
    box.appendChild(el('div', 'hxp-soon-label', '台版未開放'));

    p.upcoming.forEach((u) => {
      const row = el('div', 'hxp-soon-row');

      const name = el('div', 'hxp-soon-name');
      name.appendChild(el('b', null, u.type + ' · ' + u.name));
      if (u.skill) name.appendChild(el('span', 'hxp-soon-skill', u.skill));
      name.appendChild(el('span', 'hxp-note', u.note));
      row.appendChild(name);

      row.appendChild(el('div', 'hxp-soon-cost',
        '開放後還要　靈魂艾爾達 ' + num(u.erda) + '　碎片 ' + num(u.frag)));

      row.appendChild(el('div', 'hxp-note', u.source));
      box.appendChild(row);
    });

    f.appendChild(box);
  }

  /* ---- 還沒滿的核心 ---- */
  if (p.low.length) {
    const det = el('details', 'exp-table hxp-todo');
    det.appendChild(el('summary', null, '未滿級核心（' + p.low.length + '）'));
    const list = el('div', 'hxp-todolist');
    p.low.forEach((c) => {
      const r = el('div', 'hxp-todorow');
      const n = el('span', 'hxp-todoname');
      n.appendChild(iconImg(hexaCoreIcon(c.src, icons), 22));
      n.appendChild(el('span', null, txt(c.name)));
      n.appendChild(el('span', 'hxp-note', c.type));
      r.appendChild(n);
      const right = el('span', 'hxp-todolv',
        'Lv.' + c.level + ' → ' + HEXA_CORE_MAX);
      if (c.need) {
        right.appendChild(el('span', 'hxp-note',
          '艾爾達 ' + num(c.need.erda) + '　碎片 ' + num(c.need.frag)));
      }
      r.appendChild(right);
      list.appendChild(r);
    });
    det.appendChild(list);
    f.appendChild(det);
  }

  return f;
}

function renderHexa() {
  const f = frag();
  const hexa = d('hexa');
  const hexaStat = d('hexaStat');

  const icons = skillIconMap(['skill6']);

  const cores = (hexa && Array.isArray(hexa.character_hexa_core_equipment))
    ? hexa.character_hexa_core_equipment : null;

  // 進度擺最前面 —— 卡片列表看得到每個核心幾級，但看不出「離全滿還有多遠」
  // 職業拿來對出第三共用核心是哪個技能；basic 首屏就抓過了，不會多打 API
  const cls = (d('basic') || {}).character_class
    || (hexaStat && hexaStat.character_class) || '';

  if (cores || hexaStat) {
    f.appendChild(renderHexaProgress(cores || [], hexaStat, icons, cls));
  }

  if (cores && cores.length) {

    /* 依核心類型分組 */
    const groups = {};
    cores.forEach((c) => {
      const t = c.hexa_core_type || '其他';
      (groups[t] = groups[t] || []).push(c);
    });

    const types = Object.keys(groups)
      .sort((a, b) => hexaTypeRank(a) - hexaTypeRank(b));

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

/**
 * 成長數字要留幾位小數。輸入是級份，位數是算給百分比用的。
 *
 * 以前直接拿「級份」顯示、且寫死兩位小數時會出事：Lv.295 一天只前進
 * 0.005～0.02 級，整欄被壓成 0.00／0.01／0.02 —— 實測某天練了 4.1 兆經驗、
 * 另一天只有 0.4 兆，差 10 倍卻都寫成「+0.00 級」，而圖表的長條高度是對的，
 * 兩邊就對不起來。改用百分比後同樣兩位小數就是 0.50%～2.00%，分得開了。
 * 位數還是跟著數量級走：低等級一天跳好幾級是 200% 以上，這時小數位只是雜訊。
 * 三段門檻由舊的 2／3／4 位換算而來，解析度仍是 1%／0.1%／0.01%。
 */
function pctDp(v) {
  const a = Math.abs(v) * 100;
  return a >= 100 ? 0 : a >= 10 ? 1 : 2;
}

/** 成長一律以「本級進度的百分比」呈現，跨等級時會超過 100% */
function fmtPct(v) {
  if (v === null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(pctDp(v)) + '%';
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
      // 「顯示成零」才算零，門檻得跟著 pctDp() 選的位數走，不能寫死
      const txt = fmtPct(r.gain);
      g.appendChild(el('span', 'el-gainval' + (parseFloat(txt) === 0 ? ' zero' : ''),
        '[' + txt + ']'));
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
  svg.setAttribute('aria-label', '每日經驗成長長條圖，單位為本級進度百分比');

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
    // 三條刻度共用一個位數（看最大值），不然上下標籤的小數位會參差
    t.textContent = (v * 100).toFixed(pctDp(hi || lo)) + '%';
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
      lab.textContent = (v * 100).toFixed(pctDp(v)) + '%';
      svg.appendChild(lab);
    }

    if (i % labelEvery === 0 || i === points.length - 1) {
      const t = mk('text', {
        x: x + barW / 2, y: H - padB + 18, class: 'axis', 'text-anchor': 'middle',
      });
      /* p.date 進來就已經是 draw() 切好的「08-21」或「今日」，別再切一次 ——
         '08-21'.slice(5) 是空字串，整條 x 軸的標籤會全部消失。 */
      t.textContent = p.date;
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
    tip.appendChild(el('div', 'tt-main', fmtPct(p.gain)));
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
  ['日期', '成長（%）', '等級', '升級', 'EXP 增減'].forEach((h) => {
    htr.appendChild(el('th', null, h));
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tb = el('tbody');
  points.slice().reverse().forEach((p) => {
    const tr = el('tr');
    tr.appendChild(el('td', null, p.date));
    tr.appendChild(el('td', null, fmtPct(p.gain)));
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

  /* 保留所有裝備頁，讓比對時可以切換 —— 有些角色目前穿戴的不是最強的那套。 */
  const cur = Array.isArray(eq.item_equipment) ? eq.item_equipment : [];
  const presetArrays = [];
  for (let i = 1; i <= 3; i++) {
    const arr = eq['item_equipment_preset_' + i];
    presetArrays.push(Array.isArray(arr) && arr.length ? arr : null);
  }

  /* 圖騰、拼圖、寶石不隨分頁換裝，但 preset 陣列裡沒有它們。
     不補回去的話，切到預設組就會整批變成「僅一方持有」。 */
  const fixed = presetFixedItems(cur, presetArrays.filter(Boolean));

  const sets = [];
  if (cur.length) {
    sets.push({ key: 'cur', label: '目前穿戴', items: cur });
  }
  presetArrays.forEach((arr, i) => {
    if (!arr) return;
    sets.push({
      key: 'p' + (i + 1),
      label: '預設 ' + (i + 1) + (n0(eq.preset_no) === i + 1 ? '（使用中）' : ''),
      items: arr.concat(fixed),
    });
  });

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

/* 圖騰與拼圖不在主裝備視窗裡（裝備分頁也不管理它們），數量又多
   —— 一個角色可以有 12 塊拼圖。夾在中間會把真正想看的武器、防具
   推到很下面，所以不管哪種配對模式，一律排到表格最後。 */
const CMP_TAIL = /^(圖騰|拼圖)\d*$/;

function cmpIsTail(row) {
  const slot = (row.ia && row.ia.item_equipment_slot)
            || (row.ib && row.ib.item_equipment_slot) || '';
  if (CMP_TAIL.test(slot)) return true;
  // 「圖騰 #1」「圖騰1 ↔ 圖騰2」這類合成標籤取第一段就夠判斷
  return CMP_TAIL.test(String(row.label || '').split(' ')[0]);
}

/** 穩定分割：非尾端的維持原順序，尾端的接在後面 */
function cmpTailLast(rows) {
  return rows.filter((r) => !cmpIsTail(r)).concat(rows.filter(cmpIsTail));
}

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

    return cmpTailLast(rows);
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

  return cmpTailLast(rows);
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

/* 逐格比對的資訊密度開關。潛能明細與換裝細項是最占版面的兩塊，
   關掉之後一列就剩下「誰的什麼裝備、換過來是升還是降」。
   用 CSS class 切，不重畫表格，所以切換是即時的。 */
const CMP_SHOW = [
  ['#cmpShowPot', 'hide-pot', 'tms.cmpShowPot'],
  ['#cmpShowSwap', 'hide-swap', 'tms.cmpShowSwap'],
  ['#cmpShowTail', 'hide-tail', 'tms.cmpShowTail'],
];

function cmpApplyShow() {
  const out = $('#cmpResult');
  if (!out) return;
  CMP_SHOW.forEach(([sel, cls, key]) => {
    const box = $(sel);
    if (!box) return;
    out.classList.toggle(cls, !box.checked);
    try { localStorage.setItem(key, box.checked ? '1' : '0'); } catch (e) { /* 隱私模式 */ }
  });
}

function cmpWireShow() {
  CMP_SHOW.forEach(([sel, , key]) => {
    const box = $(sel);
    if (!box) return;
    let v = null;
    try { v = localStorage.getItem(key); } catch (e) { /* 隱私模式 */ }
    if (v !== null) box.checked = v === '1';
    box.addEventListener('change', cmpApplyShow);
  });
  cmpApplyShow();
}

function cmpRender() {
  const out = $('#cmpResult');
  out.innerHTML = '';

  const nameA = $('#cmpA').value.trim();
  const nameB = $('#cmpB').value.trim();
  const a = cmpSide(nameA, $('#cmpSetA'));
  const b = cmpSide(nameB, $('#cmpSetB'));
  if (!a || !b) return;

  /* 兩邊挑到件數差很多的組合時，總和類的比較就不對等，要講清楚。
     圖騰／拼圖／寶石已在 cmpFetch 併回各預設組，不再是差距來源。 */
  if (Math.abs(a.count - b.count) >= 5) {
    const warn = el('div', 'cmp-warn');
    warn.appendChild(el('b', null, '兩邊裝備件數差距大'));
    warn.appendChild(el('div', null,
      a.name + '「' + a.setLabel + '」' + a.count + ' 件　vs　'
      + b.name + '「' + b.setLabel + '」' + b.count + ' 件。'));
    warn.appendChild(el('div', null,
      '件數差這麼多時，星力總和、卷軸平均這類「全身加總」的數字不對等，'
      + '看逐格比對比較準。'
      + '（圖騰、拼圖、寶石不隨分頁換裝，已自動併入各預設組，不是差距來源。）'));
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
    // 標記起來，讓「圖騰／拼圖」的顯示開關能純用 CSS 切換，免得重畫
    if (cmpIsTail(row)) tr.classList.add('cmp-row-tail');
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
    collapsify(out, 'cmp');
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

  collapsify(out, 'cmp');
  cmpApplyShow();
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

  cmpWireShow();
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

/**
 * 收藏的排前面，而且不會被上限擠掉。
 *
 * 名額還是總共 HIST_MAX 個 —— 收藏優先分配，剩下的給最近查詢。這樣
 * localStorage 不會無限長大，又不會出現「釘選了卻被新查詢頂掉」。
 * 順序直接存成「收藏在前」，所以 histRender 照著存的順序畫就好。
 *
 * 兩組各自再按最後查詢時間排。不排的話順序等於「傳進來的陣列長什麼樣」，
 * 那會跟著呼叫路徑跑 —— 收藏一個舊角色，它會停在原本的位置；但如果是從
 * histAdd 進來的同一個角色就會跑到最前面。同一個動作兩種結果，看起來像
 * 隨機。用 at 排就只有一種答案。舊版紀錄沒有 at，當成最舊。
 */
function histSave(list) {
  const byTime = (a, b) => (Number(b.at) || 0) - (Number(a.at) || 0);
  const favs = list.filter((h) => h.fav).sort(byTime).slice(0, HIST_MAX);
  const rest = list.filter((h) => !h.fav).sort(byTime)
    .slice(0, Math.max(0, HIST_MAX - favs.length));
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(favs.concat(rest)));
  } catch (e) { /* 隱私模式或空間不足就算了 */ }
}

/**
 * 查詢成功後補上角色資訊；同名的往前提，不重複。
 *
 * 收藏狀態與歷史最高戰鬥力要從舊那筆搬過來 —— 它們是累積下來的，
 * 不能被這次查詢的結果蓋掉。
 */
function histAdd(name, basic, stat) {
  const prev = histLoad().filter((h) => h.name === name)[0] || {};
  const list = histLoad().filter((h) => h.name !== name);

  const cpRaw = stat && Array.isArray(stat.final_stat)
    ? (stat.final_stat.filter((r) => r.stat_name
        && r.stat_name.indexOf('戰鬥力') !== -1)[0] || {}).stat_value
    : null;
  const cp = Number(cpRaw);
  const cpOk = Number.isFinite(cp) && cp > 0;

  list.unshift({
    name: name,
    world: (basic && basic.world_name) || '',
    cls: (basic && basic.character_class) || '',
    level: (basic && basic.character_level) || '',
    guild: (basic && basic.character_guild_name) || '',
    img: (basic && basic.character_image) || '',
    rate: (basic && basic.character_exp_rate) || '',
    cp: cpOk ? cp : (prev.cp || null),
    /* 歷史最高：API 沒有這個欄位，只能自己記。第一次查的時候等於現值，
       所以卡片上那一行會先不顯示 —— 沒有比較基準時印一次一樣的數字
       只是雜訊。 */
    cpMax: Math.max(cpOk ? cp : 0, Number(prev.cpMax) || 0) || null,
    fav: !!prev.fav,
    at: Date.now(),
  });
  histSave(list);
  histRender();
}

function histRemove(name) {
  histSave(histLoad().filter((h) => h.name !== name));
  histRender();
}

function histToggleFav(name) {
  histSave(histLoad().map((h) => (h.name === name ? Object.assign({}, h, { fav: !h.fav }) : h)));
  histRender();
}

function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '剛剛';
  if (s < 3600) return Math.floor(s / 60) + ' 分鐘前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小時前';
  return Math.floor(s / 86400) + ' 天前';
}

/**
 * 分享用的網址。開站時會讀 ?name=，所以貼給別人可以直接開。
 *
 * 不用 location.origin + pathname 組 —— file:// 的 origin 是字串 "null"，
 * 那樣會生出 "null/index.html?name=…"。從 href 砍掉問號與井號後面最實在。
 */
function charUrl(name) {
  const base = location.href.split('#')[0].split('?')[0];
  return base + '?name=' + encodeURIComponent(name);
}

/** 一格數值。副標（歷史最高）只在真的比現值高的時候給 */
function histStat(label, value, sub) {
  const box = el('div', 'hstat');
  box.appendChild(el('div', 'hstat-k', label));
  box.appendChild(el('div', 'hstat-v', value));
  if (sub) box.appendChild(el('div', 'hstat-sub', sub));
  return box;
}

/**
 * 一張卡片。
 *
 * 整張可點，但可點的部分是裡面那顆 .hcard-go 按鈕（頭像＋名字＋等級列），
 * 不是整張卡 —— 卡片裡還有收藏、分享、移除三顆按鈕，巢狀 button 是無效
 * HTML，而且鍵盤族會多出三個沒意義的停留點。滑鼠點空白處也想查詢，所以
 * 卡片本身另外掛一個 click，遇到 button 上的點擊就讓那顆按鈕自己處理。
 */
function histCard(h) {
  const card = el('div', 'hcard' + (h.fav ? ' fav' : ''));

  const go = el('button', 'hcard-go');
  go.type = 'button';
  go.title = h.at ? ('上次查詢：' + ago(h.at)) : '';

  const img = el('span', 'hcard-img');
  attachIcon(img, h.img, '🍁');
  go.appendChild(img);

  const idBox = el('span', 'hcard-id');
  idBox.appendChild(el('span', 'hcard-name', h.name));
  /* 舊版紀錄只存了世界／等級／職業，沒有公會與頭像 —— 有什麼就印什麼，
     不要因為缺欄位就整張卡片不畫。 */
  const meta = [h.level ? 'Lv' + h.level : '', h.world, h.guild || h.cls]
    .filter(Boolean).join(' | ');
  if (meta) idBox.appendChild(el('span', 'hcard-meta', meta));
  go.appendChild(idBox);
  card.appendChild(go);

  const rate = parseFloat(h.rate);
  const stats = el('div', 'hcard-stats');
  if (Number.isFinite(rate)) {
    stats.appendChild(histStat('經驗', rate.toFixed(2) + '%'));
  }
  if (h.cp) {
    stats.appendChild(histStat('戰鬥力', fmtBig(h.cp),
      (h.cpMax && h.cpMax > h.cp) ? ('MAX：' + fmtBig(h.cpMax)) : null));
  }
  if (stats.children.length) card.appendChild(stats);

  /* ---- 三顆按鈕 ---- */

  const fav = el('button', 'hcard-fav');
  fav.type = 'button';
  fav.title = h.fav ? '取消收藏' : '收藏（排在最前面，不會被新查詢擠掉）';
  fav.setAttribute('aria-label', (h.fav ? '取消收藏 ' : '收藏 ') + h.name);
  fav.setAttribute('aria-pressed', h.fav ? 'true' : 'false');
  const heart = icon('heart');
  if (h.fav) heart.setAttribute('class', 'ico ico-fill');
  fav.appendChild(heart);
  fav.addEventListener('click', () => histToggleFav(h.name));
  card.appendChild(fav);

  const share = el('button', 'hcard-share');
  share.type = 'button';
  share.title = '複製這個角色的網址';
  share.appendChild(iconText('share', '分享'));
  share.addEventListener('click', async () => {
    const done = (msg) => {
      share.textContent = msg;
      setTimeout(() => {
        share.textContent = '';
        share.appendChild(iconText('share', '分享'));
      }, 1600);
    };
    try {
      await navigator.clipboard.writeText(charUrl(h.name));
      done('已複製');
    } catch (e) {
      /* file:// 或沒授權時 clipboard 會被擋。網址還是要讓人拿得到，
         所以退而求其次塞進輸入框旁的提示，而不是無聲失敗。 */
      done('複製失敗');
      showError($('#status'), '無法寫入剪貼簿，網址：' + charUrl(h.name));
    }
  });
  card.appendChild(share);

  const del = el('button', 'hcard-x', '×');
  del.type = 'button';
  del.title = '從紀錄移除';
  del.setAttribute('aria-label', '從紀錄移除 ' + h.name);
  del.addEventListener('click', () => histRemove(h.name));
  card.appendChild(del);

  const run = () => {
    $('#nameInput').value = h.name;
    lookup(h.name, $('#dateInput').value);
  };
  go.addEventListener('click', run);
  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;   // 讓那顆按鈕自己處理
    run();
  });

  return card;
}

function histRender() {
  const box = $('#history');
  const list = histLoad();
  box.innerHTML = '';
  if (!list.length) return;

  const head = el('div', 'hist-head');
  head.appendChild(el('span', 'hist-label', '最近查詢（點卡片直接查詢）'));

  const clear = el('button', 'hist-clear', '清除全部');
  clear.type = 'button';
  clear.addEventListener('click', () => { histSave([]); histRender(); });
  head.appendChild(clear);
  box.appendChild(head);

  /* 橫捲一排，不是往下疊 —— 15 張卡片直排在手機上會把搜尋框整個推出畫面。
     分頁列已經是同一個做法。 */
  const strip = el('div', 'hist-cards');
  list.forEach((h) => strip.appendChild(histCard(h)));
  box.appendChild(strip);
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
    if (btn) {
      btn.textContent = '';
      btn.appendChild(iconText('ticket', '封測碼'));
      btn.title = '輸入封測通行碼';
    }
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
    s.appendChild(iconText('warn', HOSTED
      ? '尚未輸入封測碼，無法查詢角色 — '
      : '尚未設定 API 金鑰，無法查詢角色 — '));
    const a = el('a', null, '點此設定');
    a.href = '#';
    a.addEventListener('click', (ev) => { ev.preventDefault(); openModal(); });
    s.appendChild(a);
    setWelcome(true);
  } else {
    setWelcome(true);
  }

  /* 分享出去的網址（?name=）直接落在那個角色上。放在最後、而且只在金鑰
     可用時才跑 —— 沒有金鑰的話查詢一定失敗，那時該讓使用者看到上面那句
     「點此設定」，不是一個查不到角色的錯誤。 */
  const target = hasKey ? urlTarget() : null;
  if (target) {
    $('#nameInput').value = target.name;
    if (target.date) $('#dateInput').value = target.date;
    lookup(target.name, target.date);
  }
})();
