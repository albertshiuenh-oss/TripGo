# TripGo — 開發與自動優化規則

TripGo 是團體旅遊行程 PWA：單一檔案 `index.html`（HTML + CSS + JS，無 build），
Firebase Realtime Database + Google Maps + GitHub Pages。所有說明、PR、changelog 用繁體中文。

## 分支與上線
- `main` = 正式版，團員正在用。部署到 `https://albertshiuenh-oss.github.io/TripGo/`。
- `dev` = 優化版。部署到 `https://albertshiuenh-oss.github.io/TripGo/preview/`，資料寫在 `tripgo-preview/`（第一次進入某個團時會從正式資料複製一份，之後互不影響）。
- **只有 Albert 可以把 `dev` merge 進 `main`。** 自動化流程永遠不 push 到 `main`、不 merge PR、不改 `.github/`。

## 每次修改的流程
1. `npm ci && npm test` 確認起點狀態。
2. 修改 `index.html`：用 Python `str.replace()` 並 `assert` 舊字串只出現一次；不要整檔重寫。
3. 每個修正都要附一個測試（`tests/app.spec.mjs`）：修改前會失敗、修改後會通過。
4. `npm test` 全部通過才可以 commit。
5. 一個 PR 只 bump 一次版本：`node scripts/bump-version.mjs`（5.1 → 5.2），並在 `CHANGELOG.md` 最上面寫一段。

## 自動優化（排程任務）的優先順序
1. `dev` 上失敗的測試
2. 標籤 `error-report` 的 open issue（真實使用者的錯誤）
3. Albert 開的 issue（標籤 `bug` 或 `idea`）
4. 以上都沒有時，**最多挑一項**小優化：安全性（例如使用者輸入的名字直接放進 innerHTML → 用 `escHtml`）、效能、無障礙、明顯的程式錯誤、補測試。

## 禁止事項（要做的話只能寫在 PR 說明裡當「建議」）
- 改動 Firebase 資料結構、路徑、寫入邏輯的語意，或刪除任何資料
- 改 Firebase 設定、API key、外部服務
- 移除功能、大幅改版 UI、改配色或版面風格
- 新增外部相依套件或 CDN
- 單次修改 `index.html` 超過約 150 行

## 其他檔案
- `sw.js`、`manifest.json`、`icon-*`：PWA 設定。`sw.js` 目前**沒有被 index.html 註冊**。如果要註冊，service worker 的快取一定要排除 `/preview/`，否則預覽版和正式版會互相吃到快取。
- `tripgo-app.html`：舊版（v4.0）備份，不要修改。

## 測試環境
- `tests/harness.mjs` 把 Firebase、Google Maps、天氣、匯率、字型全部換成本機假資料（`tests/stubs/`、`tests/fixtures/seed.json`），測試完全離線。
- 測試團：`TEST01`，Albert（u1，組織者）、Anna、Ben、Cathy（兩台裝置），3 天大阪行程。
- 任何未捕捉的 JS 錯誤都會讓測試失敗。
- 在雲端 session 連不到 Firebase / Google，所以真實錯誤是透過 GitHub Action 每天整理成 issue。
