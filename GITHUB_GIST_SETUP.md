# ☁️ GitHub Gist 雲端同步設定指南

## 🎯 1 分鐘 setup

用你 **已經有嘅 GitHub 帳號** + 1 個 Personal Access Token，搞掂。

## Step 1: 拎 GitHub PAT（1 分鐘）

1. 去 https://github.com/settings/tokens/new
2. **Note** 填：`classview-sync`
3. **Expiration**：90 days（或 No expiration）
4. **Scopes**：只剔 `☑ gist`（其他唔剔）
5. 撳 **Generate token**
6. **即刻複製 token**（GitHub 只顯示一次）

個 token 大約係：`ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

## Step 2: 喺 App 設定

1. 開 https://gregarious-nougat-f22d6c.netlify.app/
2. 登入
3. 點右上 user button → 拉去最底
4. 喺「☁️ 雲端同步」section 撳「⚙️ 設定」
5. 貼 token
6. 撳「💾 儲存」

## Step 3: 試 Sync

- 撳「⬆️ 上傳」→ 自動建立 private Gist `classview-state.json`
- 之後改動再撳「⬆️ 上傳」就會更新 Gist
- 喺另一個 device / browser → 輸入同一個 PAT → 撳「⬇️ 從雲端還原」就 sync 到

## 🔒 安全

- Token 只會儲存喺 **你個瀏覽器**嘅 localStorage（**唔會** 上傳去任何 server）
- 建議用 `gist` only scope（讀寫 Gist 專用，**唔可以** 動你嘅 repo / user data）
- 如果外洩：去 https://github.com/settings/tokens 撳 **Revoke** 即可

## ⚠️ 限制

- GitHub Gist 500 KB 限制（足夠學校用）
- 5,000 requests/hour per token（足夠）
- Token 過期前要 regenerate（GitHub 會 email 提你）

## 🆚 點解唔用 Supabase？

我之前做咗 Supabase 版本（SQL schema + URL + anon key），但 setup 7 個 step 太多。
GitHub Gist 版本：1 個 step — generate 1 個 PAT，1 分鐘搞掂。
對學校 / 教師用夠晒。