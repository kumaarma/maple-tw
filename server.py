#!/usr/bin/env python3
"""
台版新楓之谷查詢站 — 本機伺服器

前端純靜態，所有 NEXON Open API 呼叫都經過這支代理：
金鑰只存在伺服器端，不會出現在瀏覽器，也繞開了 CORS 限制。

開發階段金鑰的配額是 5 次/秒、1000 次/天，所以這裡做了三件事保護配額：
  1. 磁碟快取 — 官方資料每日才更新一次，快取存活到隔天凌晨
  2. 節流     — 每秒最多 4 次上游請求，留一點餘裕給 5/秒 的上限
  3. 計數     — 記錄今日已用次數，前端會顯示

啟動:
    python server.py            # 預設 http://127.0.0.1:8787
    python server.py --port 9000
"""

import argparse
import json
import os
import threading
import time
import webbrowser
from collections import deque
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.abspath(__file__))
# 資料夾叫 docs 是為了配合 GitHub Pages —— 從分支部署時
# 來源資料夾只能選根目錄或 /docs，不能指定任意名稱。
STATIC = os.path.join(ROOT, "docs")
KEYFILE = os.path.join(ROOT, "apikey.txt")
CACHEFILE = os.path.join(ROOT, "cache.json")
QUOTAFILE = os.path.join(ROOT, "quota.json")

UPSTREAM = "https://open.api.nexon.com/maplestorytw/v1"
TW = timezone(timedelta(hours=8))

RATE_PER_SEC = 4          # 上游 5/秒，留一點餘裕
# 每日上限僅供前端顯示。數字取自官方文件的兩種應用程式層級，本站沒有實測過
# 真實上限 —— 實測只確認了兩種金鑰的「存取範圍」相同（排行榜一律 403）。
BUDGET_DEV = 1000            # 開發階段：5 次/秒、1,000 次/天
BUDGET_LIVE = 20000000       # 正式：500 次/秒、2,000 萬次/天


def daily_budget():
    return BUDGET_DEV if API_KEY.startswith("test_") else BUDGET_LIVE


# --------------------------------------------------------------------------
# 金鑰
# --------------------------------------------------------------------------

def load_key():
    key = os.environ.get("NEXON_API_KEY", "").strip()
    if key:
        return key
    if os.path.exists(KEYFILE):
        with open(KEYFILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""


def save_key(key):
    with open(KEYFILE, "w", encoding="utf-8") as f:
        f.write(key.strip())


API_KEY = load_key()


# --------------------------------------------------------------------------
# 磁碟快取
# --------------------------------------------------------------------------

_cache = {}
_cache_lock = threading.Lock()
_cache_dirty = False


def _load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (IOError, ValueError):
        return default


def _cache_load():
    """
    載入時順手丟掉兩種項目：已過期的，以及「不帶 date 卻有長效期」的。
    後者是快取分流修正前留下的 —— 那時所有回應都被存到隔天 02:30，
    套在即時資料上會把它凍住，所以要主動清掉而不是等它自然過期。
    """
    global _cache
    raw = _load_json(CACHEFILE, {})
    now = time.time()
    kept = {}
    for k, v in raw.items():
        if not (isinstance(v, list) and len(v) == 2 and v[0] > now):
            continue
        is_live = "date=" not in k
        if is_live and v[0] > now + LIVE_TTL + 60:
            continue
        kept[k] = v
    _cache = kept


def _cache_flush():
    """把快取寫回磁碟，順手清掉過期的。"""
    global _cache_dirty
    with _cache_lock:
        if not _cache_dirty:
            return
        now = time.time()
        alive = {k: v for k, v in _cache.items() if v[0] > now}
        _cache.clear()
        _cache.update(alive)
        snapshot = dict(alive)
        _cache_dirty = False
    try:
        tmp = CACHEFILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False)
        os.replace(tmp, CACHEFILE)
    except IOError:
        pass


LIVE_TTL = 180      # 不帶 date 的「最新」資料：短快取


def cache_expiry(has_date):
    """
    兩種資料的壽命完全不同，不能用同一套：

    * 帶 date  —— 歷史快照，實測回傳的 date 固定是該日 00:00，之後不會再變，
                  所以可以放心快取到下一個 02:30（跨過官方更新時點）。
    * 不帶 date —— 實測是近即時資料（同一天內會變動），只能短快取，
                  否則等於把即時性凍掉。
    """
    if not has_date:
        return time.time() + LIVE_TTL

    now = datetime.now(TW)
    nxt = now.replace(hour=2, minute=30, second=0, microsecond=0)
    if now >= nxt:
        nxt += timedelta(days=1)
    return time.time() + max(300, (nxt - now).total_seconds())


# --------------------------------------------------------------------------
# 配額計數
# --------------------------------------------------------------------------

_quota_lock = threading.Lock()
_quota = _load_json(QUOTAFILE, {})


def quota_today():
    return datetime.now(TW).strftime("%Y-%m-%d")


def quota_bump():
    with _quota_lock:
        day = quota_today()
        _quota[day] = _quota.get(day, 0) + 1
        # 只留最近 7 天
        for k in [k for k in _quota if k < (datetime.now(TW) - timedelta(days=7)).strftime("%Y-%m-%d")]:
            del _quota[k]
        snapshot = dict(_quota)
    try:
        with open(QUOTAFILE, "w", encoding="utf-8") as f:
            json.dump(snapshot, f)
    except IOError:
        pass


def quota_used():
    with _quota_lock:
        return _quota.get(quota_today(), 0)


