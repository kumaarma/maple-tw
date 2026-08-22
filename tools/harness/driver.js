/**
 * 測試驅動。模式寫在網址的 hash 裡：
 *
 *   #mode=tabs           角色查詢：依序點過每個分頁，各掃一次版面
 *   #mode=tab&i=1        只切到第 i 個分頁並停住（給截圖用）
 *   #mode=compare        裝備比對：三種配對模式的列順序與裝備頁內容
 *   #mode=fold           區塊收合與比對頁的顯示開關
 *   #mode=hexa           六轉進度：改寫核心等級後比對算出來的數字
 *   #mode=soul           靈魂武器：改版後的 soul_weapon_* 欄位有沒有顯示出來
 *
 * 結果寫進 #diag，由 runner.html 輪詢取走。
 */
(function () {
  var hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  var mode = hash.get('mode') || 'tabs';
  var NAME = (window.__FIX['character/basic'] || {})._.character_name;
  var log = [];

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.from(document.querySelectorAll(s)); }
  function done() { $('#diag').textContent = log.join('\n'); }

  function head() {
    log.push('可視寬=' + document.documentElement.clientWidth
      + ' 文件寬=' + document.documentElement.scrollWidth
      + '　角色=' + NAME);
  }

  /** 送出角色查詢並等結果 */
  async function lookup() {
    $('#nameInput').value = NAME;
    $('#searchForm').dispatchEvent(
      new Event('submit', { cancelable: true, bubbles: true }));
    for (var i = 0; i < 300 && $('#result').hidden; i++) await sleep(50);
    await sleep(500);
  }

  /* ================================================================ */

  async function runTabs() {
    await lookup();
    head();
    var tabs = $$('.tab');
    log.push('分頁數=' + tabs.length);
    checkTabA11y(tabs);
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].click();
      await sleep(700);
      log.push.apply(log, window.__scan('[' + tabs[i].textContent.trim() + ']'));
    }
  }

  /**
   * 分頁列的無障礙屬性。
   *
   * 這些東西壞掉的時候畫面完全正常 —— 滑鼠使用者一切照舊，只有鍵盤與
   * 螢幕閱讀器的人受影響，所以肉眼看不出來，只能用測的。
   *
   * roving tabindex 驗的是「整列只有一個 Tab 停留點」：11 個分頁都可以
   * Tab 的話，鍵盤使用者要按 11 次才跳得過這一列。
   */
  function checkTabA11y(tabs) {
    var list = $('.tabs');
    check('分頁列有 role=tablist', list ? list.getAttribute('role') : '（無）', 'tablist');

    var roles = tabs.filter(function (t) { return t.getAttribute('role') === 'tab'; });
    check('每顆分頁都有 role=tab', roles.length, tabs.length);

    var selected = tabs.filter(function (t) {
      return t.getAttribute('aria-selected') === 'true';
    });
    check('只有一顆標成 aria-selected', selected.length, 1);

    var focusable = tabs.filter(function (t) { return t.tabIndex === 0; });
    check('整列只有一個 Tab 停留點', focusable.length, 1);
    check('可聚焦的就是選中的那顆',
      focusable[0] === selected[0] ? '是' : '否', '是');

    var linked = tabs.filter(function (t) {
      var id = t.getAttribute('aria-controls');
      var p = id && document.getElementById(id);
      return p && p.getAttribute('aria-labelledby') === t.id;
    });
    check('分頁與面板互相指得到', linked.length, tabs.length);

    /* 左右鍵要真的換分頁。只驗按鍵有反應，不驗停在哪一顆 ——
       走到頭會繞回另一端，寫死索引反而綁死行為。 */
    var before = selected[0];
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown',
      { key: 'ArrowRight', bubbles: true, cancelable: true }));
    var after = $$('.tab').filter(function (t) {
      return t.getAttribute('aria-selected') === 'true';
    })[0];
    check('右方向鍵會換分頁', after && after !== before ? '會' : '不會', '會');
    check('換過去焦點也跟著走',
      document.activeElement === after ? '是' : '否', '是');

    var svgs = document.querySelectorAll('.ico use');
    check('圖示用 SVG sprite', svgs.length > 0 ? '是' : '否', '是');
  }

  async function runOneTab(idx) {
    await lookup();
    var tabs = $$('.tab');
    var t = tabs[idx] || tabs[0];
    t.click();
    await sleep(900);
    // 捲到分頁區，否則截圖只會拍到上面的角色卡
    var w = $('.tabs-wrap');
    if (w) window.scrollTo(0, w.getBoundingClientRect().top + window.scrollY - 4);
    await sleep(200);
    log.push('已切到 [' + t.textContent.trim() + ']');
  }

  /* ================================================================ */

  var PAIR_MODES = [
    ['value', '同類欄位依名稱配對'],
    ['name', '同一件裝備對比'],
    ['slot', '依欄位編號'],
  ];

  /** 這一列是不是圖騰／拼圖。標籤在 name 模式是道具名，所以要看欄位註記 */
  function isTailRow(tr) {
    var td = tr.querySelector('td.rank-name');
    if (!td) return false;
    var first = td.firstChild ? td.firstChild.textContent.trim() : '';
    if (/^(圖騰|拼圖)/.test(first)) return true;
    return /(^|：)(圖騰|拼圖)\d*(\s|　|$)/.test(td.textContent);
  }

  async function runCompare() {
    $('.navbtn[data-view="compare"]').click();
    $('#cmpA').value = NAME;
    $('#cmpB').value = NAME;
    $('#cmpForm').dispatchEvent(
      new Event('submit', { cancelable: true, bubbles: true }));
    for (var i = 0; i < 300; i++) {
      if ($('#cmpResult .cmp-table')) break;
      await sleep(50);
    }
    await sleep(400);
    head();

    /* ---- 各裝備頁的內容 ---- */
    var raw = CMP_DATA[NAME];
    log.push('');
    log.push('裝備頁（圖騰／拼圖／寶石不隨分頁換裝，應該每組都有）');
    raw.sets.forEach(function (s) {
      var slots = s.items.map(function (it) { return it.item_equipment_slot; });
      function count(re) { return slots.filter(function (x) { return re.test(x); }).length; }
      var totem = count(/^圖騰/);
      var puzzle = count(/^拼圖/);
      var gem = slots.filter(function (x) { return x === '寶石'; }).length;
      log.push('  ' + s.label + '　' + s.items.length + ' 件'
        + '　圖騰=' + totem + ' 拼圖=' + puzzle + ' 寶石=' + gem
        + (totem && puzzle && gem ? '  OK' : '  *** 缺漏 ***'));
    });

    /* ---- 三種配對模式的列順序 ---- */
    log.push('');
    log.push('逐格比對（圖騰／拼圖應該全部排在最後）');
    for (var m = 0; m < PAIR_MODES.length; m++) {
      var sel = $('#cmpPair');
      sel.value = PAIR_MODES[m][0];
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(600);

      var rows = $$('#cmpResult .cmp-table tbody tr');
      var flags = rows.map(isTailRow);
      var firstTail = flags.indexOf(true);
      var lastNormal = flags.lastIndexOf(false);
      var tailCount = flags.filter(Boolean).length;
      // 單邊沒裝備的格數：三種模式都適用的指標
      var lonely = $$('#cmpResult .cmp-table tbody .cmp-none').length;

      log.push('  ' + PAIR_MODES[m][1] + '：' + rows.length + ' 列'
        + '，圖騰／拼圖 ' + tailCount + ' 列'
        + '，單邊未裝備 ' + lonely + ' 格');
      log.push('    ' + ((tailCount === 0 || firstTail > lastNormal)
        ? 'OK 全部在最下面' : '*** 仍夾在中間（第一個在 ' + firstTail
          + '，最後一個一般裝備在 ' + lastNormal + '）***'));
    }

    log.push('');
    log.push('件數差距警告：' + ($('#cmpResult .cmp-warn') ? '有' : '沒有'));
  }

  /* ================================================================ */

  /** 收合是有狀態的功能（會寫進 localStorage），容易默默壞掉 */
  async function runFold() {
    await lookup();
    head();

    var heads = $$('.panel.active .fold-head');
    log.push('');
    log.push('總覽分頁：可收合區塊 ' + heads.length + ' 個');
    if (!heads.length) { log.push('  *** 沒有任何區塊被收合化 ***'); return; }

    var sec = heads[0].parentElement;
    var body = sec.querySelector('.fold-body');
    var openH = body.getBoundingClientRect().height;
    heads[0].click();
    await sleep(200);
    var closedH = body.getBoundingClientRect().height;
    log.push('  點「' + heads[0].textContent.trim() + '」：內容高 '
      + Math.round(openH) + ' → ' + Math.round(closedH)
      + (closedH === 0 && openH > 0 ? '  OK' : '  *** 沒收起來 ***'));

    var saved = JSON.parse(localStorage.getItem('tms.folds') || '{}');
    var keys = Object.keys(saved);
    log.push('  已記住的收合狀態：' + (keys.length ? keys.join('、') : '（無）')
      + (keys.length ? '  OK' : '  *** 沒寫進 localStorage ***'));

    heads[0].click();
    await sleep(200);
    log.push('  再點一次展開：內容高 '
      + Math.round(body.getBoundingClientRect().height)
      + (body.getBoundingClientRect().height > 0 ? '  OK' : '  *** 展不開 ***'));

    /* ---- 比對頁的顯示開關 ---- */
    $('.navbtn[data-view="compare"]').click();
    $('#cmpA').value = NAME;
    $('#cmpB').value = NAME;
    $('#cmpForm').dispatchEvent(
      new Event('submit', { cancelable: true, bubbles: true }));
    for (var i = 0; i < 300; i++) {
      if ($('#cmpResult .cmp-table')) break;
      await sleep(50);
    }
    await sleep(400);

    /* B 側換成別組裝備頁，兩邊才會有差異。拿同一組比的話每格都相同，
       .swap-metrics 一個都不會產生，開關測試就會量到 0 而誤報失敗。 */
    var selB = $('#cmpSetB');
    var other = Array.from(selB.options).filter(function (o) {
      return /預設 2/.test(o.textContent);
    })[0];
    if (other) {
      selB.value = other.value;
      selB.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(700);
    }

    log.push('');
    log.push('逐格比對的顯示開關（B 側改用預設 2，製造出實際差異）');
    var CHECKS = [
      ['#cmpShowPot', '.cmp-pot', '潛能明細'],
      ['#cmpShowSwap', '.swap-metrics', '換裝細項'],
      ['#cmpShowTail', '.cmp-row-tail', '圖騰／拼圖'],
    ];
    for (var c = 0; c < CHECKS.length; c++) {
      var box = $(CHECKS[c][0]);
      var sel = CHECKS[c][1];
      function visible() {
        return $$('#cmpResult ' + sel).filter(function (n) {
          return n.getBoundingClientRect().height > 0;
        }).length;
      }
      var before = visible();
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(200);
      var after = visible();
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(200);
      var back = visible();
      var verdict;
      if (before === 0) {
        // 這個情境本來就沒有這種元素，測不了 —— 別當成失敗
        verdict = '  無法判定（這個情境沒有這種元素）';
      } else {
        verdict = (after === 0 && back === before) ? '  OK' : '  *** 無效 ***';
      }
      log.push('  ' + CHECKS[c][2] + '：' + before + ' → 關 ' + after
        + ' → 開 ' + back + verdict);
    }
  }

  /* ================================================================ */

  /**
   * 六轉進度。fixtures 的角色核心全滿，等於只驗得到 100% 這一種情況 ——
   * 進度算錯（例如把沒開的核心漏出分母）在滿版角色身上照樣顯示 100%。
   * 所以先把等級改成一組手算得出答案的值，再比對畫面上的數字。
   */
  var HEXA_PLAN = [
    ['技能核心', [30, 25]],
    ['精通核心', [30, 30, 18, 7]],
    ['強化核心', [30, 12, 0, 3]],
    ['共用核心', [30]],          // 少放一個，測「尚未開啟」
  ];
  // 手算：55/60 + 85/120 + 45/120 + 30/60 = 215/360 = 59.7%，滿級 5 個，未滿 6 個
  // 材料：6 顆未滿的核心 + 少放的那 1 個共用核心從 0 起算 = 706 / 20,614
  var HEXA_WANT = {
    pct: '59.7%', sum: 215, max: 360, maxed: 5, unmaxed: 6, rows: 5,
    erda: '706', frag: '20,614',
  };

  /** 依 HEXA_PLAN 重寫 fixtures 裡的核心等級 */
  function rewriteHexa() {
    var slot = window.__FIX['character/hexamatrix'];
    if (!slot) return null;
    var src = (slot._ || {}).character_hexa_core_equipment || [];
    var out = [];
    HEXA_PLAN.forEach(function (pair) {
      var pool = src.filter(function (c) { return c.hexa_core_type === pair[0]; });
      pair[1].forEach(function (lv, i) {
        var base = pool[i];
        if (!base) return;
        out.push(Object.assign({}, base, { hexa_core_level: lv }));
      });
    });
    Object.keys(slot).forEach(function (k) {
      if (slot[k]) slot[k].character_hexa_core_equipment = out;
    });
    return out;
  }

  function check(label, got, want) {
    log.push('  ' + label + '：' + got
      + (String(got) === String(want) ? '  OK' : '  *** 應為 ' + want + ' ***'));
  }

  async function runHexa() {
    var cores = rewriteHexa();
    if (!cores) { log.push('*** fixtures 沒有 character/hexamatrix ***'); return; }

    await lookup();
    head();

    var tab = $$('.tab').filter(function (t) {
      return t.textContent.trim() === 'HEXA';
    })[0];
    if (!tab) { log.push('*** 找不到 HEXA 分頁 ***'); return; }
    tab.click();
    await sleep(900);
    // 捲到分頁區，這個模式也常拿來截圖，不捲的話只拍得到上面的角色卡
    var wrap = $('.tabs-wrap');
    if (wrap) window.scrollTo(0, wrap.getBoundingClientRect().top + window.scrollY - 4);
    await sleep(200);

    log.push('');
    log.push('六轉進度（核心改寫成 ' + cores.length + ' 個，'
      + HEXA_PLAN.map(function (p) { return p[0] + ' ' + p[1].join('/'); }).join('　') + '）');

    var pct = $('.panel.active .hxp-pct');
    if (!pct) { log.push('  *** 進度區塊沒有出現 ***'); return; }
    check('總進度', pct.textContent.trim(), HEXA_WANT.pct);

    var topnum = $('.panel.active .hxp-topnum');
    check('核心等級', topnum ? topnum.textContent.trim() : '（無）',
      HEXA_WANT.sum + ' / ' + HEXA_WANT.max + ' 級');

    var sub = $('.panel.active .hxp-topsub');
    var txt = sub ? sub.textContent : '';
    check('還差級數', /還差 (\S+) 級/.test(txt) ? RegExp.$1 : '（無）',
      String(HEXA_WANT.max - HEXA_WANT.sum));
    check('已滿級核心', /已滿級 (\d+) \/ (\d+)/.test(txt) ? RegExp.$1 + '/' + RegExp.$2 : '（無）',
      HEXA_WANT.maxed + '/12');

    var rows = $$('.panel.active .hxp-row');
    check('分類列數（4 類 + 能力值）', rows.length, HEXA_WANT.rows);
    rows.forEach(function (r) {
      log.push('    ' + r.textContent.trim().replace(/\s+/g, ' '));
    });

    // 少放的那個共用核心要被指出來，否則分母錯了也看不出來
    var missing = rows.filter(function (r) {
      return /尚未開啟/.test(r.textContent);
    }).length;
    check('標出「尚未開啟」的分類', missing, 1);

    var needs = $$('.panel.active .hxp-need-item b').map(function (b) {
      return b.textContent.trim();
    });
    check('還差靈魂艾爾達', needs[0] || '（無）', HEXA_WANT.erda);
    check('還差碎片', needs[1] || '（無）', HEXA_WANT.frag);
    check('沒有費用表的核心', $('.panel.active .hxp-need-warn') ? '有' : '無', '無');

    // 台版未開放的第三共用核心：要另外列，而且不能被算進上面的進度
    var soon = $('.panel.active .hxp-soon');
    check('未開放區塊', soon ? '有' : '無', '有');
    if (soon) {
      var t = soon.textContent;
      check('未開放的追加需求',
        /靈魂艾爾達 ([\d,]+)　碎片 ([\d,]+)/.test(t) ? RegExp.$1 + ' / ' + RegExp.$2 : '（無）',
        '137 / 4,035');
      check('帶出職業的技能名',
        soon.querySelector('.hxp-soon-skill')
          ? soon.querySelector('.hxp-soon-skill').textContent.trim() : '（無）',
        '異界殘像 VI');
    }

    /* ---- 下一步最划算 ---- */
    var plan = $('.panel.active .hxp-plan');
    check('有「下一步最划算」', plan ? '有' : '無', '有');
    if (plan) {
      plan.open = true;
      await sleep(300);
      var planRows = plan.querySelectorAll('tbody tr');
      check('排出來的級數', planRows.length, 20);

      // DP 排出的是 20 級總和最省的組合，列的先後照「當下最便宜」，
      // 所以成本不會一路遞增（每 10 級有尖峰，付掉之後下一級反而變便宜）
      var frags = Array.from(planRows).map(function (tr) {
        var t = tr.children[3].textContent;
        return /碎片 ([\d,]+)/.test(t) ? Number(RegExp.$1.replace(/,/g, '')) : -1;
      });
      check('讀得到每一級的碎片數',
        frags.filter(function (x) { return x > 0; }).length, planRows.length);

      /* 最便宜的那一步不一定排第一：付掉開啟費或每 10 級的尖峰之後，
         解鎖出來的下一級反而更便宜（例如強化核心 0→1 要 75，1→2 只要 23）。
         所以這裡驗的是「同一顆核心的等級連續往上」，不是成本排序。 */
      var byCore = {};
      var contiguous = true, dupLabel = false;
      Array.from(planRows).forEach(function (tr) {
        var name = tr.children[1].textContent.trim();
        var m = /(\d+)\s*→\s*(\d+)/.exec(tr.children[2].textContent);
        if (!m) { contiguous = false; return; }
        var from = Number(m[1]), to = Number(m[2]);
        if (to !== from + 1) contiguous = false;
        /* 名字重覆又接不上有兩種可能：從 0 重來的是兩顆核心共用同一個標籤
           （未開啟的核心沒編號就會這樣），其他才是真的排錯。分開報才看得出
           是哪一種 —— 混在一起的話標籤沒編號會被誤報成順序有問題。 */
        if (name in byCore && byCore[name] !== from) {
          if (from === 0) dupLabel = true; else contiguous = false;
        }
        byCore[name] = to;
      });
      check('同一顆核心的等級連續往上', contiguous ? '是' : '否', '是');
      check('沒有兩顆核心共用同一個名稱', dupLabel ? '有' : '無', '無');

      // 累計要真的是累計
      var cums = Array.from(planRows).map(function (tr) {
        var t = tr.children[4].textContent;
        return /\/\s*([\d,]+)/.test(t) ? Number(RegExp.$1.replace(/,/g, '')) : -1;
      });
      var run = 0, ok = true;
      frags.forEach(function (f, i) { run += f; if (cums[i] !== run) ok = false; });
      check('累計欄位對得上逐級加總', ok ? '對' : '不對', '對');
      log.push('  前 3 步：' + Array.from(planRows).slice(0, 3).map(function (tr) {
        return tr.children[1].textContent.trim().replace(/\s+/g, ' ')
          + ' ' + tr.children[2].textContent.trim();
      }).join('　｜　'));
      // 核心快滿級時排不到 20 級，寫死 rows[19] 會炸掉，後面的檢查會整段跳過
      if (planRows.length) {
        log.push('  ' + planRows.length + ' 級累計：'
          + planRows[planRows.length - 1].children[4].textContent.trim());
      }
    }

    var det = $('.panel.active .hxp-todo');
    check('未滿級核心清單',
      det ? (/未滿級核心（(\d+)）/.test(det.textContent) ? RegExp.$1 : '?') : '（無）',
      HEXA_WANT.unmaxed);

    // 展開清單再掃一次版面，收著的話裡面量不到
    if (det) { det.open = true; await sleep(400); }

    // 圖示要跟核心卡片一樣拿得到。抓不到時 .hicon 會退成文字，量 img 才準
    var shown = $$('.panel.active .hxp-todoname .hicon img').length;
    check('未滿級核心的圖示', shown, HEXA_WANT.unmaxed);

    // 進度條寬度應該跟數字一致，CSS 沒接上時條會是空的
    var fills = $$('.panel.active .hxp-bar > i').map(function (i) {
      return i.getBoundingClientRect().width;
    });
    check('有寬度的進度條', fills.filter(function (w) { return w > 0; }).length,
      fills.length);

    log.push('');
    log.push.apply(log, window.__scan('[HEXA 六轉進度]'));
  }

  /* ================================================================ */

  /**
   * 靈魂武器。改版後 API 換了一組欄位（soul_weapon_*），舊的 soul_name
   * 變成 null —— 只認舊欄位的話整塊會安靜地消失，畫面看不出少了東西。
   *
   * fixtures 那隻角色不一定有靈魂武器，沒有就回報「無法判定」而不是失敗。
   */
  /**
   * 經驗追蹤。
   *
   * 這一頁要按「載入」才有東西，逐日打 API 才畫得出圖 —— 所以之前完全
   * 沒有測到。這裡改成直接把一段假的經驗歷史塞進 localStorage：
   * renderExp 的 draw() 讀的就是那裡，一次 API 都不用打。
   *
   * 假資料故意做出三種情況：正常成長、升級當天、以及完全沒動的一天
   * （成長 0，長條不會畫出來，只剩 x 軸標籤）。
   */
  var EXP_PLAN = [
    [292, 10.50], [292, 45.20], [292, 88.90], [293, 12.30],
    [293, 60.10], [293, 60.10], [294, 5.00],
  ];
  // 第 4 與第 7 天各升一級；第 6 天跟第 5 天一模一樣＝當天沒成長
  var EXP_WANT = { days: 7, points: 6, bars: 5, lvups: 2, zero: 1 };

  function seedExp() {
    var store = {};
    var base = new Date(Date.now() + 8 * 3600 * 1000);   // UTC+8
    base.setUTCDate(base.getUTCDate() - 1);              // latestDataDate()
    var dates = [];
    for (var k = 0; k < EXP_PLAN.length; k++) {
      var dd = new Date(base);
      dd.setUTCDate(dd.getUTCDate() - (EXP_PLAN.length - 1 - k));
      var iso = dd.toISOString().slice(0, 10);
      dates.push(iso);
      store[iso] = { lv: EXP_PLAN[k][0], exp: 1000000 * (k + 1), rate: EXP_PLAN[k][1] };
    }
    localStorage.setItem('tms.exp.' + OCID, JSON.stringify(store));
    return dates;
  }

  /** 圖表的 x 軸標籤。跟 y 軸刻度同一個 class，靠 text-anchor 分開 */
  function xAxisLabels(svg) {
    return Array.prototype.slice.call(svg.querySelectorAll('text.axis'))
      .filter(function (t) { return t.getAttribute('text-anchor') === 'middle'; });
  }

  async function runExp() {
    await lookup();
    head();

    var dates = seedExp();

    var tab = $$('.tab').filter(function (t) {
      return t.textContent.trim() === '經驗';
    })[0];
    if (!tab) { log.push('*** 找不到經驗分頁 ***'); return; }
    tab.click();
    await sleep(800);

    log.push('');
    log.push('經驗追蹤（塞了 ' + EXP_WANT.days + ' 天假資料，不打 API）');

    var rows = $$('.panel.active .explist-row');
    check('逐日清單列數', rows.length, EXP_WANT.days);

    var svg = $('.panel.active svg.chart');
    check('有長條圖', svg ? '有' : '無', '有');
    if (svg) {
      check('長條數（沒成長的那天不畫）',
        svg.querySelectorAll('path.bar').length, EXP_WANT.bars);
      check('升級標記數', svg.querySelectorAll('text.lvup').length, EXP_WANT.lvups);

      /* x 軸標籤。踩過的坑：draw() already 把日期切成「08-21」了，
         圖表裡又 slice(5) 一次就變成空字串 —— 整條 x 軸的標籤會全部
         消失，但長條、tooltip、表格都照常，所以肉眼很難認定是壞掉。
         這裡驗「標籤存在而且不是空的」。 */
      /* y 軸刻度與 x 軸標籤同樣是 text.axis，y 座標又剛好接近（零線的
         刻度和 x 標籤只差十幾 px），只能靠對齊方式分：y 軸靠右 end，
         x 軸置中 middle。 */
      var xlab = xAxisLabels(svg);
      check('x 軸有標籤', xlab.length, EXP_WANT.points);
      check('x 軸標籤都不是空的',
        xlab.filter(function (t) { return t.textContent.trim() !== ''; }).length,
        xlab.length);
      log.push('  x 軸：' + xlab.map(function (t) {
        return t.textContent.trim() || '（空）';
      }).join('　'));
    }

    var det = $('.panel.active .exp-table');
    check('有「表格檢視」', det ? '有' : '無', '有');
    if (det) {
      det.open = true;
      await sleep(250);
      var trs = det.querySelectorAll('tbody tr');
      check('表格列數', trs.length, EXP_WANT.points);

      /* 表格是圖表的等價替代，兩邊講的必須是同一組日期 —— 只是排序相反
         （圖表由舊到新，表格新的在上），所以反過來比。 */
      var tdates = Array.prototype.slice.call(trs).map(function (tr) {
        return tr.children[0].textContent.trim();
      });
      var same = svg
        ? tdates.slice().reverse().join(',') === xAxisLabels(svg)
            .map(function (t) { return t.textContent.trim(); }).join(',')
        : false;
      check('表格與圖表是同一組日期', same ? '是' : '否', '是');

      var zero = Array.prototype.slice.call(trs).filter(function (tr) {
        return tr.children[1].textContent.indexOf('+0.00') !== -1;
      });
      check('沒成長的那天仍列在表格裡', zero.length, EXP_WANT.zero);
      log.push('  首列：' + Array.prototype.slice.call(trs[0].children)
        .map(function (td) { return td.textContent.trim(); }).join('　｜　'));
    }
    log.push('');
    log.push('  資料範圍：' + dates[0] + ' ~ ' + dates[dates.length - 1]);
  }

  async function runSoul() {
    await lookup();
    head();

    var tab = $$('.tab').filter(function (t) {
      return t.textContent.trim() === '裝備';
    })[0];
    if (!tab) { log.push('*** 找不到裝備分頁 ***'); return; }
    tab.click();
    await sleep(800);

    log.push('');

    /* ---- 詳細清單的摘要行 ---- */
    var list = $$('.panel.active .eqtoggle .tab').filter(function (b) {
      return b.textContent.trim() === '詳細清單';
    })[0];
    if (list) { list.click(); await sleep(500); }

    var lines = $$('.panel.active .item-line, .panel.active .item-body div')
      .map(function (n) { return n.textContent; })
      .filter(function (t) { return t.indexOf('靈魂武器') === 0; });
    log.push('詳細清單裡的靈魂武器摘要行：' + lines.length + ' 條');
    lines.slice(0, 3).forEach(function (t) { log.push('  ' + t.trim()); });

    if (!lines.length) {
      log.push('  無法判定（這份測試資料沒有靈魂武器，'
        + '要驗的話補 soul_weapon_* 欄位進 fixtures）');
      log.push('');
      log.push.apply(log, window.__scan('[靈魂武器]'));
      return;
    }

    /* ---- 點開武器看詳情彈窗 ---- */
    if (list) {
      var grid = $$('.panel.active .eqtoggle .tab').filter(function (b) {
        return b.textContent.trim() === '裝備欄';
      })[0];
      if (grid) { grid.click(); await sleep(400); }
    }

    var cells = $$('.panel.active .eqcell').filter(function (c) {
      return c.querySelector('img');
    });
    var opened = false;
    for (var i = 0; i < cells.length && !opened; i++) {
      cells[i].click();
      await sleep(250);
      if ($('#itemTip .tip-soul')) opened = true;
      else $('#itemModal').hidden = true;
    }

    check('詳情彈窗有靈魂武器區塊', opened ? '有' : '無', '有');
    if (opened) {
      var box = $('#itemTip .tip-soul');
      var t = box.textContent.replace(/\s+/g, ' ').trim();
      log.push('  ' + t);
      check('有階級', /\d+ 階/.test(t) ? '有' : '無', '有');
      check('有等級', /Lv\.\d+/.test(t) ? '有' : '無', '有');
      check('有烙印', /烙印/.test(t) ? '有' : '無', '有');
      check('有共鳴', /共鳴/.test(t) ? '有' : '無', '有');
      // 彈窗留著不關：這個模式也拿來截圖，而且順便把彈窗本身掃進版面檢查
      log.push.apply(log, window.__scan('[靈魂武器詳情]'));
    }
  }
  /* ================================================================ */

  (async function () {
    try {
      await sleep(300);
      if (mode === 'tab') {
        await runOneTab(Number(hash.get('i') || 0));
        done();
        $('#diag').style.display = 'none';   // 別入鏡，但文字仍可被讀走
        return;
      }
      if (mode === 'compare') await runCompare();
      else if (mode === 'fold') await runFold();
      else if (mode === 'hexa') await runHexa();
      else if (mode === 'soul') await runSoul();
      else if (mode === 'exp') await runExp();
      else await runTabs();
    } catch (e) {
      log.push('ERROR ' + e.message);
      log.push(String(e.stack));
    }
    done();
  }());
}());
