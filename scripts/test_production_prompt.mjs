// Verifies the PRODUCTION chat prompt (real prompts.js + real search refs)
// produces grounded answers. Run: node test_production_prompt.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
globalThis.window = { Ace: {} };
globalThis.Ace = globalThis.window.Ace;
new Function(fs.readFileSync(path.resolve(__dirname, "../download/ace/js/prompts.js"), "utf8"))();

const KEY = "84defeb435fb416e8c19ab99f5e6f71a.7727UW2uFGeraDb5";
const API = "https://api.z.ai/api/paas/v4/chat/completions";

const q = process.argv[2] || "who is islam makhachev and whats his current record";
const searchHost = "http://localhost:3000/api/zai/search";

const refs = (await (await fetch(searchHost + "?q=" + encodeURIComponent(q))).json()).refs;
console.log(`query: ${q}\nrefs: ${refs.length}${refs.length ? " | ref[0]: " + refs[0].title.slice(0, 60) : ""}`);

const sys = Ace.PROMPTS.chat({ webSearch: true, refs, memories: [], summary: "" });
const refPos = sys.lastIndexOf("Reference material");
console.log(`prompt: ${sys.length} chars | refs positioned at ${(100 * refPos / sys.length).toFixed(0)}% (want >60% = near end)`);

let grounded = 0;
const RUNS = Number(process.argv[3] || 3);
for (let i = 0; i < RUNS; i++) {
  const t0 = Date.now();
  const r = await fetch(API, {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "glm-4.5-flash", max_tokens: 700, temperature: 0.35,
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: q },
      ],
    }),
  });
  const j = await r.json();
  const c = (j.choices?.[0]?.message?.content) || "";
  const ok = /29-1|29–1|29 wins|29-1-0|29–1–0/i.test(c);
  if (ok) grounded++;
  console.log(`  run ${i + 1}: ${((Date.now() - t0) / 1000).toFixed(1)}s GROUNDED=${ok} :: ${c.slice(0, 180).replace(/\n/g, " ")}`);
}
console.log(`\n${grounded}/${RUNS} runs grounded (29-1 from refs)`);
process.exit(grounded === RUNS ? 0 : 1);
