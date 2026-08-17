/**
 * 版面掃描器。抓兩種在手機上最常見、光看程式碼看不出來的毛病：
 *
 * 1. 橫向溢出 —— 元素右緣超出可視寬度，且沒有任何祖先在做橫向捲動。
 *    （在 .tablewrap 這種自捲容器裡的不算，那是刻意的。）
 *
 * 2. 空白破洞 —— 容器高度遠大於子元素實際佔用的範圍。這類問題通常
 *    來自「橫排改直排後 flex-basis 從寬度變成高度」，或格線的
 *    align-items: stretch 把矮卡片撐平。
 *
 * 破洞判定刻意用「子元素的範圍（最下緣 − 最上緣）」而不是「高度總和」：
 * 多欄格線與換行排版各自加總會嚴重高估空白，整份報告會吵到沒法看。
 */
window.__scan = function (label) {
  var vw = document.documentElement.clientWidth;
  var bad = [];

  /* ---- 1. 橫向溢出 ---- */
  document.querySelectorAll('main *, .controls *').forEach(function (n) {
    if (n.closest('#diag')) return;
    var r = n.getBoundingClientRect();
    if (!r.width && !r.height) return;
    if (r.right <= vw + 0.5) return;

    var p = n.parentElement;
    var scrolled = false;
    while (p) {
      var ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') { scrolled = true; break; }
      p = p.parentElement;
    }
    if (scrolled) return;

    bad.push('  溢出 ' + n.tagName.toLowerCase() + '.' + (n.className || '?')
      + ' right=' + Math.round(r.right) + ' (可視寬 ' + vw + ')');
  });

  /* ---- 2. 空白破洞 ---- */
  document.querySelectorAll('main div, main label, main ul, main table, main section')
    .forEach(function (n) {
      var r = n.getBoundingClientRect();
      if (!r.height || n.offsetParent === null || !n.children.length) return;

      var top = Infinity;
      var bottom = -Infinity;
      for (var i = 0; i < n.children.length; i++) {
        var cr = n.children[i].getBoundingClientRect();
        if (!cr.height && !cr.width) continue;
        top = Math.min(top, cr.top);
        bottom = Math.max(bottom, cr.bottom);
      }
      if (bottom < top) return;

      var cs = getComputedStyle(n);
      var pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      var slack = r.height - (bottom - top) - pad;
      if (slack <= window.__SCAN_SLACK) return;

      bad.push('  破洞 ' + n.tagName.toLowerCase() + '.' + (n.className || '?')
        + ' 高=' + Math.round(r.height)
        + ' 子元素範圍=' + Math.round(bottom - top)
        + ' 內距=' + Math.round(pad)
        + ' 無主空白=' + Math.round(slack)
        + ' 內容="' + n.textContent.trim().slice(0, 24).replace(/\s+/g, ' ') + '"');
    });

  return bad.length ? [label + '  ***'].concat(bad) : [label + '  OK'];
};

// 低於這個像素數的落差不回報 —— gap、margin 造成的零星空隙不是問題
window.__SCAN_SLACK = 60;
