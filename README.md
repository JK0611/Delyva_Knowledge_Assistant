# Vibe Coding - FAQ Bot (Delyva Assistant)

這是一套基於 React, Vite 搭配 Express 開發的智能客服機器人系統，整合了 Google Gemini API，能夠讀取知識庫文件給予準確的回覆。

## 功能介紹
* **獨立後端代理 Server**: 透過 Express 處理 Gemini API 請求，防護 API Key 不外洩。
* **分離式架構**: 前端 React 與後端分離，前端僅需向 `/api/chat` 發送對話紀錄，由後端注入提示詞(知識庫與防護措施)後詢問 AI。
* **一鍵雙開**: 開發環境內建 `npm run dev:all` 腳本，透過 concurrently 一次啟動前端與後端，大幅增加開發效率。
* **自動化部署**: 已配置 GitHub Action，當推送至 `main` 分支時，會自動將前端構建部署至 GitHub Pages。 

## 開發指南


1. **安裝環境與依賴 Package**
   ```bash
   npm install
   ```

2. **設定環境變數**
   請將根目錄的 `.env.example` 複製或重新命名為 `.env`，並放入真實的介接鑰匙：
   ```env
   GEMINI_API_KEY=your_actual_api_key_here
   ```

3. **啟動測試是否可以運行**
   我們已經配置了同時啟動前端(Port 3000)與後端(Port 3001)的腳本：
   ```bash
   npm run dev:all
   ```
   > 啟動完成後，前端網頁與 Express API 就會完美運行了，您可以直接在網頁上送出聊天資料。

## 部署上線 (GitHub Actions)

專案預設包含 `.github/workflows/deploy.yml` 檔案。
當您 push 更新到 `main` 時，GitHub Actions 會執行以下任務：
1. 自動安裝套件並構建 React 前端 (`npm run build`)。
2. 將打包輸出目錄 `dist` 透過 GitHub Pages 發佈，實現自動上線。

**注意：**
- 此 Action 專門用於部署靜態前端。若要在線上環境提供完整的 AI 代理服務，您也需要將後端的 `server.js` 部署到如 Render、Heroku 或 Zeabur 等 Node.js 主機（部署後請記得更新前端內部請求 API 的來源並開啟後端 CORS 配置）。

## 資料夾控管與隱私防護

- **.gitignore**: 我們採用業界標準配置設計了 `.gitignore`，已過濾 Node.js `node_modules` 快取、IDE設定（如 `.vscode`）、OS暫存與最關鍵的 `.env` 檔案以避免私鑰上傳。
