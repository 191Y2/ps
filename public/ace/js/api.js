/* ============================================================
   Ace — api.js · GLM API client (browser-direct, CORS-verified)
   • streaming chat with reasoning support
   • automatic model fallback (balance 1113 / unknown model / thinking 1210)
   • thinking-error auto-retry (models that can't disable thinking)
   • REAL web search: multi-source (Wikipedia extracts + DuckDuckGo
     + Bing + news), browser-direct on GitHub Pages, through the
     same-origin /api/zai/search proxy when the host provides one
     (school-firewall-proof), with a 5-minute cache
   • deep research orchestration (sub-queries → parallel search
     → synthesized brief)
   Chat completions go to open.bigmodel.cn when browser-direct
   (CORS-open mirror of the Z.ai API — same key). api.z.ai's
   preflight blocks browser fetches, so it's proxy-only.
   ============================================================ */
"use strict";
window.Ace = window.Ace || {};
(function () {
  const A = { key: null, sessionWorked: {}, proxy: null };

  /* Same-origin proxy (auto-detected). On GitHub Pages this doesn't
     exist and the app talks to api.z.ai directly (CORS-verified).
     If a host provides /api/zai/ping (e.g. the Next.js preview), we
     route through it — handy behind strict firewalls too. */
  A.detectProxy = async () => {
    if (A.proxy !== null) return A.proxy;
    try {
      const r = await fetch("/api/zai/ping", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      A.proxy = !!(r.ok && j && j.proxy === "zai");
    } catch (e) { A.proxy = false; }
    return A.proxy;
  };
  /* chat completions URL is chosen per-attempt inside rawChat()
     (proxy → same-origin /api/zai/chat; direct → open.bigmodel.cn
     gateway rotation, see rawChat for why). */

  A.setKey = (k) => {
    A.key = String(k == null ? "" : k).trim()
      .replace(/^\"+/, "").replace(/\"+$/, "")  // strip any JSON quoting
      .replace(/^'+/, "").replace(/'+$/, "")
      .trim() || null;
  };
  A.hasKey = () => !!A.key;

  /* ---------- error normalization ---------- */
  function apiError(status, body) {
    let code = "", msg = "";
    try {
      const j = JSON.parse(body);
      code = (j.error && (j.error.code || j.error.type)) || j.code || "";
      msg = (j.error && j.error.message) || j.message || body.slice(0, 200);
    } catch (e) { msg = body.slice(0, 200) || `HTTP ${status}`; }
    const e = new Error(msg);
    e.code = String(code); e.status = status;
    if (code === "1113" || /balance|recharge/i.test(msg)) e.kind = "balance";
    else if (code === "1211" || /unknown model/i.test(msg)) e.kind = "unknown-model";
    else if (code === "1210" || /cannot be disabled/i.test(msg)) e.kind = "thinking";
    else if (status === 401 || code === "1002" || code === "1001" || /api[ _]?key/i.test(msg)) e.kind = "auth";
    else if (status === 429 || code === "1302" || code === "1305") e.kind = "rate";
    else e.kind = "other";
    return e;
  }

  A.friendlyError = (e) => {
    if (!e) return "Something went wrong.";
    if (e.kind === "balance")
      return "Your Z.ai key needs a resource package or balance for that model (error 1113). Ace automatically switched to the free model — everything still works.";
    if (e.kind === "auth") return "That Z.ai API key looks invalid or expired. Update it in Settings.";
    if (e.kind === "rate") return "Z.ai servers are busy — give it a couple of seconds and try again.";
    if (e.kind === "unknown-model") return "That model isn't available on your key — Ace fell back to the free model.";
    if (e.kind === "network")
      return "The connection to the GLM servers dropped — long builds stream for 1-3 minutes and school wifi sometimes cuts in. Everything streamed so far is saved; hit Retry and Ace picks up where it left off.";
    if (/Failed to fetch|NetworkError|network/i.test(e.message || ""))
      return "Can't reach the GLM API (open.bigmodel.cn) — check the wifi/firewall or your connection.";
    return e.message || "Something went wrong.";
  };

  /* abort-aware sleep (Stop button stays responsive during backoffs) */
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(), ms);
      if (signal) signal.addEventListener("abort", () => {
        clearTimeout(t);
        const e = new Error("aborted"); e.name = "AbortError"; reject(e);
      }, { once: true });
    });
  }

  /* ---------- low-level request ----------
     Network resilience (school wifi cuts connections at random):
     • PROXY mode: 3 connection attempts with backoff.
     • DIRECT mode (GitHub Pages): the open.bigmodel.cn gateways answer
       the CORS preflight only intermittently (~30-60% of requests,
       varying over time), and a blocked preflight rejects as
       "Failed to fetch" BEFORE any request is sent. Each attempt is a
       fresh dice roll on a fresh gateway, and a successful preflight
       is cached by the browser for 1h — so we try up to 12 times,
       alternating gateways (last-good first), with short backoffs.
       P(all 12 miss) at 30% odds ≈ 1.4%. A.warm() pre-heats this at
       boot so the first real message usually skips the dice entirely.
     • 429 → single polite retry after 2.2s on the gateway that
       connected. */
  let lastGoodBase = null; // gateway whose preflight last succeeded
  async function rawChat(payload, signal) {
    if (!A.key) { const e = new Error("No API key configured"); e.kind = "auth"; throw e; }
    const proxied = await A.detectProxy();
    const bases = (Ace.API_ENDPOINTS && Ace.API_ENDPOINTS.length)
      ? Ace.API_ENDPOINTS.slice() : [Ace.API_BASE];
    if (lastGoodBase) { // sticky: try the gateway that worked last time first
      const i = bases.indexOf(lastGoodBase);
      if (i > 0) bases.splice(i, 1), bases.unshift(lastGoodBase);
    }
    const maxAttempts = proxied ? 3 : 12;
    const mkUrl = (i) => proxied ? "/api/zai/chat" : (bases[i % bases.length] + Ace.API_PATH_CHAT);
    const doFetch = (url) => fetch(url, {
      method: "POST",
      headers: { "Authorization": "Bearer " + A.key, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal
    });
    const netErr = () => Object.assign(
      new Error("Can't reach the GLM API — check the wifi/firewall or your connection."), { kind: "network" });

    let res = null, usedUrl = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const url = mkUrl(attempt);
      try {
        res = await doFetch(url); usedUrl = url;
        if (!proxied) lastGoodBase = bases[attempt % bases.length];
        break;
      } catch (err) {
        if (err.name === "AbortError") throw err;
        if (attempt < maxAttempts - 1)
          await sleep(proxied ? 900 * (attempt + 1) : Math.min(1200, 350 * (attempt + 1)), signal);
      }
    }
    if (res === null) throw netErr();

    if (res.status === 429) { // brief backoff, single retry on the gateway that connected
      await sleep(2200, signal);
      try { res = await doFetch(usedUrl); }
      catch (err) { if (err.name === "AbortError") throw err; throw netErr(); }
    }
    if (!res.ok) throw apiError(res.status, await res.text());
    return res;
  }

  /* ---------- boot-time preflight warm-up ----------
     On static hosts the browser must win the gateway's flaky CORS
     preflight lottery at least once; after that win, the browser caches
     the preflight for 1h and every call flies. This fires one tiny
     (≈20-token) chat request right after boot so the lottery happens
     while the user is still typing — their first real message then
     connects instantly. Silent by design; once per page load. */
  let warmed = false;
  A.warm = async () => {
    if (warmed || !A.key) return;
    warmed = true;
    try { await A.detectProxy(); } catch (e) { return; }
    if (A.proxy) return; // same-origin proxy: no preflight lottery
    A.chat({
      model: "glm-4.5-flash", thinking: "disabled", maxTokens: 4, temperature: 0,
      messages: [{ role: "user", content: "Reply with: ok" }]
    }).catch(() => {});
  };

  /* ---------- messages → API format (vision content parts) ---------- */
  A.toAPIMessages = (msgs) => msgs.map(m => {
    if (m.role === "user" && m.images && m.images.length) {
      const parts = [];
      m.images.forEach(im => parts.push({ type: "image_url", image_url: { url: im.dataUrl || im } }));
      parts.push({ type: "text", text: m.content || "What's in this image?" });
      return { role: "user", content: parts };
    }
    const c = String(m.content || "").trim();
    return { role: m.role, content: c || (m.images && m.images.length ? "(image)" : "…") };
  });

  /* ---------- streaming chat ----------
     chain: models to try in order. On "balance"/"unknown-model" we walk
     down the chain. On "thinking" (model refuses thinking:disabled) we
     retry the SAME model with the thinking param dropped — thinking-on
     is that model's default. */
  A.stream = async (opts) => {
    opts = opts || {};
    const chain = opts.fallbackChain || [opts.model];
    let lastErr = null, noThinking = opts.noThinking || false;
    for (let ci = 0; ci < chain.length; ci++) {
      const model = chain[ci];
      if (!model) continue;
      try {
        const out = await streamOnce(model, opts, ci > 0, noThinking);
        A.sessionWorked[opts.taskKey || model] = model;
        return out;
      } catch (e) {
        if (e.name === "AbortError") throw e;
        lastErr = e;
        if (e.kind === "thinking" && !noThinking) { noThinking = true; ci--; continue; } // same model, drop thinking
        if (e.kind === "balance" || e.kind === "unknown-model" || e.kind === "thinking") {
          if (ci < chain.length - 1) {
            document.dispatchEvent(new CustomEvent("ace:model-fallback",
              { detail: { from: model, to: chain[ci + 1], task: opts.taskKey || "chat" } }));
            continue; // try next in chain
          }
        }
        throw e;
      }
    }
    throw lastErr;
  };

  async function streamOnce(model, opts, isFallback, noThinking) {
    const payload = { model, messages: A.toAPIMessages(opts.messages), stream: true };
    if (opts.maxTokens) payload.max_tokens = opts.maxTokens;
    if (opts.temperature != null) payload.temperature = opts.temperature;
    if (!noThinking && (opts.thinking === "disabled" || opts.thinking === "enabled"))
      payload.thinking = { type: opts.thinking };

    const res = await rawChat(payload, opts.signal);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", content = "", reasoning = "", usage = null, sources = [];
    const emit = throttle(() => opts.onDelta && opts.onDelta(content, reasoning), 60);
    let done = false;
    const guard = (fn) => (...a) => { if (!done) fn(...a); };
    const safeDelta = guard((c, r) => opts.onDelta && opts.onDelta(c, r));
    const safeReasoning = guard((r) => opts.onReasoning && opts.onReasoning(r));

    /* Long generations stream for 1-3 minutes; school wifi / filters
       sometimes cut the connection mid-stream. When that happens we do NOT
       throw away what already arrived — we return the partial text with
       interrupted:true so the caller can resume from where it stopped. */
    let dropped = false;
    try {
      while (true) {
        const { done: rdrDone, value } = await reader.read();
        if (rdrDone) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          let j; try { j = JSON.parse(data); } catch (e) { continue; }
          const ch = j.choices && j.choices[0];
          const d = (ch && (ch.delta || ch.message)) || {};
          if (d.content) { content += d.content; emit(); }
          if (d.reasoning_content) { reasoning += d.reasoning_content; safeReasoning(reasoning); }
          // search results can arrive in several shapes depending on model
          const sr = d.web_search || d.search_result || j.web_search || (ch && ch.message && ch.message.web_search);
          if (Array.isArray(sr) && sr.length) sources = sr;
          if (j.usage) usage = j.usage;
        }
      }
    } catch (err) {
      if (err.name === "AbortError") throw err;
      dropped = true; // connection cut mid-response
    }
    done = true;
    emit.cancel(); // kill any pending trailing call — the stream is over
    safeDelta(content, reasoning, true);
    if (dropped && !content && !reasoning) {
      const e = new Error("The connection to Z.ai dropped before any text arrived.");
      e.kind = "network"; throw e;
    }
    return { content, reasoning, usage, sources, model, fallbackUsed: isFallback, interrupted: dropped };
  }

  /* ---------- non-streaming convenience ---------- */
  A.chat = async (opts) => {
    const r = await A.stream(Object.assign({}, opts, { onDelta: null }));
    return r;
  };

  /* throttle helper for streaming callbacks — cancel() kills any
     pending trailing call so no delta can land after the stream ends */
  function throttle(fn, ms) {
    let last = 0, t = null, lastArgs = null;
    const wrapped = (...args) => {
      lastArgs = args;
      const now = Date.now();
      if (now - last >= ms) { last = now; fn(...lastArgs); }
      else if (!t) t = setTimeout(() => { t = null; last = Date.now(); fn(...lastArgs); }, ms - (now - last));
    };
    wrapped.cancel = () => { if (t) { clearTimeout(t); t = null; } };
    return wrapped;
  }

  /* ============================================================
     REAL WEB SEARCH
     Layer 1 (works everywhere incl. preview/school firewalls):
       same-origin proxy /api/zai/search when the host provides it.
     Layer 2 (GitHub Pages — browser-direct, CORS-verified):
       • Wikipedia search + full intro extracts (real, current facts)
       • DuckDuckGo Instant Answers (entity abstracts)
       • Best-effort: Bing web results + Google News headlines via
         public CORS proxies (silent-fail on 6s timeout)
     All layers: 5-minute per-query cache, never throws.
     ============================================================ */
  const searchCache = new Map(); // query → {ts, refs}
  const NEWSY = /\b(latest|news|today|yesterday|tonight|this week|this month|breaking|headline|score|game|won|winner|election|released|update on|rumor|trade|draft|signing| injured|championship|playoff)\b/i;

  function stripTags(s) {
    return String(s == null ? "" : s)
      .replace(/<[^>]+>/g, " ")
      .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/\s+/g, " ").trim();
  }
  function decodeXML(s) {
    return String(s == null ? "" : s)
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }
  function fetchTimeout(url, ms, opts) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    return fetch(url, Object.assign({ signal: ctl.signal, cache: "no-store" }, opts || {}))
      .finally(() => clearTimeout(t));
  }

  /* ---- Wikipedia: search + full intro extracts (CORS-open) ---- */
  async function wikiRefs(q) {
    const refs = [];
    try {
      const r = await fetchTimeout(
        "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
        encodeURIComponent(q) + "&srlimit=4&format=json&origin=*", 7000);
      if (!r.ok) return refs;
      const j = await r.json();
      const titles = (((j.query || {}).search) || []).map(h => h.title);
      if (!titles.length) return refs;
      // intro extracts for the top articles — real content, not just snippets
      try {
        const r2 = await fetchTimeout(
          "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&redirects=1&titles=" +
          encodeURIComponent(titles.slice(0, 3).join("|")) + "&format=json&origin=*", 7000);
        if (r2.ok) {
          const j2 = await r2.json();
          const pages = ((j2.query || {}).pages) || {};
          Object.values(pages).forEach(p => {
            const ex = (p.extract || "").replace(/\s+/g, " ").trim();
            if (ex) refs.push({
              title: p.title, media: "Wikipedia",
              link: "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(p.title).replace(/ /g, "_")),
              content: ex.slice(0, 1200)
            });
          });
        }
      } catch (e) { /* extracts failed — fall back to search snippets */ }
      if (!refs.length) {
        (((j.query || {}).search) || []).slice(0, 3).forEach(h => {
          refs.push({
            title: h.title, media: "Wikipedia",
            link: "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(h.title).replace(/ /g, "_")),
            content: stripTags(h.snippet).slice(0, 400)
          });
        });
      }
    } catch (e) { /* network-blocked or rate-limited */ }
    return refs;
  }

  /* ---- DuckDuckGo Instant Answers (CORS-open) ---- */
  async function ddgRefs(q) {
    const refs = [];
    try {
      const r = await fetchTimeout(
        "https://api.duckduckgo.com/?q=" + encodeURIComponent(q) +
        "&format=json&no_html=1&skip_disambig=1", 7000);
      if (!r.ok) return refs;
      const j = await r.json();
      if (j.AbstractText) refs.push({
        title: j.Heading || q, media: "DuckDuckGo",
        link: j.AbstractURL || "https://duckduckgo.com/?q=" + encodeURIComponent(q),
        content: String(j.AbstractText).slice(0, 900)
      });
      if (j.Answer && typeof j.Answer === "string")
        refs.push({ title: "Instant answer: " + q, media: "DuckDuckGo", link: "https://duckduckgo.com/?q=" + encodeURIComponent(q), content: stripTags(j.Answer).slice(0, 300) });
      (j.RelatedTopics || []).slice(0, 2).forEach(t => {
        if (t && t.Text && t.FirstURL) refs.push({ title: t.Text.slice(0, 80), media: "DuckDuckGo", link: t.FirstURL, content: t.Text.slice(0, 300) });
      });
    } catch (e) { /* silent */ }
    return refs;
  }

  /* ---- Best-effort: real web results (Bing RSS) + news (Google News RSS)
     via public CORS proxies. These public services come and go —
     each try has a short timeout and fails silently. (allorigins can
     take 7-10s on a cold request, so the budget is 9s per proxy.) ---- */
  const CORS_PROXIES = [
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u)
  ];
  async function fetchViaProxy(url, ms) {
    // race both proxies — first valid body wins (bounded by the timeout),
    // so a dead/slow proxy can't stretch the search phase
    const attempts = CORS_PROXIES.map(wrap => fetchTimeout(wrap(url), ms || 9000)
      .then(r => r.ok ? r.text() : null)
      .then(t => (t && t.length > 200) ? t : Promise.reject(new Error("empty"))));
    try { return await Promise.any(attempts); } catch (e) { return null; }
  }
  function parseRSS(xml, max) {
    const out = [];
    try {
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const it of items.slice(0, max)) {
        const title = decodeXML((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
        const link = (it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
        const desc = stripTags(decodeXML((it.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || ""));
        const date = (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
        if (title && link) out.push({ title, link: link.trim(), content: (date ? "[" + date.trim() + "] " : "") + desc.slice(0, 350) });
      }
    } catch (e) { /* not xml */ }
    return out;
  }
  async function bingRefs(q) {
    const xml = await fetchViaProxy(
      "https://www.bing.com/search?q=" + encodeURIComponent(q) + "&format=rss&count=10&mkt=en-US&setlang=en-US");
    if (!xml) return [];
    return parseRSS(xml, 6).map(r => Object.assign(r, { media: "Bing" }));
  }
  async function newsRefs(q) {
    const xml = await fetchViaProxy(
      "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=en-US&gl=US&ceid=US:en");
    if (!xml) return [];
    return parseRSS(xml, 5).map(r => Object.assign(r, { media: "Google News" }));
  }

  /* ---- search query cleanup: "What's Islam Makhachev's current record?"
     → "Islam Makhachev record" (search engines hate full questions) ---- */
  function searchQueryClean(q) {
    let s = String(q || "");
    s = s.replace(/[?!.,;:"()\[\]—–]+/g, " ")      // punctuation
      .replace(/[\u2019']s\b/g, "")                  // possessive 's
      .replace(/[\u2019']/g, "")                     // stray apostrophes
      .replace(/\s+/g, " ").trim();
    const DROP = new Set(("what whats who whos when where why how which is are was were am do does did can could " +
      "will would should the a an of in on at to for from with about into over after before me you your my i " +
      "current currently latest right now today tell show give find get explain does there their it its and or " +
      "if so than then very really just please thanks thank his her hers she he they them him has have had").split(" "));
    const keep = s.split(" ").filter(w => w && !DROP.has(w.toLowerCase()));
    let out = keep.join(" ").trim();
    if (out.split(" ").length > 8) out = keep.slice(0, 8).join(" "); // cap length
    return out || s.slice(0, 80);
  }

  /* ---- relevance validation ----
     Term-count ratios alone let "Islam the religion" pages through for
     "Islam Makhachev record" (2 of 4 terms = 50% ≥ the bar). The fix:
     the LONGEST query term (usually the entity name — "makhachev",
     "iphone", "photosynthesis"...) is an ANCHOR: a relevant result must
     mention it. Common words can never substitute for the entity. */
  function queryTerms(query) {
    return String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  }
  function isRelevant(ref, query, minRatio) {
    const terms = queryTerms(query);
    if (!terms.length) return true;
    const hay = ((ref && (ref.title + " " + ref.content)) || "").toLowerCase();
    const anchor = terms.reduce((a, b) => (b.length > a.length ? b : a), terms[0]);
    if (anchor.length >= 5 && !hay.includes(anchor)) return false; // entity anchor miss → junk
    let hits = 0;
    terms.forEach(t => { if (hay.includes(t)) hits++; });
    return hits >= Math.max(1, Math.ceil(terms.length * (minRatio || 0.34)));
  }

  /* ---- unified entry ---- */
  A.searchWeb = async (query) => {
    const q0 = String(query || "").trim().slice(0, 300);
    if (!q0) return [];
    const q = searchQueryClean(q0);
    const cached = searchCache.get(q.toLowerCase());
    if (cached && Date.now() - cached.ts < 300000) return cached.refs;

    let refs = [];
    try {
      const proxied = await A.detectProxy();
      if (proxied) {
        // Layer 1: our own server-side search (school-firewall-proof, full web results)
        try {
          const r = await fetchTimeout("/api/zai/search?q=" + encodeURIComponent(q), 12000);
          if (r.ok) {
            const j = await r.json();
            if (Array.isArray(j.refs)) refs = j.refs;
          }
        } catch (e) { /* fall through to direct */ }
      }
      if (!refs.length) {
        // Layer 2: browser-direct (GitHub Pages)
        const jobs = [wikiRefs(q), ddgRefs(q), bingRefs(q), newsRefs(q)];
        const settled = await Promise.all(jobs.map(p => p.catch(() => [])));
        refs = [].concat(...settled);
      }
    } catch (e) { refs = []; }

    // dedupe by link → relevance-filter (junk never reaches the model) → cap
    const seen = new Set();
    refs = refs.filter(x => x && x.link && x.content && !seen.has(x.link) && seen.add(x.link));
    let good = refs.filter(x => isRelevant(x, q));
    if (good.length < 2) good = refs.filter(x => isRelevant(x, q, 0.25)); // loosen before giving up
    good = good.slice(0, 10);
    if (good.length) searchCache.set(q.toLowerCase(), { ts: Date.now(), refs: good });
    return good;
  };

  /* legacy name kept for compatibility */
  A.freeWebSearch = A.searchWeb;

  /* extract source links from reply content (fallback when API
     doesn't return a web_search array) */
  A.extractSources = (content, existing) => {
    const seen = new Map();
    (existing || []).forEach(s => seen.set(s.link, s));
    const re = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|<(https?:\/\/[^\s>]+)>|(https?:\/\/[^\s<)\]]+)/g;
    let m;
    while ((m = re.exec(content || ""))) {
      const link = m[2] || m[3] || m[4];
      let host; try { host = new URL(link).hostname.replace(/^www\./, ""); } catch (e) { host = link; }
      if (!seen.has(link)) seen.set(link, { title: m[1] || host, link, media: host });
    }
    return Array.from(seen.values()).slice(0, 12);
  };

  /* ---------- deep research ---------- */
  A.deepResearch = async (opts) => {
    const { query, onStep, signal } = opts;
    const chain = opts.chain || [Ace.ROUTE.deep, "glm-4.5-flash"];
    const say = (label, state) => onStep && onStep(label, state);

    say("Breaking the question down", "run");
    let subq = [query];
    try {
      const r = await A.stream({
        model: chain[0], fallbackChain: chain, taskKey: "deep", signal,
        thinking: "disabled", temperature: 0.3, maxTokens: 300,
        messages: [{ role: "user", content: Ace.PROMPTS.deepSubqueries(query) }]
      });
      const mm = (r.content || "").match(/\[[\s\S]*\]/);
      if (mm) { const arr = JSON.parse(mm[0]); if (Array.isArray(arr) && arr.length) subq = arr.slice(0, 5).map(String); }
    } catch (e) { if (e.name === "AbortError") throw e; }

    say(`Searching ${subq.length} angles`, "run");
    const searches = await Promise.all(subq.map(async (q, i) => {
      say(`Search ${i + 1}/${subq.length}: ${q.slice(0, 60)}`, "run");
      try {
        const refs = await A.searchWeb(q).catch(() => []);
        const facts = refs.length
          ? refs.map((r, k) => `(${k + 1}) ${r.title} (${r.media}) — ${r.link}\n${r.content}`).join("\n\n")
          : "";
        return { q, facts, sources: refs };
      } catch (e) {
        if (e.name === "AbortError") throw e;
        return { q, facts: "", sources: [], error: e.message };
      }
    }));

    say("Synthesizing the brief", "run");
    const findings = searches.map((s, i) =>
      `### Sub-query ${i + 1}: ${s.q}\n${s.facts || "(no results)"}\nSources:\n${(s.sources || []).map(x => `- ${x.title} — ${x.link}`).join("\n") || "(none)"}`).join("\n\n");
    const synth = await A.stream({
      model: chain[0], fallbackChain: chain, taskKey: "deep", signal,
      temperature: 0.5, maxTokens: 6000,
      messages: [{ role: "user", content: Ace.PROMPTS.deepSynthesize(query, findings) }]
    });

    const allSources = [];
    searches.forEach(s => (s.sources || []).forEach(x => { if (!allSources.some(y => y.link === x.link)) allSources.push(x); }));
    say("Done", "done");
    return { report: synth.content, sources: allSources, subqueries: subq, model: synth.model };
  };

  /* ---------- key test ---------- */
  A.testKey = async (key) => {
    const saved = A.key; A.key = key.trim();
    try {
      await A.chat({ model: "glm-4.5-flash", thinking: "disabled", maxTokens: 8,
        messages: [{ role: "user", content: "Reply with exactly: OK" }] });
      return { ok: true };
    } catch (e) { return { ok: false, error: e }; }
    finally { A.key = saved; }
  };

  Ace.API = A;
})();
