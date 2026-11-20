# PLAN.md 審查紀錄

- **協調／規劃**：Claude Code（host，本次對話）
- **審查者**：Codex CLI 0.154.0，`exec -s read-only`，模型未指定（用 CLI 預設）
- **模式**：`mode=review`，**不建置、不檢查實作**（使用者明確只要跑審查）
- **授權範圍**：只寫 `PLAN.md` 與本檔，沒有動 `docs/`、`worker/`、`tools/` 任何一行
- **輪數**：上限原訂 2，實際用 3（第 2 輪冒出的 R6 修起來很小，多跑一輪拿到結論）
- **診斷檔**：留在 session 暫存區，不進 repo

| 輪 | 判定 | findings | 耗時 |
|---|---|---|---|
| 1 | REVISE | R1–R5（全 medium） | 122.8s |
| 2 | REVISE | R6（medium），R1–R4 已解 | 51.1s |
| 3 | **APPROVED** | 0 | 21.4s |

最終核准綁定 `PLAN.md` SHA256 `e3a46bb9a7351287…`，`runner check` verified。
計畫再改就要重審。

## 各 finding 的處置

六項**全部接受**，而且每一項都先自己回去對過程式碼才接受，不是照單全收。

| ID | 內容 | 查證 | 處置 |
|---|---|---|---|
| R1 | `stat_point` 不是總點數 | `cache.json` 的 hyper-stat 頂層沒有 `stat_point`；`use_available_hyper_stat` = 1608；`stat_point` 在每條屬性裡（預設組 1 是 40/550/150/265/550/40） | 接受，改用 `use_available_hyper_stat`，`stat_point` 另外標成「已配點數」 |
| R2 | 稱號到期欄位名寫錯 | 實際是 `date_expire`／`date_option_expire`，沒有 `title_*_expire_date` | 接受，欄位名改掉，兩者各自獨立判斷 |
| R3 | 不能重用 `collapsify()` | `foldSave()`（app.js:1173）展開時刪 key ⇒ 沒 key = 展開；`collapsify()`（app.js:1183）只吃直接子元素、`real.length < 2` 直接 return | 接受，改用獨立 `<details>`，不碰共用 `FOLD_KEY` |
| R4 | 驗證指令截錯分頁 | `TABS`（app.js:419）裝備在總覽 index 0，index 1 是造型；driver.js:196 只測第一個 fold；scan.js 跳過隱藏內容 | 接受，`--shot 1` 改 `--shot 0`，補上展開後再掃的步驟 |
| R5 | fixtures 根本沒有那三個端點 | `cache.json` 只有 15 個端點，缺 symbol-equipment／familiar／beauty-equipment；mock.js:29 對缺的端點回 403 ⇒ **掃描會綠燈但東西沒畫出來** | 接受，列為擋在驗收前的前置條件 |
| R6 | `--fetch-missing` 補不到 | `make_fixtures.py:32` 的 `EXTRA_ENDPOINTS` 只有 `character/familiar` 與 `user/union-champion` | 接受，計畫註明要先把 symbol／beauty 加進去，並釐清 `tools/` 可改 |

沒有任何一項被駁回。

## 還沒解決的

Codex 三輪都記著同一條限制，**核准沒有涵蓋它**：符文、萌獸、造型三個端點的
真實回應格式至今沒人對過（快取裡就是沒有）。計畫裡的欄位名是照 README 寫的，
`set_effect_info` 那組有對到實際回應、確認無誤，但這三個沒有。動工前要先補
fixtures，否則等於照著沒驗證過的欄位名寫程式 —— R1 與 R2 就是這樣錯的。

其餘限制：這是純計畫審查，沒有實作可驗，執行期行為與 RWD 都還沒碰。
