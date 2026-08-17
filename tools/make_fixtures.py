# -*- coding: utf-8 -*-
"""從本機快取產生離線測試資料（fixtures）。

本機代理跑過查詢之後，cache.json 裡就有真實的 API 回應。把它整理成
一份 JS 檔，測試頁載入後就能讓 app.js 完整跑起來而一次 API 都不打。

快取沒涵蓋到的端點（例如從沒點開過的分頁），加 --fetch-missing 可以
用 apikey.txt 補抓，一個端點一次呼叫。

產生的 fixtures.js 含角色資料，已列入 .gitignore，不會被提交。

用法：
    python tools/make_fixtures.py
    python tools/make_fixtures.py --fetch-missing
"""

import argparse
import collections
import io
import json
import os
import sys
import urllib.error
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://open.api.nexon.com/maplestorytw/v1/"

# app.js 會用到、但可能沒被快取到的端點。都吃 ocid。
EXTRA_ENDPOINTS = ["character/familiar", "user/union-champion"]


def load_cache(path):
    if not os.path.exists(path):
        sys.exit("找不到 %s —— 先啟動 server.py 查詢一次角色，快取才會產生。" % path)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build(cache):
    """cache 的鍵是完整上游網址，值是 [到期時間, JSON 字串]。

    整理成 { 端點路徑: { 日期或 "_": 已解析的 body } }。
    經驗分頁會逐日抓，所以要保留日期；其他端點用 "_" 當萬用。
    """
    fix = collections.defaultdict(dict)
    ocid = None

    for url, entry in cache.items():
        if "/v1/" not in url:
            continue
        body = entry[1] if isinstance(entry, list) and len(entry) == 2 else None
        if not body:
            continue

        tail = url.split("/v1/", 1)[1]
        path, _, qs = tail.partition("?")
        params = dict(p.split("=", 1) for p in qs.split("&") if "=" in p)
        if "ocid" in params:
            ocid = params["ocid"]

        try:
            parsed = json.loads(body)
        except ValueError:
            continue
        if isinstance(parsed, dict) and "error" in parsed:
            continue        # 錯誤回應沒有當測試資料的價值

        fix[path][params.get("date", "_")] = parsed
        fix[path].setdefault("_", parsed)

    return fix, ocid


def fetch(path, ocid, key):
    q = "ocid=%s" % ocid
    req = urllib.request.Request(BASE + path + "?" + q,
                                 headers={"x-nxopen-api-key": key})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode("utf-8", "replace"))
    except Exception as e:                                  # noqa: BLE001
        return {"error": {"name": "LOCAL", "message": str(e)}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(ROOT, "cache.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "tools", "fixtures.js"))
    ap.add_argument("--fetch-missing", action="store_true",
                    help="快取沒有的端點改用 apikey.txt 直接抓（會消耗配額）")
    args = ap.parse_args()

    fix, ocid = build(load_cache(args.cache))
    if not fix:
        sys.exit("快取裡沒有可用的回應。")
    print("從快取取得 %d 個端點，ocid=%s…" % (len(fix), (ocid or "?")[:8]))

    if args.fetch_missing:
        missing = [p for p in EXTRA_ENDPOINTS if p not in fix]
        if not missing:
            print("沒有需要補抓的端點。")
        elif not ocid:
            print("快取裡找不到 ocid，無法補抓。")
        else:
            keyfile = os.path.join(ROOT, "apikey.txt")
            if not os.path.exists(keyfile):
                print("找不到 apikey.txt，跳過補抓。")
            else:
                with open(keyfile, encoding="utf-8") as f:
                    key = f.read().strip()
                for path in missing:
                    body = fix[path]["_"] = fetch(path, ocid, key)
                    note = ("錯誤：" + body["error"]["name"]) if "error" in body \
                        else "OK（%d 個欄位）" % len(body)
                    print("  補抓 %-24s %s" % (path, note))

    with open(args.out, "w", encoding="utf-8") as f:
        f.write("// 由 tools/make_fixtures.py 產生，含角色資料，勿提交\n")
        f.write("window.__FIX = ")
        json.dump(fix, f, ensure_ascii=False)
        f.write(";\n")

    size = os.path.getsize(args.out) / 1e6
    print("已寫出 %s（%.1f MB，%d 個端點）" % (args.out, size, len(fix)))


if __name__ == "__main__":
    main()
