/* Unit test: blocks.js repair pipeline vs the EXACT failure from the user's screenshot:
   - Chinese-translated JSON keys (问题/难度/标题)
   - key-leak inside options array
   - full-width punctuation
   - mixed malformed shapes
   plus regression tests for valid payloads. */

// ---- minimal DOM shim so blocks.js can load outside a browser ----
global.window = global;
const makeEl = () => {
  const e = {
    children: [], style: {}, dataset: {}, classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { f === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (f ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); }
    },
    setAttribute() { }, getAttribute() { return null; }, removeAttribute() { },
    append(...n) { this.children.push(...n); }, appendChild(n) { this.children.push(n); return n; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() { }, removeEventListener() { },
    dispatchEvent() { return true; }, replaceWith() { }, remove() { },
    onclick: null, innerHTML: "", textContent: "", value: "", disabled: false,
    title: "", type: "", placeholder: ""
  };
  return e;
};
global.document = {
  createElement: () => makeEl(),
  createTextNode: (t) => ({ textContent: t }),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() { }, getElementById: () => null
};

const fs = require("fs");
const load = (p) => eval(fs.readFileSync("/home/z/my-project/public/ace/js/" + p, "utf8"));
load("config.js");
load("markdown.js");
load("blocks.js");

const B = Ace.Blocks;
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

/* ============ 1. the EXACT screenshot payload (Chinese keys + key leak) ============ */
const shot = `{"title":"UFC基础知识测验","难度":"medium","问题":[
{"q":"UFC是什么的缩写？","type":"mcq","options":["美国足球联盟","终极格斗锦标赛","美国篮球协会","大学摔跤联盟"],"answer":1,"explain":"UFC即终极格斗锦标赛"},
{"q":"以下哪种格斗技术不是UFC中的主要技术？","type":"mcq","options":["巴西柔术","type":"拳击","泰拳","摔跤"],"answer":0,"explain":"拳击也是UFC技术"},
{"q":"UFC比赛通常有几个重量级别？","type":"mcq","options":["5个","8个","10个","12+"],"answer":1,"explain":"共8个男子级别"},
{"q":"谁是UFC历史上第一位双级别冠军？","type":"short","answer":"康纳·麦格雷戈","accept":["Conor McGregor"]},
{"q":"UFC比赛通常有几个回合？","type":"mcq","options":["2个","3个","4个","5个"],"answer":1,"explain":"普通赛3回合，主赛5回合"}
]}`;

console.log("\n[1] Screenshot payload (Chinese keys + options key-leak)");
let d = B.parse(shot);
console.log("  parseLoose →", d === null ? "null" : (Array.isArray(d.questions) ? `obj with ${d.questions.length} questions` : JSON.stringify(d).slice(0, 80)));
// whatever parse gives us, render must produce a quiz (not code)
const rendered = B.render("quiz", shot, { save() { }, state: {} });
const isQuizCard = rendered && rendered.className && /blk-quiz/.test(String(rendered.className));
ok(isQuizCard, "renders as interactive quiz card, not code block");
if (isQuizCard) {
  // count questions inside
  const found = JSON.stringify(rendered.children.map(c => c.innerHTML || "")).match(/Question 1 of (\d+)/);
  console.log("  quiz questions rendered:", found ? found[1] : "?");
}

/* ============ 2. full-width punctuation ============ */
console.log("\n[2] Full-width punctuation");
const fw = `{"title":"测验"，"questions"：[{"q":"1+1=?"，"options"：["1"，"2"，"3"]，"answer"：1}，{"q":"2+2=?"，"options"：["3"，"4"，"5"]，"answer"：1}]}`;
d = B.parse(fw);
ok(d !== null && Array.isArray(d.questions) && d.questions.length === 2, "parses full-width ，：（） payload");
const fwRender = B.render("quiz", fw, { save() { }, state: {} });
ok(fwRender && /blk-quiz/.test(String(fwRender.className)), "full-width payload renders quiz");

