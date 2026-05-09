# Anonymous Feedback Wall

A full-stack, fully anonymous feedback platform built entirely on free-tier services.

---

## Architecture

```
User → Astro Frontend (Cloudflare Pages)
         └──fetch──► Cloudflare Worker API (feedback-wall-api.workers.dev)
                         ├──KV cache hit──► Return cached JSON (fast path)
                         └──KV cache miss──► Supabase PostgreSQL (REST API)
                                                └──store result──► Cloudflare KV (TTL 60s)
```

**Data Flow:**

1. **Submit**: User fills out the form → Astro sends `POST /api/submit` to the Worker → Worker validates, writes to Supabase, refreshes KV cache → returns success.
2. **Read**: Astro sends `GET /api/messages` → Worker checks KV (`latest_messages` key). Cache hit → immediate JSON response (< 5 ms). Cache miss → fetch top-50 rows from Supabase → store in KV → return JSON.

---

## Technologies Used

| Layer    | Technology                                             | Role                                                  |
| -------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Frontend | [Astro](https://astro.build)                           | Static site generation, zero-JS-by-default pages      |
| Hosting  | [Cloudflare Pages](https://pages.cloudflare.com)       | CDN deployment of the static frontend                 |
| API      | [Cloudflare Workers](https://workers.cloudflare.com)   | Edge serverless runtime (TypeScript, no Node.js)      |
| Cache    | [Cloudflare KV](https://developers.cloudflare.com/kv/) | Low-latency globally-replicated key-value store       |
| Database | [Supabase](https://supabase.com)                       | Managed PostgreSQL with REST API & Row Level Security |

---

## Setup Steps

### 1. Supabase — Database

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** and run:

```sql
CREATE TABLE feedbacks (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT,
  message    TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE feedbacks ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert
CREATE POLICY "Allow public insert" ON feedbacks
  FOR INSERT TO anon WITH CHECK (true);

-- Allow anyone to read
CREATE POLICY "Allow public select" ON feedbacks
  FOR SELECT TO anon USING (true);
```

3. Copy your **Project URL** and **anon public key** from **Settings → API**.

---

### 2. Cloudflare Worker — Backend API

```bash
cd worker-api
npm install
```

**Create KV namespace:**

```bash
npx wrangler kv:namespace create FEEDBACK_KV
# Note the `id` printed, paste it into wrangler.toml → [[kv_namespaces]]

npx wrangler kv:namespace create FEEDBACK_KV --preview
# Note the `id` printed, paste it into wrangler.toml → preview_id
```

**Edit `wrangler.toml`** — replace placeholder KV IDs.

**Set secrets** (never commit these):

```bash
npx wrangler secret put SUPABASE_URL
# Paste your Supabase project URL when prompted

npx wrangler secret put SUPABASE_ANON_KEY
# Paste your Supabase anon key when prompted
```

**Deploy:**

```bash
npx wrangler deploy
# Note the *.workers.dev URL printed at the end
```

---

### 3. Astro Frontend — Deployment

```bash
cd astro-frontend
npm install
```

**Local development:**

```bash
# Edit .env and set PUBLIC_WORKER_URL to your local wrangler dev URL
npm run dev
```

**Production deploy via Cloudflare Pages:**

1. Push your repo to GitHub.
2. Go to [Cloudflare Dashboard → Pages](https://dash.cloudflare.com) → **Create a project** → Connect to GitHub.
3. Select the repo, then configure:
    - **Build command**: `npm run build`
    - **Build output directory**: `dist`
    - **Root directory**: `astro-frontend`
4. Add environment variable in Pages settings:
    - `PUBLIC_WORKER_URL` = `https://feedback-wall-api.YOUR-SUBDOMAIN.workers.dev`
5. Click **Save and Deploy**.

---

## Deployment Checklist

- [ ] Create Supabase project and run the SQL schema above
- [ ] Enable RLS and add INSERT + SELECT policies
- [ ] Copy Supabase URL and anon key
- [ ] Create KV namespace: `wrangler kv:namespace create FEEDBACK_KV`
- [ ] Create KV preview namespace: `wrangler kv:namespace create FEEDBACK_KV --preview`
- [ ] Paste both KV IDs into `worker-api/wrangler.toml`
- [ ] Run: `wrangler secret put SUPABASE_URL`
- [ ] Run: `wrangler secret put SUPABASE_ANON_KEY`
- [ ] Run: `wrangler deploy` — note the `*.workers.dev` URL
- [ ] Set `PUBLIC_WORKER_URL` in Cloudflare Pages environment variables
- [ ] Connect GitHub repo to Cloudflare Pages
    - Build command: `npm run build`
    - Output directory: `dist`
    - Root directory: `astro-frontend`

---

## Assumptions

- Messages are **truly public** — anyone can read all submissions (no auth).
- `name` is optional; defaults to `"Anonymous"` if blank.
- KV cache TTL is **60 seconds** (balances freshness vs. cost).
- Rate limiting: **5 submissions per IP per minute** (KV-based, best-effort).
- All services use **free tiers**:
    - Supabase: 500 MB DB, 2 GB egress/month
    - Cloudflare Workers: 100,000 requests/day
    - Cloudflare KV: 100,000 reads/day, 1,000 writes/day
    - Cloudflare Pages: unlimited static requests

---

## Local Development

**Worker (with live KV):**

```bash
cd worker-api
npm install
npx wrangler dev   # Runs at http://localhost:8787
```

**Frontend:**

```bash
cd astro-frontend
npm install
# Set PUBLIC_WORKER_URL=http://localhost:8787 in .env
npm run dev        # Runs at http://localhost:4321
```
