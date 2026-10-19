# Ace — AI Study Copilot

A single-folder, **100% static** AI chat + agentic app built for school work. Runs on **GitHub Pages** (github.io), works on school Chromebooks, no server, no build step, no Node.js.

Powered by **GLM models from Z.ai** — with real memory, live web search that actually works (junk-filtered, relevance-scored), a per-answer **task stopwatch**, interactive quiz UI, rich answer cards (scorecards, comparisons, stats), photo homework solving, a **+ attach menu** (images / files / **zip auto-extraction**), and an **Agent mode** builder that plans → builds → reviews → ships real apps and games.

---

## ✨ What it does

| Feature | How it works |
|---|---|
| **Real memory** | After conversations, a background pass extracts durable facts about you (grade, subjects, deadlines, goals). Memories are scored by importance × recency decay × relevance, reinforced when used, and injected into every chat — **across all chats, including old ones**. Manage everything in the Memory panel. |
| **Web search that works** | The **Web** toggle runs a **real multi-engine search** (Bing web results + DuckDuckGo + Wikipedia full extracts + Google News), cleans your question into keyword form, **validates every result for relevance** (junk results that have nothing to do with your question are dropped before the AI ever sees them), caches for 5 minutes, shows a live **"Searching the web · 3.4s"** stopwatch, renders **real source chips**, and forces the AI to ground claims in what was actually found — if sources don't cover it, Ace says so instead of making things up. On GitHub Pages the search runs browser-direct (Wikipedia + DDG are CORS-open); on the preview it routes through the bundled same-origin `/api/zai/search` proxy so school firewalls can't kill it. |
| **Task stopwatch** | Every answer shows what Ace did and how long each phase took: `Searching the web · 3.4s` → `Thinking · 2.1s` → `Writing · 6.3s` → `Creating quiz UI · 7.9s` → **`Worked for 12.5s`**. Agent mode steps are timed too (`Planning the build · 1.3s`, `Building v1 · 58.9s` …). |
| **Deep research** | The **Deep** toggle breaks your question into 3–5 sub-queries, searches them in parallel, and synthesizes a cited research brief with UI cards. |
| **Quiz UI** | Ask to be quizzed and answers turn into **interactive quizzes** — multiple choice, multi-select, true/false, short answer — with instant feedback, explanations, scoring, retry, and a "make it harder" button. Multiple quizzes per message. A **4-pass JSON-repair pipeline** fixes the model's occasional malformed quiz JSON (missing colons/commas, string answers, odd types, full-width Chinese punctuation, even key collisions inside arrays) instead of dumping raw code — and if all repairs fail, a **regex extractor salvages every recognizable question** so a quiz still renders. |
| **Answer cards** | Ratings and comparisons render as **scorecards** (9.7/10 style), **KPI stat grids**, **comparison tables** with winner checkmarks, **timelines**, **flashcards**, **step-by-step** guides, **vocab cards**, and **study plans** — plus normal Markdown (headings, lists, tables) for casual answers. |
| **Photo homework** | Upload / **Ctrl+V paste** / drag & drop images (up to 4 per message). They route to the free **GLM-4.6V Flash** vision model. |
| **+ attach menu** | The **+** button opens: **Upload images**, **Attach files** (text & code — .txt .md .js .py .html .csv … sent for the AI to view), and **Upload zip**. |
| **Zip extractor** | Drop a `.zip` and Ace **extracts every file inside, entirely in your browser** (zero dependencies — built on the browser's native DecompressionStream). Text/code files become AI-readable attachments, images become image attachments, junk (`__MACOSX/`, `.DS_Store`) is skipped. Ask questions about the project, or upload it in **Agent mode** and the builder extends it. |
| **Agent mode (agentic builder)** | Toggle **Chat → Agent**. Describe an app or game; the agent **reads your request → plans → builds (single-file HTML, with a live streaming code panel that shows what section it's writing and how fast) → self-reviews (score /10 + issues) → fixes real breakage → ships** with a sandboxed live preview, full-screen run, download button, and version iteration ("make X better" → v2). Zip uploads are treated as source material to build on. Runs on the free model — no balance needed — and you can **switch the builder model** from the top bar. |
| **Think** toggle | Same fast free model with **reasoning enabled** — you see the thinking stream and a `Thinking · X.Xs` chip. |
| **Voice input** | Mic button (Chrome, uses your browser's speech recognition). |
| **Firebase sync** | Chats + memories sync to **your** Firebase (anonymous auth). If Firebase is unreachable, the app silently saves to this device instead — it never blocks you. |
| **Key stays out of GitHub** | Your Z.ai API key is pasted once on first launch and stored in your Firestore (`config/secrets`) — it never ships in the repo, and everyone you share the deployed app with gets it automatically. |

**Smart model routing (free-first, auto):** everything runs on **GLM-4.5 Flash** (free, instant — reasoning off) · images → `GLM-4.6V Flash` (free) · **Think** → GLM-4.5 Flash with reasoning on. Premium models (GLM-5.3 etc.) are available in Settings for keys with balance; on errors 1113/1211/1210 Ace **automatically falls back to the free model** and keeps working.

---

## 🚀 Deploy to GitHub Pages (~4 minutes)

1. **Create a repo** on GitHub (public or private — GitHub Pages on free plans needs public, or use Pro).
2. **Upload the contents of this folder** (the `ace/` folder: `index.html`, `css/`, `js/`) to the repo root — drag & drop on github.com works, or:
   ```bash
   git init && git add . && git commit -m "Ace" && git push https://github.com/YOU/YOUR-REPO.git main
   ```
3. **Turn on Pages:** repo → Settings → Pages → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save.
4. Wait ~1 minute → your app is live at `https://YOU.github.io/REPO-NAME/`.

> Nothing in the repo contains your API key. It gets stored in your Firebase only.

---

## 🔥 One-time Firebase setup (~3 minutes)

This makes chats/memories sync across devices and shares your API key with anyone opening the app.

1. Open the [Firebase Console](https://console.firebase.google.com) → project **chat-84076** (the config is already wired in `js/config.js`).
2. **Anonymous auth:** Build → Authentication → Get started → Sign-in method → **Anonymous → Enable**.
3. **Add your GitHub Pages domain:** Authentication → Settings → **Authorized domains** → Add domain → `YOU.github.io` (add `preview-….space-z.ai` too if you want the preview link to sync).
4. **Create Firestore:** Build → Firestore Database → Create database → Start in **production mode** → pick a region.
5. **Paste these rules** (Firestore → Rules tab → Publish):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // shared API key: readable by anyone using the app (signed-in anon),
       // writable only from the console or the app's first-run setup
       match /config/secrets {
         allow read: if request.auth != null;
         allow write: if request.auth != null;  // lock to false + seed manually if you prefer
       }
       // each user can only touch their own data
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
   > Stricter option: set the secrets rule to `allow write: if false;` and add the key by hand in Firestore → Start collection `config` → doc `secrets` → field `apiKey` (string).

6. **Open your deployed app** → paste your Z.ai API key → **Launch Ace**. Done — the key now lives in Firebase and everyone who opens the app can use it (nothing in GitHub).

**If you skip Firebase setup:** the app still works fully — it shows *"Saved on this device"* and keeps everything in the browser. No blockers, just no cloud sync.

---

## 🗝️ API key notes

- Get a free key at **z.ai → API Keys** (open platform).
- **Free tier (verified Oct 2026):** `glm-4.5-flash` (text — fast, thinks by default) and `glm-4.6v-flash` (vision). Ace routes everything to these by default so it **works with zero balance**.
- Flagship models (`glm-5.3`, `glm-5.2`, `glm-4.7`…) need credit or a resource package on your Z.ai account. If you see **error 1113**, Ace falls back to the free Flash model automatically. Top up at z.ai → Billing to unlock flagship quality for Work mode and Think mode.
- The Z.ai server-side web-search tool also requires balance on free keys — that's why Ace grounds web answers in **Wikipedia + DuckDuckGo references by default** (always free, always honest). Add balance and full web search activates on its own.

---

## 🏫 School / blocked-network notes

- The whole app is static HTML/CSS/JS from one folder — same as any website. It talks to `api.z.ai` (CORS-enabled, verified) and `en.wikipedia.org` / `api.duckduckgo.com` for references, plus `gstatic.com` for Firebase.
- If the school network blocks a domain, Ace degrades gracefully: no Firebase → local storage; no references → the AI says when it couldn't verify instead of guessing; no API → clear error with a retry.
- Works on managed Chromebooks (Chrome 89+), no installs.
- **Long builds are drop-proof**: Agent builds stream for 1–3 minutes, and school wifi sometimes cuts long connections. If that happens, Ace keeps everything that already streamed and continues the file from where it stopped (you'll see "connection hiccup, resuming" in the trace) — the build survives instead of failing. Connection attempts also auto-retry 3× with backoff before any error is shown.

---

## 🧠 Anti-hallucination (how Ace stays honest)

- Factual/current-events questions get **real web references** automatically (even with the Web toggle off) — Wikipedia, DuckDuckGo, Bing and news, junk-filtered with an entity-anchor check so off-topic pages never reach the model.
- References sit at the **end of the system prompt** with a numbers-discipline rule: every number/named fact must be traceable to a reference, or Ace says it couldn't verify it.
- **Temperature 0.35** for factual answers (research-backed hallucination reduction), plus honesty rules with today's date so the model knows when its memory is stale.
- If references come back empty, Ace tells you it may be out of date instead of guessing — no invented numbers, dates, or URLs.

---

## 🎮 Using Agent mode

1. Toggle **Agent** at the top (the model chip becomes a **builder-model picker**).
2. Describe what you want: *"build a snake game with juice and high scores"* — or upload a **zip of an existing project** to extend it.
3. Watch the live agent trace: **Reading your request → Plan (features, steps, palette) → Building (live code stream, section detection, KB/s) → Self-review (score /10 + issues) → Fix → Shipped** — every step timed.
4. Play it in the embedded preview, **Open app** full screen, or **Download** the single `.html` file (works offline).
5. Ask for changes — *"add sound effects"* — it ships **v2** building on v1. Your projects stay in the sidebar and reopen when you switch back to the Agent tab.

## 📁 Files

```
├── index.html        # app shell
├── css/style.css     # design system (dark, minimalist)
├── css/blocks.css    # AI UI component styles
└── js/
    ├── config.js     # firebase config, models, icons, helpers
    ├── prompts.js    # all system prompts (persona, UI protocol, agent, memory) — English-locked
    ├── markdown.js   # safe markdown renderer
    ├── blocks.js     # quiz/scorecard/stats/compare/flashcards/steps/timeline/terms/table/progress + JSON repair
    ├── storage.js    # Firestore + localStorage fallback adapter
    ├── api.js        # Z.ai client: streaming, vision, relevance-validated web search, deep research, fallbacks
    ├── memory.js     # extraction, recall scoring, summaries, titles
    ├── images.js     # upload / paste / drag-drop / downscale
    ├── files.js      # + menu: file attachments + zero-dependency zip extractor
    ├── chat.js       # chat engine, sidebar, send flow, stopwatch, sources, export
    ├── work.js       # Agent mode: analyze → plan → build → review → fix → ship
    └── app.js        # boot, settings, memory manager, toggles, agent model picker, voice
```

**Made for getting school work done — and getting your friend into college.** ⚡