# --------------------------------------------------------------------------
# 節流 — 滑動視窗，每秒最多 RATE_PER_SEC 次
# --------------------------------------------------------------------------

_ticks = deque()
_rate_lock = threading.Lock()


def throttle():
    while True:
        with _rate_lock:
            now = time.time()
            while _ticks and now - _ticks[0] > 1.0:
                _ticks.popleft()
            if len(_ticks) < RATE_PER_SEC:
                _ticks.append(now)
                return
            wait = 1.0 - (now - _ticks[0])
        time.sleep(max(0.02, wait))


# --------------------------------------------------------------------------
# 上游呼叫
# --------------------------------------------------------------------------

def call_upstream(path, query):
    """回傳 (status, body_bytes, from_cache)。上游的錯誤 JSON 原樣往前端送。"""
    global _cache_dirty

    # _fresh 只是前端要求跳過快取的訊號，不能往上游送，也不該弄髒快取鍵
    pairs = [(k, v) for k, v in parse_qsl(query, keep_blank_values=True)]
    force = any(k == "_fresh" and v == "1" for k, v in pairs)
    pairs = [(k, v) for k, v in pairs if k != "_fresh"]
    has_date = any(k == "date" and v for k, v in pairs)

    url = UPSTREAM + "/" + path.lstrip("/")
    if pairs:
        url += "?" + urlencode(pairs)

    if not force:
        with _cache_lock:
            hit = _cache.get(url)
            if hit and hit[0] > time.time():
                return 200, hit[1].encode("utf-8"), True

    if not API_KEY:
        body = json.dumps({
            "error": {"name": "NO_API_KEY", "message": "尚未設定 API 金鑰"}
        }, ensure_ascii=False).encode("utf-8")
        return 401, body, False

    req = Request(url, headers={
        "x-nxopen-api-key": API_KEY,
        "Accept": "application/json",
    })

    status, body = 0, b""
    for attempt in range(3):
        throttle()
        quota_bump()
        try:
            with urlopen(req, timeout=25) as r:
                status, body = r.status, r.read()
            break
        except HTTPError as e:
            status, body = e.code, e.read()
            if status == 429 and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            break
        except URLError as e:
            body = json.dumps({
                "error": {"name": "UPSTREAM_UNREACHABLE", "message": str(e.reason)}
            }, ensure_ascii=False).encode("utf-8")
            return 502, body, False

    if status == 200:
        with _cache_lock:
            _cache[url] = [cache_expiry(has_date), body.decode("utf-8")]
            _cache_dirty = True
        threading.Timer(3.0, _cache_flush).start()

    return status, body, False


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC, **kwargs)

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/") and not self.path.startswith("/api/status"):
            print("[%s] %s" % (time.strftime("%H:%M:%S"), self.path))

    def _send_json(self, status, obj):
        self._send_raw(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _send_raw(self, status, body, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/status":
            with _cache_lock:
                cached = len(_cache)
            self._send_json(200, {
                "has_key": bool(API_KEY),
                "key_hint": (API_KEY[:6] + "…" + API_KEY[-4:]) if API_KEY else "",
                "key_tier": ("開發階段" if API_KEY.startswith("test_")
                             else ("正式" if API_KEY else "")),
                "source": "環境變數" if os.environ.get("NEXON_API_KEY") else (
                    "apikey.txt" if os.path.exists(KEYFILE) else "未設定"),
                "quota_used": quota_used(),
                "quota_budget": daily_budget(),
                "cached_entries": cached,
            })
            return

        if parsed.path == "/api/cache/clear":
            with _cache_lock:
                _cache.clear()
            _cache_flush()
            try:
                os.remove(CACHEFILE)
            except OSError:
                pass
            self._send_json(200, {"ok": True})
            return

        if parsed.path.startswith("/api/"):
            status, body, cached = call_upstream(parsed.path[len("/api/"):], parsed.query)
            self._send_raw(status, body, {"X-Cache": "HIT" if cached else "MISS"})
            return

        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        global API_KEY
        parsed = urlparse(self.path)

        if parsed.path == "/api/key":
            length = int(self.headers.get("Content-Length") or 0)
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                key = str(payload.get("key", "")).strip()
            except (ValueError, UnicodeDecodeError):
                self._send_json(400, {"ok": False, "message": "請求格式錯誤"})
                return

            if not key:
                self._send_json(400, {"ok": False, "message": "金鑰不可為空"})
                return

            save_key(key)
            API_KEY = key
            with _cache_lock:
                _cache.clear()
            self._send_json(200, {"ok": True})
            return

        self._send_json(404, {"ok": False, "message": "not found"})


def main():
    p = argparse.ArgumentParser(description="台版新楓之谷查詢站")
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8787)))
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--no-browser", action="store_true", help="啟動時不自動開瀏覽器")
    args = p.parse_args()

    _cache_load()

    url = "http://%s:%d/" % (args.host, args.port)
    server = ThreadingHTTPServer((args.host, args.port), Handler)

    print("=" * 54)
    print("  台版新楓之谷查詢站")
    print("  " + url)
    if API_KEY:
        tier = "開發階段" if API_KEY.startswith("test_") else "正式"
        print("  金鑰: %s… (%s)" % (API_KEY[:6], tier))
        print("  今日已用: %d / %d" % (quota_used(), daily_budget()))
    else:
        print("  金鑰: 未設定 — 請在網頁右上角填入")
    print("  快取: %d 筆" % len(_cache))
    print("  Ctrl+C 結束")
    print("=" * 54)

    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n儲存快取…")
        _cache_flush()
        print("已停止")
        server.server_close()


if __name__ == "__main__":
    main()
