/**
 * 測試驅動。模式寫在網址的 hash 裡：
 *
 *   #mode=tabs           角色查詢：依序點過每個分頁，各掃一次版面
 *   #mode=tab&i=1        只切到第 i 個分頁並停住（給截圖用）
 *   #mode=compare        裝備比對：三種配對模式的列順序與裝備頁內容
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
      else await runTabs();
    } catch (e) {
      log.push('ERROR ' + e.message);
      log.push(String(e.stack));
    }
    done();
  }());
}());
