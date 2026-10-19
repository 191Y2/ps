// Test DDG HTML POST from node (same as the Next.js route does)
async function main() {
  const t0 = Date.now();
  try {
    const body = new URLSearchParams({ q: "Islam Makhachev record" });
    const r = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    console.log("status", r.status, "in", ((Date.now() - t0) / 1000).toFixed(1) + "s");
    const html = await r.text();
    console.log("len", html.length);
    const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)].slice(0, 5);
    console.log("result links:", links.length);
    links.forEach(m => console.log(" -", m[1].slice(0, 90)));
    const snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 3);
    console.log("snippets:", snips.length);
    // check for anomaly page
    if (html.includes("anomaly") || html.includes("challenge")) console.log("!! anomaly/challenge page detected");
  } catch (e) {
    console.log("ERROR", e.message, e.cause && e.cause.message);
  }
}
main();
