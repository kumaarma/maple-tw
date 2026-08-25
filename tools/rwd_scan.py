# -*- coding: utf-8 -*-
"""用無頭 Chrome 掃版面問題。

拿的是真的 docs/index.html 與真的 docs/app.js，只把 fetch 換成讀
fixtures。這一點很重要：先前用手寫的樣板測，結果漏掉了沒放進樣板的
搜尋表單，那裡剛好有一個 260px 的空白破洞。

會回報兩種毛病：
  * 橫向溢出（元素超出畫面，且沒有祖先在做橫向捲動）
  * 空白破洞（容器高度遠大於子元素實際佔用的範圍）

用法：
    python tools/rwd_scan.py                     角色查詢全部分頁，375/360/320
    python tools/rwd_scan.py --mode compare      裝備比對
    python tools/rwd_scan.py --mode hexa         六轉進度
    python tools/rwd_scan.py --mode soul         靈魂武器
    python tools/rwd_scan.py --mode exp          經驗追蹤
    python tools/rwd_scan.py --mode hist         最近查詢卡片
    python tools/rwd_scan.py --widths 375        只測一個寬度
    python tools/rwd_scan.py --shot 1            截圖第 1 個分頁（裝備）
    python tools/rwd_scan.py --shot 1 --widths 1100    桌機版對照

找到問題時結束碼為 1，方便接進其他流程。
"""

import argparse
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
HARNESS = os.path.join(TOOLS, "harness")
WORK = os.path.join(TOOLS, ".work")

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome():
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    found = shutil.which("chrome") or shutil.which("google-chrome")
    if found:
        return found
    sys.exit("找不到 Chrome，請用 --chrome 指定路徑。")


def url(path):
    return "file:///" + os.path.abspath(path).replace("\\", "/")


def build_page():
    """從真的 index.html 產生測試頁：抽掉 app.js，換成 fixtures + mock + 真 app.js。"""
    fixtures = os.path.join(TOOLS, "fixtures.js")
    if not os.path.exists(fixtures):
        sys.exit("缺少 tools/fixtures.js，先跑：python tools/make_fixtures.py")

    src = open(os.path.join(ROOT, "docs", "index.html"), encoding="utf-8").read()
    src = src.replace('href="style.css"',
                      'href="%s"' % url(os.path.join(ROOT, "docs", "style.css")))

    inject = "\n".join([
        '<script src="%s"></script>' % url(fixtures),
        '<script src="%s"></script>' % url(os.path.join(HARNESS, "mock.js")),
        '<script src="%s"></script>' % url(os.path.join(ROOT, "docs", "app.js")),
        '<pre id="diag" style="all:revert;background:#fff;color:#000;'
        'font:11px monospace;padding:6px;white-space:pre-wrap"></pre>',
        '<script src="%s"></script>' % url(os.path.join(HARNESS, "scan.js")),
        '<script src="%s"></script>' % url(os.path.join(HARNESS, "driver.js")),
    ])

    if '<script src="app.js"></script>' not in src:
        sys.exit("index.html 裡找不到 app.js 的 script 標籤，測試頁產生器要更新。")
    src = src.replace('<script src="app.js"></script>', inject)

    os.makedirs(WORK, exist_ok=True)
    out = os.path.join(WORK, "page.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(src)
    return out


def run_chrome(chrome, target, extra, timeout=180):
    profile = tempfile.mkdtemp(prefix="rwd-profile-")
    cmd = [chrome, "--headless=new", "--no-sandbox", "--disable-gpu",
           "--hide-scrollbars", "--allow-file-access-from-files",
           "--force-device-scale-factor=1",
           "--user-data-dir=" + profile,
           "--virtual-time-budget=120000"] + extra + [target]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout)
        return r.stdout
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def extract_diag(dom_bytes):
    html = dom_bytes.decode("utf-8", "replace")
    m = re.search(r'<pre id="diag">(.*?)</pre>', html, re.S)
    if not m:
        return "（抓不到測試輸出，Chrome 可能沒跑完）"
    t = m.group(1)
    for a, b in [("&quot;", '"'), ("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&")]:
        t = t.replace(a, b)
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="tabs",
                    choices=["tabs", "compare", "fold", "hexa", "soul", "exp",
                             "hist"])
    ap.add_argument("--widths", default="375,360,320",
                    help="CSS 寬度，逗號分隔。320 是最窄的實機，360 是多數 Android")
    ap.add_argument("--shot", type=int, default=None,
                    help="改成截圖模式。tabs 模式下是分頁索引（0=總覽, 1=裝備…）；"
                         "其他模式忽略這個數字，直接截該模式的結果")
    ap.add_argument("--chrome", default=None)
    args = ap.parse_args()

    chrome = args.chrome or find_chrome()
    page = build_page()
    runner = url(os.path.join(HARNESS, "runner.html"))
    widths = [int(w) for w in args.widths.split(",") if w.strip()]
    problems = 0

    for w in widths:
        if args.shot is not None:
            # iframe 高度要接近視窗高度，內容才會在 iframe 內捲動；設太高
            # 就不需要捲，驅動裡的 scrollTo 等於沒作用，截到的會是最上面的
            # 角色卡而不是分頁內容。
            # tabs 模式下 --shot 的數字是分頁索引；其他模式沒有分頁可切，
            # 就直接截那個模式跑完的樣子（數字忽略）。
            if args.mode == "tabs":
                frag = "mode=tab&i=%d" % args.shot
                tag = "tab%d" % args.shot
            else:
                frag = "mode=%s" % args.mode
                tag = args.mode
            target = "%s?p=%s&%s&w=%d&h=1250" % (runner, url(page), frag, w)
            shot = os.path.join(WORK, "shot-%d-%s.png" % (w, tag))
            run_chrome(chrome, target, ["--screenshot=" + shot,
                                        "--window-size=%d,1400" % (w + 145)])
            print("已截圖 %s" % shot)
            continue

        target = "%s?p=%s&mode=%s&w=%d&h=1400" % (runner, url(page), args.mode, w)
        dom = run_chrome(chrome, target, ["--dump-dom",
                                          "--window-size=%d,900" % (w + 145)])
        text = extract_diag(dom)
        print("=" * 56)
        print("寬度 %dpx　模式 %s" % (w, args.mode))
        print("=" * 56)
        print(text)
        print()
        problems += text.count("***")

    if args.shot is None:
        print("找到 %d 處問題。" % problems if problems else "全部通過。")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
