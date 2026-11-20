# 補齊已接端點沒用到的欄位

## 目標

24 個端點都有抓回來，但回應裡有些欄位從來沒顯示出來（README「還沒做的」第二
節列過）。這次把其中**資訊量高、不需要新端點、不需要新分頁**的補上去，全部改
在既有的 renderer 裡。

**非目標：** 不接 `ranking/*`、`guild/*`、`notice/*`（那是另一個題目）。不動
Worker、不動快取層、不加新的 API 呼叫 —— 這些欄位都在已經抓回來的回應裡。

## 範圍

| # | 端點 | 欄位 | 顯示在哪 | 現況 |
|---|---|---|---|---|
| 1 | `symbol-equipment` | `symbol_drop_rate`、`symbol_meso_rate`、`symbol_exp_rate` | `renderSymbol()` 每張符文卡的 `lines` | `docs/app.js:2289` 只顯示 STR/DEX/INT/LUK/HP 與成長數 |
| 2 | `set-effect` | `set_effect_info[]`（`set_count` / `set_option`） | `renderOverview()` 套裝效果區 | `docs/app.js:1435` 只印「N 件套」，看不到每一段給什麼 |
| 3 | `hyper-stat` | `use_available_hyper_stat`（總點數）、每條的 `stat_point`（已配點數） | `renderOverview()` 極限屬性區 | `docs/app.js:1461` 只印剩餘點數 |
| 4 | `item-equipment` | `title.title_name`、`title_description`、`date_expire`、`date_option_expire`、`title_shape_*` | 總覽頁 EQUIPMENT 區 | 稱號整個沒顯示 |
| 5 | `familiar` | `familiar_exp` | `renderFamiliar()` | `docs/app.js:2150` |
| 6 | `beauty-equipment` | `base_color`、`mix_color`、`mix_rate` | `renderCosmetic()` | `docs/app.js:2236`，染髮混色沒顯示 |

`link-skill` 的 `character_owned_link_skill_preset_1~3`（自己持有的連結技能）
**列為待決**：它跟現有的「已裝備連結技能」是不同語意，放同一區會混淆，需要先
決定要不要另開一區。這一版先不做。

## 作法

每一項都是在既有 renderer 內加欄位，沿用現成的 helper：`itemCard()`、
`kvGrid()`、`title()`、`num()`、`txt()`。不新增抽象層。

- **符文加成**：三個 rate 是百分比，`0` 要濾掉（跟現有 stats 的
  `.filter(([, v]) => v && Number(v) !== 0)` 同一套邏輯），非 0 才顯示成
  「掉寶 +N%　楓幣 +N%　經驗 +N%」，接在現有 stats 那行後面。
- **套裝每段效果**：`set_effect_info` 是陣列，每筆是 `set_count` 與
  `set_option`（已對過 `cache.json` 的實際回應）。現在的 `kvGrid` 是一行一
  套裝，改成該套裝可展開列出每一段，預設收起 —— 套裝多的角色會把總覽頁撐爆。

  **不要重用 `collapsify()`**（`docs/app.js:1183`）：它只吃 `root` 的直接子
  元素、`real.length < 2` 會直接 return（只有一套套裝的角色就不會收合），而且
  `foldSave()`（`docs/app.js:1173`）展開時是「刪掉 key」，所以「沒有 key」代表
  展開，改成當收起會讓其他分頁既有的展開狀態全部失憶。這一區改用各自獨立的
  `<details>`，預設不帶 `open`，不碰共用的 `FOLD_KEY`。
- **極限屬性點數**：總點數用 `use_available_hyper_stat`（頂層欄位，實測 1608）。
  **`stat_point` 不是總點數** —— 它在每一條屬性裡，是那條已配的點數（實測預設組 1
  是 40/550/150/265/550/40），沒配點的是 `null`。兩者都顯示的話要分開標，別混用。
- **稱號**：`item-equipment` 的 `title` 是物件不是陣列，要獨立處理，不能塞進
  現有的裝備卡迴圈。到期資訊的欄位名是 `date_expire` 與 `date_option_expire`
  （不是 `title_*_expire_date`），兩者各自可能不存在，要獨立判斷。另外還有
  `title_shape_*`（外觀用的另一組），要不要顯示一併決定。`title_description`
  可能含換行。
