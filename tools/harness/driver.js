/**
 * 測試驅動。模式寫在網址的 hash 裡：
 *
 *   #mode=tabs           角色查詢：依序點過每個分頁，各掃一次版面
 *   #mode=tab&i=1        只切到第 i 個分頁並停住（給截圖用）
 *   #mode=compare        裝備比對：三種配對模式的列順序與裝備頁內容
 *   #mode=fold           區塊收合與比對頁的顯示開關
 *   #mode=hexa           六轉進度：改寫核心等級後比對算出來的數字
 *   #mode=single         單件試算：填數值後判定與逐項差異對不對
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
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].click();
      await sleep(700);
      log.push.apply(log, window.__scan('[' + tabs[i].textContent.trim() + ']'));
    }
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
   * 單件試算。這裡不只看版面 —— 表單填出來的數值有沒有真的走進判定，
   * 光看截圖分不出來（畫面照樣渲染，只是判定永遠是「數值相同」）。
   * 所以填一個已知的差值進去，比對畫面上的判定與逐項差異。
   */
  async function runSingle() {
    $('.navbtn[data-view="single"]').click();
    $('#oneName').value = NAME;
    $('#oneForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    for (var i = 0; i < 300 && !$('#oneResult .one-form'); i++) await sleep(50);
    await sleep(400);
    head();

    log.push('');
    var slots = Array.from($('#oneSlot').options);
    log.push('單件試算：可選欄位 ' + slots.length + ' 個');
    if (!slots.length) { log.push('  *** 欄位下拉是空的 ***'); return; }

    // 挑武器，那是最容易看出差別的一格；沒有就用第一個
    var want = slots.filter(function (o) { return o.value === '武器'; })[0] || slots[0];
    $('#oneSlot').value = want.value;
    $('#oneSlot').dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(400);
    log.push('  選了「' + want.value + '」');

    /* ---- 預設是空表單：不該給判定，也不該冒出「試算裝備」那一欄 ---- */
    function verdict() {
      var b = $('#oneResult .one-verdict .swap-badge');
      return b ? b.textContent.trim() : '（無）';
    }
    function filled() {
      return $$('#oneResult .one-form input').filter(function (i) {
        return i.value !== '';
      }).length;
    }
    check('預設欄位全空', filled(), 0);
    check('空表單不給判定', verdict(), '（無）');
    check('空表單只顯示目前裝備', $$('#oneResult .one-col').length, 1);
    check('空表單有提示', $('#oneResult .one-waiting') ? '有' : '無', '有');

    // 判定只看 5 項數值 + 星力，其餘折進「其他數值」。混在一起會讓人
    // 以為都算進去了，所以這裡要驗它們真的分開
    var judged = $$('#oneResult .one-form > .one-grid .one-f');
    check('判定用的數值格（主屬性、主攻擊、BOSS、無視、全屬性）', judged.length, 5);
    check('星力在最上面那排', $$('#oneResult .one-row .one-f').length, 2);

    var rest = $('#oneResult .one-rest');
    check('其他數值折起來', rest && !rest.open ? '有且收合' : (rest ? '有但展開' : '無'),
      '有且收合');
    check('其他數值的欄位數', rest ? rest.querySelectorAll('.one-f').length : 0, 8);
    check('潛能輸入格', $$('#oneResult .one-pot').length, 6);

    /* ---- 改一個數字，判定要跟著變 ---- */
    function setField(label, value) {
      var f = $$('#oneResult .one-f').filter(function (x) {
        var s = x.querySelector('span');
        return s && s.textContent.trim() === label;
      })[0];
      if (!f) return false;
      var inp = f.querySelector('input');
      inp.value = value;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    function metrics() {
      return $$('#oneResult .one-verdict .swap-m').map(function (m) {
        return m.textContent.trim();
      });
    }

    setField('星力', 25);
    await sleep(200);
    log.push('  把星力改成 25：' + verdict() + '　' + metrics().join('、'));
    check('填了值就開始判定', verdict() !== '（無）' ? '有判定' : '沒判定', '有判定');
    check('試算裝備那一欄出現了', $$('#oneResult .one-col').length, 2);
    check('差異裡列出星力', metrics().filter(function (m) {
      return m.indexOf('★') === 0;
    }).length ? '有' : '無', '有');

    /* ---- 潛能：格式對的要進判定，格式錯的要標出來且不進判定 ---- */
    function setPot(label, value) {
      var f = $$('#oneResult .one-pot').filter(function (x) {
        var s = x.querySelector('span');
        return s && s.textContent.trim() === label;
      })[0];
      if (!f) return null;
      var inp = f.querySelector('input');
      inp.value = value;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return f;
    }

    var good = setPot('潛能 1', 'BOSS傷害 +40%');
    await sleep(200);
    check('看得懂的潛能有標 ✓',
      good && /✓/.test(good.querySelector('.one-parse').textContent) ? '有' : '無', '有');
    check('看得懂的潛能進了判定',
      metrics().filter(function (m) { return /BOSS傷害/.test(m); }).length ? '有' : '無', '有');

    var bad = setPot('潛能 2', '這不是潛能格式');
    await sleep(200);
    check('看不懂的潛能有標 ✗',
      bad && /✗/.test(bad.querySelector('.one-parse').textContent) ? '有' : '無', '有');
    check('看不懂的潛能沒進判定',
      metrics().filter(function (m) { return /這不是潛能/.test(m); }).length, 0);

    /* ---- 填入目前數值：等於拿自己比自己，判定必須是「數值相同」 ---- */
    var reset = $$('#oneResult .one-tools button').filter(function (b) {
      return /填入目前/.test(b.textContent);
    })[0];
    if (reset) {
      reset.click();
      await sleep(400);
      check('按「填入目前裝備的數值」', verdict(), '數值相同');
      check('填入後欄位不再是空的', filled() > 0 ? '有值' : '仍是空的', '有值');
    }

    /* ---- 從現有裝備帶入：這是能跨欄位比對的關鍵 ---- */
    var src = $('#oneResult .one-src select');
    check('有「從現有裝備帶入」下拉', src ? '有' : '無', '有');
    if (src) {
      var opts = Array.from(src.options).filter(function (o) { return o.value !== ''; });
      log.push('  可帶入的裝備 ' + opts.length + ' 件，分 '
        + src.querySelectorAll('optgroup').length + ' 位角色');

      // 挑一件跟目前欄位不同欄位的，證明跨欄位真的能比
      var other = opts.filter(function (o) {
        return o.textContent.indexOf(want.value) !== 0;
      })[0];
      if (other) {
        src.value = other.value;
        src.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(400);
        log.push('  帶入「' + other.textContent.trim() + '」（與「'
          + want.value + '」不同欄位）');
        check('帶入後有判定', verdict() !== '（無）' ? '有判定' : '沒判定', '有判定');
        check('帶入後欄位有值', filled() > 0 ? '有值' : '空的', '有值');
      } else {
        log.push('  *** 找不到不同欄位的裝備可帶入，跨欄位這段沒驗到 ***');
      }
    }

    /* ---- 清空：要回到一開始那個「還沒填」的狀態 ---- */
    var clear = $$('#oneResult .one-tools button').filter(function (b) {
      return /清空/.test(b.textContent);
    })[0];
    if (clear) {
      clear.click();
      await sleep(400);
      check('按「清空」後欄位全空', filled(), 0);
      check('按「清空」後回到未填狀態', verdict(), '（無）');
    }

    log.push('');
    log.push.apply(log, window.__scan('[單件試算]'));
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
      else if (mode === 'single') await runSingle();
      else await runTabs();
    } catch (e) {
      log.push('ERROR ' + e.message);
      log.push(String(e.stack));
    }
    done();
  }());
}());
