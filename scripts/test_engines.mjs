// Test Bing RSS with mkt params + Mojeek HTML + DDG lite from node
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function test(name, url, opts) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, ...opts });
    const t = await r.text();
    console.log(`[${name}] ${r.status} ${t.length}b ${((Date.now()-t0)/1000).toFixed(1)}s`);
    return t;
  } catch (e) {
    console.log(`[${name}] ERR ${e.message}`);
    return "";
  }
}
function rssTitles(xml, n) {
  return [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].slice(0, n).map(it => {
    const t = (it[0].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const l = (it[0].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    return `  ${t.slice(0, 60)} | ${l.trim().slice(0, 60)}`;
  }).join("\n");
}
async function main() {
  const q = "Islam Makhachev record";
  // 1. Bing with US market
  const bing = await test("bing mkt", `https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss&count=10&mkt=en-US&setlang=en-US`);
  console.log(rssTitles(bing, 4));
  // 2. Mojeek HTML
  const moj = await test("mojeek", `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`);
  const mojLinks = [...moj.matchAll(/<a[^>]*class="ob"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 5);
  console.log("mojeek results:", mojLinks.length);
  mojLinks.forEach(m => console.log("  -", m[2].replace(/<[^>]+>/g, "").slice(0, 60), "|", m[1].slice(0, 60)));
  // 3. DDG lite POST
  const lite = await test("ddg lite", "https://lite.duckduckgo.com/lite/", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q }).toString(),
  });
  const liteLinks = [...lite.matchAll(/<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 5);
  console.log("ddg lite results:", liteLinks.length);
  liteLinks.forEach(m => console.log("  -", m[2].replace(/<[^>]+>/g, "").slice(0, 60)));
  // 4. Wikipedia from this IP
  try {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=3&format=json&origin=*`, { headers: { "User-Agent": UA } });
    console.log("[wikipedia]", r.status);
    if (r.ok) { const j = await r.json(); console.log("  ", (j.query?.search || []).map(h => h.title)); }
  } catch (e) { console.log("[wikipedia] ERR", e.message); }
}
main();