- **染髮混色**：`mix_rate` 是 0 時代表沒混色，只顯示 `base_color`。

## 容錯

照專案既有原則（README「容錯設計」）：**每一項都要能單獨壞掉而不影響其他區**。
新欄位一律走「欄位不存在就不顯示這一行」，不要顯示 `undefined`、`null` 或
`NaN`。舊快取（`cache.json`）裡的回應可能沒有這些欄位，不能因此整區炸掉。

## 驗收

1. 六項在有資料的角色上都顯示得出來，數值與「原始資料」分頁裡的 JSON 對得起來。
2. 欄位缺失時該行消失，不出現 `undefined` / `NaN`，該區其他內容照常顯示。
3. 手機版 375 / 360 / 320 三個寬度都不破版、不水平捲動。
4. 既有分頁沒有回歸。

## 驗證指令

**前置條件（擋在驗收前面）：** `cache.json` 目前**沒有** `symbol-equipment`、
`familiar`、`beauty-equipment` 三個端點的回應，`tools/fixtures.js` 也沒有。
`make_fixtures.py` 生不出沒抓過的東西，`make_fake_fixtures.py` 六項一個都沒涵蓋
而且會覆蓋 `fixtures.js`。`tools/harness/mock.js:29` 對缺的端點回 403 —— 意思是
**版面掃描會綠燈通過，但那三項根本沒被畫出來**。所以兩條路：

1. **補抓真資料**（消耗配額）。注意 `tools/make_fixtures.py:32` 的
   `EXTRA_ENDPOINTS` 目前只有 `character/familiar` 與 `user/union-champion` ——
   **直接跑 `--fetch-missing` 補不到符文與造型**，要先把
   `character/symbol-equipment`、`character/beauty-equipment` 加進那個清單。
2. **擴充假資料**：讓 `make_fake_fixtures.py` 涵蓋這六項（含缺欄位／null／0 的
   變體）且不覆蓋既有的裝備資料。

**本計畫允許改動 `tools/` 底下的 fixtures 與 harness** —— 「只改 renderer」指的是
正式程式碼（`docs/app.js`），測試工具該補就補。**沒有 fixtures 就不算驗過。**

```bash
# 先把 symbol-equipment、beauty-equipment 加進 make_fixtures.py 的 EXTRA_ENDPOINTS
python tools/make_fixtures.py --fetch-missing   # 補齊符文／萌獸／造型（會用配額）
python tools/rwd_scan.py                        # 全分頁 375/360/320 版面掃描
python tools/rwd_scan.py --mode fold            # 收合行為
python tools/rwd_scan.py --shot 0               # 總覽頁截圖（裝備與稱號在總覽，不是分頁 1）
```

**分頁索引：** `docs/app.js:419` 的 `TABS` 裡裝備併在**總覽（index 0）**，index 1
是造型。原本寫的 `--shot 1` 截到的是造型頁，看不到稱號。

套裝效果的收合要另外驗：`tools/harness/driver.js:196` 只測總覽的第一個 fold
（角色基本資訊那塊），`runTabs` 不會展開套裝，而 `scan.js` 會跳過隱藏內容 ——
預設收起的內容等於沒被量到。需要補一段：確認初始是收起、點開後有內容、三個寬度
都不破版。

預期：`rwd_scan.py` 不報新的版面問題；截圖裡稱號與套裝每段效果看得到；
六項都確認有實際渲染出內容（不是端點 403 靜靜跳過）。

## 風險與假設

- ~~假設 `cache.json` 涵蓋這些欄位~~ —— **已查證，不成立**：符文、萌獸、造型
  三個端點的回應不在快取裡。處理方式見上面的前置條件。
- ~~假設 `set_effect_info` 的欄位名是 `set_count` / `set_option`~~ —— **已查證，
  成立**，快取裡的回應就是這兩個欄位。
- 稱號的 `title_shape_*`（外觀）要不要一起顯示還沒決定，先當作不做。
- 總覽頁已經很長，套裝效果展開後會更長 —— 收合預設必須是關的。
