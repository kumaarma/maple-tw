/**
 * 把 fetch 換成讀本機 fixtures，讓 app.js 完整跑起來但一次 API 都不打。
 * 必須在 app.js 之前載入。fixtures 由 tools/make_fixtures.py 產生。
 */
(function () {
  var FIX = window.__FIX || {};

  window.fetch = function (url) {
    var u = String(url);
    var q = u.indexOf('?');
    var path = (q === -1 ? u : u.slice(0, q)).replace(/^\/api\//, '');
    var params = new URLSearchParams(q === -1 ? '' : u.slice(q + 1));
    var status = 200;
    var body;

    if (path === 'status') {
      // 本機代理模式的狀態，讓右上角配額徽章也會出現
      body = {
        has_key: true,
        key_hint: 'mock…',
        key_tier: '測試',
        source: 'fixtures',
        quota_used: 0,
        quota_budget: 1000,
        cached_entries: Object.keys(FIX).length,
      };
    } else {
      var slots = FIX[path];
      if (!slots) {
        // fixtures 沒有的端點就回 403，順便看看錯誤狀態的版面
        status = 403;
        body = { error: { name: 'OPENAPI00002',
                          message: 'fixtures 沒有 ' + path } };
      } else {
        // 經驗分頁會逐日抓，對得到日期就給該日，對不到給任意一筆
        body = slots[params.get('date')] || slots._;
      }
    }

    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status,
      headers: { 'Content-Type': 'application/json' },
    }));
  };
}());