/* ============ 3. truncated JSON (stream cut) ============ */
console.log("\n[3] Truncated payload → salvage keeps good questions");
const trunc = `{"title":"Trunc","questions":[{"q":"A?","options":["a","b"],"answer":0},{"q":"B?","options":["c","d"],"answer":1},{"q":"C?","options":["e","f"],"an`;
d = B.parse(trunc);
const r3 = B.render("quiz", trunc, { save() { }, state: {} });
ok(/blk-quiz/.test(String(r3.className)), "truncated payload still renders quiz (salvage)");
ok(d !== null, "parse salvage returned something");

/* ============ 4. valid quiz unchanged ============ */
console.log("\n[4] Valid quiz regression");
const valid = `{"title":"Photosynthesis basics","difficulty":"medium","questions":[
 {"q":"Which gas do plants absorb?","type":"mcq","options":["O2","CO2","N2","H2"],"answer":1,"explain":"CO2."},
 {"q":"Select ALL products","type":"multi","options":["Glucose","Oxygen","CO2","ATP"],"answers":[0,1,3],"explain":"."},
 {"q":"Mitochondria make food","type":"tf","answer":false,"explain":"Chloroplasts."},
 {"q":"Name the pigment","type":"short","answer":"chlorophyll","accept":["chlorophyll a"]}
]}`;
d = B.parse(valid);
ok(d !== null && d.questions.length === 4, "valid quiz parses");
const r4 = B.render("quiz", valid, { save() { }, state: {} });
ok(/blk-quiz/.test(String(r4.className)), "valid quiz renders");

/* ============ 5. answer as option text / letter ============ */
console.log("\n[5] Answer shape coercion");
const shapes = `{"title":"T","questions":[{"q":"Q1?","type":"mcq","options":["Alpha","Beta","Gamma"],"answer":"B"},{"q":"Q2?","type":"mcq","options":["Alpha","Beta","Gamma"],"answer":"Beta"},{"q":"Q3?","options":["Alpha","Beta"],"answer":1}]}`;
d = B.parse(shapes);
ok(d && d.questions.length === 3, "letter/text answers parse");
const r5 = B.render("quiz", shapes, { save() { }, state: {} });
ok(/blk-quiz/.test(String(r5.className)), "letter/text answers render");

/* ============ 6. other blocks with Chinese keys ============ */
console.log("\n[6] Chinese keys on non-quiz blocks");
const cnStats = `{"标题":"Q3 snapshot","项目":[{"标签":"Revenue","数值":"$48.2k","副标题":"+12%"},{"标签":"Users","数值":"1,240"}]}`;
const r6 = B.render("stats", cnStats, {});
ok(r6 && /blk-stats/.test(String(r6.className)), "stats block with Chinese keys renders");
const cnFc = `{"标题":"Deck","卡片":[{"正面":"A?","背面":"Answer"}]}`;
const r6b = B.render("flashcards", cnFc, { save() { }, state: {} });
ok(r6b && /blk-fc/.test(String(r6b.className)), "flashcards with Chinese keys renders");

/* ============ 7. missing colon between members ============ */
console.log("\n[7] Structural repairs");
const noc = `{"title":"X" "questions":[{"q":"Q?","options":["a","b"],"answer":0}]}`;
d = B.parse(noc);
ok(d !== null, "missing colon repaired");
const tc = `{"title":"X","questions":[{"q":"Q?","options":["a","b"],"answer":0},]}`;
d = B.parse(tc);
ok(d !== null, "trailing comma repaired");

/* ============ 8. json fence label (model wrote ```json) ============ */
console.log("\n[8] ```json fence shape inference");
const jfence = `{"title":"J","questions":[{"q":"Q?","options":["a","b"],"answer":0}]}`;
const r8 = B.render("json", jfence, { save() { }, state: {} });
ok(r8 && /blk-quiz/.test(String(r8.className)), "json-labeled quiz fence renders quiz");

/* ============ 9. truly hopeless payload → code block (no crash) ============ */
console.log("\n[9] Hopeless payload doesn't crash");
const junk = "this is just prose with no structure at all";
const r9 = B.render("quiz", junk, { save() { }, state: {} });
ok(r9 !== null && r9 !== undefined, "junk returns code block without throwing");

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
