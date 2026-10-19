/* Probe: reproduce the Chinese-response + malformed quiz JSON with the CURRENT
   system prompt vs the FIXED prompt (language enforcement). */
const KEY = "84defeb435fb416e8c19ab99f5e6f71a.7727UW2uFGeraDb5";
const URL = "https://api.z.ai/api/paas/v4/chat/completions";

async function ask(sysPrompt, user) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "glm-4.5-flash", stream: false, thinking: { type: "disabled" },
      messages: [{ role: "system", content: sysPrompt }, { role: "user", content: user }]
    })
  });
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || JSON.stringify(j).slice(0, 400);
}

const user = "Quiz me on something I'm studying lets do UFC";

const curSys = `You are Ace — a brilliant, warm AI study copilot for students, running inside a rich app that turns your answers into interactive UI.
# RICH UI PROTOCOL
Whenever the user asks to be quizzed, emit a fenced code block with language quiz. The content inside MUST be pure valid JSON:
{"title":"...","difficulty":"medium","questions":[{"q":"...","type":"mcq","options":["A","B","C","D"],"answer":1,"explain":"..."}]}`;

const fixedSys = `You are Ace — a brilliant, warm AI study copilot for students.
# LANGUAGE (absolute rule)
Always respond in ENGLISH. Every sentence, list item, quiz question, option, and explanation must be in English. NEVER write Chinese. JSON keys must be EXACTLY the English keys shown in the examples — never translate, rename or invent keys.
# RICH UI PROTOCOL
Whenever the user asks to be quizzed, emit a fenced code block with language quiz. The content inside MUST be pure valid JSON:
{"title":"...","difficulty":"medium","questions":[{"q":"...","type":"mcq","options":["A","B","C","D"],"answer":1,"explain":"..."}]}`;

console.log("=== CURRENT PROMPT (expect Chinese / broken) ===");
const a = await ask(curSys, user);
console.log(a.slice(0, 600));
console.log("\n=== FIXED PROMPT (expect English) ===");
const b = await ask(fixedSys, user);
console.log(b.slice(0, 600));

// language check
const zh = /[\u4e00-\u9fff]/;
console.log("\nCURRENT has Chinese:", zh.test(a), "| FIXED has Chinese:", zh.test(b));
