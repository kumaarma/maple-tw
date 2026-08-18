# 版面測試工具

用無頭 Chrome 把整個站跑起來，自動點過每個分頁，找出手機版的版面問題。

跑的是**真的 `docs/index.html` 與真的 `docs/app.js`**，只把 `fetch` 換成讀本機
資料，所以一次 API 都不打。這一點是刻意的：先前用手寫的 HTML 樣板測過一次，
結果漏掉了沒放進樣板的搜尋表單，而那裡剛好有一個 260px 的空白破洞。要測就得
測真的頁面。

## 需要什麼

- Python 3（只用標準函式庫）
- Chrome（Windows 的預設安裝路徑會自動找到，或用 `--chrome` 指定）
- `cache.json` —— 先用 `server.py` 查過角色，快取才會有資料

## 用法

```bash
# 1. 產生離線測試資料（讀 cache.json）
python tools/make_fixtures.py

#    快取沒涵蓋的端點（萌獸、聯盟冠軍）要補抓的話，會消耗 2 次 API 配額
python tools/make_fixtures.py --fetch-missing

# 2. 掃版面
python tools/rwd_scan.py                    # 角色查詢全部分頁，375/360/320
python tools/rwd_scan.py --mode compare     # 裝備比對
python tools/rwd_scan.py --mode fold        # 區塊收合與顯示開關（功能測試）
python tools/rwd_scan.py --mode hexa        # 六轉進度（功能測試）
python tools/rwd_scan.py --widths 375       # 只測一個寬度

# 3. 截圖（眼睛看還是必要的，掃描器只抓得到量得出來的東西）
python tools/rwd_scan.py --shot 1                  # 第 1 個分頁＝裝備
python tools/rwd_scan.py --shot 1 --widths 1100    # 桌機版對照
```

截圖與產生的測試頁放在 `tools/.work/`（已忽略）。找到問題時 `rwd_scan.py`
的結束碼是 1。

## 會抓到什麼

**橫向溢出** —— 元素右緣超出畫面，而且沒有任何祖先在做橫向捲動。在
`.tablewrap` 這種自捲容器裡的不算，那是刻意的設計。

**空白破洞** —— 容器高度遠大於子元素實際佔用的範圍。這類問題幾乎都來自
同一個原因：橫排改直排後，`flex-basis` 從量寬度變成量高度。例如
`.controls label.grow { flex: 1 1 260px }` 在手機版就撐出一塊 260px 的空白。
格線的 `align-items: stretch` 把矮卡片拉平也會被抓到。

破洞判定用的是「子元素的**範圍**（最下緣 − 最上緣）」而不是「高度總和」。
多欄格線與換行排版各自加總會嚴重高估空白，整份報告會吵到沒法看。

`--mode compare` 另外會檢查兩件跟資料有關的事：各裝備頁是不是都含圖騰／
拼圖／寶石（它們不隨分頁換裝），以及逐格比對有沒有把它們排到最後。

`--mode fold` 測的是互動與狀態：點區塊標題會不會收起來、狀態有沒有寫進
localStorage、逐格比對的三個顯示開關關掉後元素是不是真的消失。這類功能
壞掉時畫面照樣渲染，光看截圖看不出來。

`--mode hexa` 測的是算出來的數字。fixtures 那隻角色核心全滿，等於只驗得到 100%
一種情況 —— 進度算錯（例如把還沒開啟的核心漏出分母）在滿版角色身上照樣顯示
100%。所以會先把核心等級改寫成一組手算得出答案的值（技能 30/25、精通
30/30/18/7、強化 30/12/0/3、共用只放 1 個），再比對畫面上的
59.7%、215/360、還差 145 級、未滿級 6 個，以及材料 706 艾爾達 / 20,614 碎片
（6 顆未滿的核心加上少放的那 1 個共用核心從 0 起算），以及 6 個核心圖示。
圖示量的是 `.hicon img` 而不是 `.hicon` —— 抓不到圖時 `.hicon` 會退成文字，
量容器的話永遠是滿分。

## 兩個踩過的坑

**Chrome 的 `--window-size` 不是版面寬度。** 它指定的是外框，實際 CSS 寬度
會更大 —— 實測給 390 會得到 485。直接截圖只是把 485px 的版面裁成 390px，
看起來像元素被切掉，很容易誤判成版面 bug。所以這裡一律用 `harness/runner.html`
的 iframe 把寬度鎖死，媒體查詢照 iframe 的寬度算。

**驗證指標要選對。** 曾經拿「僅一方持有」的註記當指標，但那個註記只有
「同一件裝備對比」模式會產生，在預設模式下量到的永遠是 0 —— 看起來通過，
其實什麼都沒驗到。現在改用 `.cmp-none`（未裝備）計數，三種配對模式都適用。

同樣的坑會反方向咬人：`--mode fold` 一開始拿同一隻角色跟自己比，每格
都相同就不會產生 `.swap-metrics`，開關測試量到 0 個元素，誤報成功能壞掉。
現在會先把 B 側換成另一組裝備頁製造出差異，而且量到 0 個元素時回報
「無法判定」而不是失敗。

## 檔案

| 檔案 | 作用 |
|---|---|
| `make_fixtures.py` | `cache.json` → `fixtures.js` |
| `rwd_scan.py` | 產生測試頁、跑 Chrome、輸出報告 |
| `harness/runner.html` | 用 iframe 鎖死版面寬度，輪詢取結果 |
| `harness/mock.js` | 把 `fetch` 換成讀 fixtures |
| `harness/scan.js` | 溢出與破洞的偵測邏輯 |
| `harness/driver.js` | 點分頁、切配對模式、收集結果 |

`fixtures.js` 含角色資料，從 `cache.json` 產生，已列入 `.gitignore`。
