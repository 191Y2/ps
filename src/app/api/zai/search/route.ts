// Same-origin web search proxy for the Ace preview app.
// Server-side multi-source search: DuckDuckGo HTML results + Bing RSS
// + Wikipedia extracts + DuckDuckGo Instant Answers (+ Google News for
// newsy queries). 5-minute in-memory cache. No API keys needed.
// On GitHub Pages the app does the browser-direct equivalent instead.

export const dynamic = "force-dynamic";

const CACHE = new Map(); // q → { ts, refs }
const NEWSY = /\b(latest|news|today|yesterday|tonight|this week|this month|breaking|headline|score|game|won|winner|election|released|update on|rumor|trade|draft|signing|injured|championship|playoff)\b/i;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function withTimeout(ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, done: () => clearTimeout(t) };
}

/* Search engines return homepage junk for full natural-language
   questions — reduce to keyword form before searching. */
function cleanQuery(q) {
  let s = String(q || "");
  s = s.replace(/[?!.,;:"()\[\]—–]+/g, " ")
    .replace(/[\u2019']s\b/g, "")
    .replace(/[\u2019']/g, "")
    .replace(/\s+/g, " ").trim();
  const DROP = new Set(("what whats who whos when where why how which is are was were am do does did can could " +
    "will would should the a an of in on at to for from with about into over after before me you your my i " +
    "current currently latest right now today tell show give find get explain does there their it its and or " +
    "if so than then very really just please thanks thank his her hers she he they them him has have had").split(" "));
  const keep = s.split(" ").filter((w) => w && !DROP.has(w.toLowerCase()));
  let out = keep.join(" ").trim();
  if (out.split(" ").length > 8) out = keep.slice(0, 8).join(" ");
  return out || s.slice(0, 80);
}
const JUNK = /^(www\.)?(bing\.com|microsoft\.com|go\.microsoft\.com|duckduckgo\.com)$/i;

function stripTags(s) {
  return String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}
function decodeXML(s) {
  return String(s ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/* ---------- DuckDuckGo HTML results (POST endpoint) ---------- */
async function ddgWeb(q) {
  const t = withTimeout(9000);
  try {
    const body = new URLSearchParams({ q });
    const r = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: t.signal,
    });
    if (!r.ok) return [];
    const html = await r.text();
    const refs = [];
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map(m => m[1]);
    let m, i = 0;
    while ((m = re.exec(html)) && refs.length < 8) {
      let link = decodeURIComponent(m[1]);
      // DDG wraps links: //duckduckgo.com/l/?uddg=<encoded>&rut=...
      const uddg = link.match(/[?&]uddg=([^&]+)/);
      if (uddg) link = decodeURIComponent(uddg[1]);
      if (!/^https?:\/\//i.test(link)) continue;
      const title = stripTags(m[2]);
      if (!title) continue;
      refs.push({
        title,
        link,
        media: "DuckDuckGo",
        content: (snips[i] ? stripTags(snips[i]).slice(0, 400) : ""),
      });
      i++;
    }
    return refs;
  } catch { return []; }
  finally { t.done(); }
}

/* ---------- Bing RSS results ---------- */
function parseRSS(xml, max) {
  const out = [];
  try {
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    for (const it of items.slice(0, max)) {
      const title = decodeXML((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
      const link = ((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "").trim();
      const desc = stripTags(decodeXML((it.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || ""));
      const date = ((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "").trim();
      if (title && link) out.push({ title, link, content: (date ? `[${date}] ` : "") + desc.slice(0, 350) });
    }
  } catch { /* not xml */ }
  return out;
}
async function bingWeb(q) {
  const t = withTimeout(8000);
  try {
    const r = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss&count=10&mkt=en-US&setlang=en-US`,
      { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, signal: t.signal });
    if (!r.ok) return [];
    return parseRSS(await r.text(), 7).map((x) => ({ ...x, media: "Bing" }));
  } catch { return []; }
  finally { t.done(); }
}
async function googleNews(q) {
  const t = withTimeout(8000);
  try {
    const r = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`,
      { headers: { "User-Agent": UA }, signal: t.signal });
    if (!r.ok) return [];
    return parseRSS(await r.text(), 5).map((x) => ({ ...x, media: "Google News" }));
  } catch { return []; }
  finally { t.done(); }
}

/* ---------- Wikipedia search + intro extracts ---------- */
async function wikipedia(q) {
  const t = withTimeout(8000);
  try {
    const r = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=4&format=json&origin=*`,
      { headers: { "User-Agent": UA }, signal: t.signal });
    if (!r.ok) return [];
    const j = await r.json();
    const titles = (j?.query?.search || []).map((h) => h.title);
    if (!titles.length) return [];
    const refs = [];
    try {
      const t2 = withTimeout(8000);
      const r2 = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&redirects=1&titles=${encodeURIComponent(titles.slice(0, 3).join("|"))}&format=json&origin=*`,
        { headers: { "User-Agent": UA }, signal: t2.signal });
      t2.done();
      if (r2.ok) {
        const j2 = await r2.json();
        const pages = Object.values(j2?.query?.pages || {});
        for (const p of pages) {
          const ex = (p.extract || "").replace(/\s+/g, " ").trim();
          if (ex) refs.push({
            title: p.title,
            media: "Wikipedia",
            link: "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(p.title).replace(/ /g, "_")),
            content: ex.slice(0, 1200),
          });
        }
      }
    } catch { /* fall back to snippets */ }
    if (!refs.length) {
      for (const h of (j?.query?.search || []).slice(0, 3)) {
        refs.push({
          title: h.title,
          media: "Wikipedia",
          link: "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(h.title).replace(/ /g, "_")),
          content: stripTags(h.snippet || "").slice(0, 400),
        });
      }
    }
    return refs;
  } catch { return []; }
  finally { t.done(); }
}

/* ---------- DuckDuckGo Instant Answers ---------- */
async function ddgIA(q) {
  const t = withTimeout(7000);
  try {
    const r = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`,
      { signal: t.signal });
    if (!r.ok) return [];
    const j = await r.json();
    const refs = [];
    if (j.AbstractText) refs.push({
      title: j.Heading || q, media: "DuckDuckGo",
      link: j.AbstractURL || "https://duckduckgo.com/?q=" + encodeURIComponent(q),
      content: String(j.AbstractText).slice(0, 900),
    });
    (j.RelatedTopics || []).slice(0, 2).forEach((x) => {
      if (x?.Text && x?.FirstURL) refs.push({ title: x.Text.slice(0, 80), media: "DuckDuckGo", link: x.FirstURL, content: x.Text.slice(0, 300) });
    });
    return refs;
  } catch { return []; }
  finally { t.done(); }
}

function safeHost(link) {
  try { return new URL(link).hostname; } catch { return ""; }
}

/* Relevance validation — engines sometimes return cached junk that has
   NOTHING to do with the query (Bing RSS has degraded badly). Term-count
   ratios alone let "Islam the religion" pages through for "Islam Makhachev
   record" (islam+record = 2/4 terms). The fix: the LONGEST query term
   (usually the entity name) is an ANCHOR — a relevant result MUST mention
   it. Common words can never substitute for the entity. */
function isRelevant(ref: any, query: string, minRatio = 0.34) {
  const terms = String(query || "").toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (!terms.length) return true;
  const hay = ((ref?.title || "") + " " + (ref?.content || "")).toLowerCase();
  const anchor = terms.reduce((a, b) => (b.length > a.length ? b : a), terms[0]);
  if (anchor.length >= 5 && !hay.includes(anchor)) return false; // entity anchor miss
  let hits = 0;
  for (const t of terms) if (hay.includes(t)) hits++;
  return hits >= Math.max(1, Math.ceil(terms.length * minRatio));
}

export async function GET(req) {
  const rawQ = (new URL(req.url)).searchParams.get("q") || "";
  if (!rawQ.trim()) return Response.json({ refs: [] });
  const q = cleanQuery(rawQ);
  const key = q.toLowerCase().slice(0, 300);

  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.ts < 300000) return Response.json({ refs: cached.refs, cached: true });

  // Parallel engines. Whichever answers, answers — validated afterwards so
  // junk (Bing RSS's random cached pages) never reaches the model.
  const newsy = NEWSY.test(q);
  const jobs: Promise<any[]>[] = [bingWeb(q), ddgWeb(q), wikipedia(q), ddgIA(q)];
  const newsyRefs = newsy ? await googleNews(q).catch(() => []) : [];
  if (!newsy) jobs.push(googleNews(q).catch(() => [])); // broad fallback pool
  const settled = await Promise.all(jobs);
  let refs = settled.flat();

  // validate + dedupe + junk-domain filter
  const seen = new Set();
  refs = refs.filter((x) =>
    x?.link && x?.content && !JUNK.test(safeHost(x.link)) &&
    !seen.has(x.link) && seen.add(x.link));

  let good = refs.filter((x) => isRelevant(x, q));

  // news results are headlines — validate against a looser bar
  const goodNews = newsyRefs.filter((x) => isRelevant(x, q, 0.25));

  // merge: web results first, then news; if web came back thin, news fills in
  let final = [...good, ...goodNews.filter((n) => !good.some((g) => g.link === n.link))];
  if (final.length < 3) {
    const extra = refs.filter((x) => !final.some((f) => f.link === x.link) && isRelevant(x, q, 0.25));
    final = [...final, ...extra];
  }
  final = final.slice(0, 10);

  if (final.length) CACHE.set(key, { ts: Date.now(), refs: final });
  if (CACHE.size > 200) CACHE.delete(CACHE.keys().next().value);

  return Response.json(
    { refs: final },
    { headers: { "Cache-Control": "no-store" } }
  );
}
