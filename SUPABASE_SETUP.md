# ☁️ Supabase 雲端同步設定指南

## 1. 開 Supabase Project（一次性）

1. 去 [supabase.com](https://supabase.com) → Sign Up（推薦 GitHub 帳號登入）
2. New Project：
   - **Name**: `classview-plickers`（或你喜歡嘅名）
   - **Database Password**: 記低佢（雖然我哋唔直接用 Postgres）
   - **Region**: Singapore（最近香港）
3. 等 1-2 分鐘 project 創建好

## 2. 拎 API Credentials

去 Project Settings → API：

- **Project URL**: `https://xxxxx.supabase.co`
- **anon public key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (一段 JWT)

⚠️ **Anon key 係設計畀前端用**（公開安全），但**要小心唔好喺公開地方分享** URL + key combo。淨係喺 app 設定入面輸入。

## 3. 創建 Table

去 Supabase dashboard → **SQL Editor** → New Query → 貼下面 SQL 然後 Run：

```sql
-- 創建用戶資料表
create table public.classview_user_data (
  user_id text primary key,
  username text not null,
  data jsonb not null,
  updated_at timestamptz default now()
);

-- 啟用 RLS
alter table public.classview_user_data enable row level security;

-- ⚠️ Demo 設定：允許任何人讀寫
-- 適合學校內部用。如果要公開 deploy，請改成 Supabase Auth + 嚴格 RLS：
--   create policy "Users can only access own data" on classview_user_data
--     for all using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
create policy "Allow all access" on public.classview_user_data
  for all using (true) with check (true);

-- 自動更新 updated_at
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_user_data_updated_at
  before update on public.classview_user_data
  for each row execute function public.update_updated_at();
```

## 4. 喺 App 設定

1. 開 `https://gregarious-nougat-f22d6c.netlify.app/`
2. 登入
3. 點右上 user button → 拉去最底
4. 喺「☁️ 雲端同步」section 點「⚙️ 設定」
5. 貼 URL + anon key
6. 儲存

## 5. 用法

- **⬆️ 上傳到雲端**：將本地 state push 上去（會覆蓋雲端你嗰個 row）
- **⬇️ 從雲端還原**：從雲端 fetch 並覆蓋本地

⚠️ 兩個操作都係**直接覆蓋**（冇 merge）。建議上傳前先匯出備份。

## 6. 安全考量

- anon key + URL combo = 完整讀寫權限
- 只喺**信任嘅裝置 + 瀏覽器**入面輸入
- 如果懷疑外洩：去 Supabase dashboard → Settings → API → Roll Keys
- 為咗更安全：改成 Supabase Auth（email/password / magic link）配嚴格 RLS
  - 我可以幫你做埋，但需要 user 提供 email 服務（如 Supabase 內建 or Resend）

## 7. Free Tier 限制

- 500 MB database storage
- 50,000 monthly active users
- 5 GB bandwidth

對一間學校用綽綽有餘。
