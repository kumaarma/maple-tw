# -*- coding: utf-8 -*-
"""產生一份不含真實角色資料的最小 fixtures，讓沒有 API 金鑰的機器也能跑 harness。

make_fixtures.py 要 cache.json，而 cache.json 要有金鑰跑過 server.py 才會有 ——
在只想改前端、手邊沒有金鑰的機器上，harness 就整個跑不起來。

但有些模式其實不需要真資料。`--mode exp` 只用到兩個端點：`id`（拿 ocid）與
`character/basic`（driver 從這裡讀角色名去送查詢），經驗歷史本來就是
driver.js 的 seedExp() 自己塞進 localStorage 的。`--mode tabs` 也跑得動 ——
缺的端點會被 mock.js 回 403，app.js 的 d() 給 null，各處都有 null 保護，
量到的是「取不到資料」那個狀態的版面。

所以這裡只放首屏會用到的那幾個端點，值都是編的。

**這份資料驗不到什麼**：真實 API 回應的欄位形狀。要驗那個就得用
make_fixtures.py 從真的 cache.json 產生。--mode compare / hexa / soul
需要裝備、核心、靈魂武器的實際結構，用這份假資料會直接回報 fixtures 缺該端點。

用法：
    python tools/make_fake_fixtures.py
    python tools/rwd_scan.py --mode exp
"""

import argparse
import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 鍵是端點路徑，值是 { 日期或 "_": body }，跟 make_fixtures.py 的輸出同一個形狀。
# 這裡全部用 "_"（萬用）—— 假資料沒有逐日的必要。
FIX = {
    "id": {"_": {"ocid": "0" * 32}},
    "character/basic": {"_": {
        "character_name": "測試角色",
        "world_name": "測試伺服器",
        "character_gender": "女",
        "character_class": "夜光",
        "character_class_level": "6",
        # 用高等級：一天只前進百分之幾級，才驗得到成長欄的精度
        "character_level": 295,
        "character_exp": 7000000000000,
        "character_exp_rate": "2.710",
        "character_guild_name": "測試公會",
        "character_image": "",
        "character_date_create": "2015-03-01T00:00+08:00",
        "access_flag": "true",
        "liberation_quest_clear_flag": "1",
    }},
    "character/stat": {"_": {"final_stat": [
        {"stat_name": "戰鬥力", "stat_value": "123456789"},
        {"stat_name": "最大攻擊力", "stat_value": "9876543"},
        {"stat_name": "BOSS 怪物傷害增加", "stat_value": "364"},
        {"stat_name": "無視怪物防禦率", "stat_value": "94.72"},
    ]}},
    "character/popularity": {"_": {"popularity": 1234}},
    "character/dojang": {"_": {"dojang_best_floor": 51, "dojang_best_time": 123}},
    "user/union": {"_": {"union_level": 8500, "union_grade": "至尊楓葉 1 階",
                         "union_artifact_level": 60}},
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "tools", "fixtures.js"))
    args = ap.parse_args()

    if os.path.exists(args.out):
        print("覆蓋既有的 %s —— 若那是 make_fixtures.py 從真資料產生的，"
              "重跑一次就能拿回來。" % os.path.basename(args.out))

    with open(args.out, "w", encoding="utf-8") as f:
        f.write("// 由 tools/make_fake_fixtures.py 產生：編的資料，不含真實角色\n")
        f.write("window.__FIX = ")
        json.dump(FIX, f, ensure_ascii=False)
        f.write(";\n")

    print("已寫出 %s（%d 個端點，角色名「%s」）"
          % (args.out, len(FIX), FIX["character/basic"]["_"]["character_name"]))


if __name__ == "__main__":
    main()
