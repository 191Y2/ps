/* ============================================================
   Ace — blocks.js · AI UI component system
   The AI emits ```quiz / ```scorecard / etc. JSON fences; these
   render as polished interactive cards — the "AI UI" layer.
   Includes a battle-tested JSON repair pipeline (the model sometimes
   emits slightly broken JSON: missing colons/commas, string answers,
   odd types — we fix or salvage instead of dumping raw code).
   All user-facing strings are escaped. State is saved per message.
   ============================================================ */
"use strict";
window.Ace = window.Ace || {};
(function () {
  const esc = Ace.esc, el = Ace.el, mdInline = (s) => Ace.MD.inline(s || "");
  const norm = (s) => String(s == null ? "" : s).toLowerCase().trim()
    .replace(/[.,!?;:'"()]+/g, "").replace(/\s+/g, " ");

  function btn(label, cls, icon) {
    const b = el("button", "btn " + (cls || ""), (icon ? Ace.ICON(icon, 14) : "") + label);
    return b;
  }

  /* ============================================================
     JSON REPAIR PIPELINE
     Pass 1: strict JSON.parse
     Pass 2: structural regex repairs (trailing commas, missing
             colons after keys, smart quotes, full-width Chinese
             punctuation, unquoted keys, key-leak inside arrays…)
     Pass 3: surgical salvage — extract top-level arrays/values and
             parse them individually, dropping only the broken items
     Pass 4: bracket balancing + final attempts
     ============================================================ */
  function parseLoose(body) {
    const s = String(body == null ? "" : body).trim();
    if (!s) return null;
    // strip a stray markdown fence or prose around the JSON
    // 1. strict
    try { return JSON.parse(s); } catch (e) { /* continue */ }
    // 2. structural repairs — run the chain in both orders (comma-first
    //    vs colon-first) because `"a" "b"` is ambiguous: missing comma
    //    inside an array OR missing colon after an object key.
    const variants = [repairChain(s, true), repairChain(s, false)];
    for (const t of variants) {
      try { return JSON.parse(t); } catch (e) { /* continue */ }
      try { return JSON.parse(t.replace(/,\s*([}\]])/g, "$1")); } catch (e) { /* continue */ }
      try { return JSON.parse(balanceBrackets(t)); } catch (e) { /* continue */ }
    }
    // 3. surgical salvage: pull out the biggest {...} or [...] and repair its items
    const salved = salvage(s);
    if (salved !== null) return salved;
    for (const t of variants) {
      try { return JSON.parse(balanceBrackets(salvageFix(t))); } catch (e) { /* continue */ }
    }
    return null;
  }

  function repairChain(s, colonFirst) {
    let t = s
      .replace(/^\s*```[a-z]*\s*/i, "").replace(/```\s*$/, "")
      .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      // full-width Chinese punctuation → ASCII (models writing zh flip these)
      .replace(/\uFF1A/g, ":")   // ：
      .replace(/\uFF0C(?=\s*["\[\{\d\-tfn])/g, ",") // ，(structural only)
      .replace(/[\uFF08\uFF09]/g, "(", ")") // （)
      .replace(/[\u3010\u3011]/g, "[", "]")  // 【】
      .replace(/\u3001(?=\s*["\[\{\d])/g, ",") // 、
      .replace(/,\s*([}\]])/g, "$1")                    // trailing commas
      .replace(/}\s*{/g, "},{")                         // missing commas between objects
      .replace(/]\s*{/g, "],{").replace(/}\s*\[/g, "},[") // missing commas obj↔arr
      .replace(/]\s*\[/g, "],[")
      .replace(/"\s*\n\s*"/g, '",\n"');                 // missing comma between string members
    const colonRule = (x) => x
      .replace(/"([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*)"\s+(?=["\[\{\dtnf])/g, '"$1":');
    const commaRule = (x) => x
      .replace(/(?<!\\)"\s+(?="[A-Za-z_])/g, '", ');
    if (colonFirst) { t = colonRule(t); t = commaRule(t); }
    else { t = commaRule(t); t = colonRule(t); }
    // key-leak inside a string array: "options":["A","B","type":"C"… → close the array before the key
    t = t.replace(/(\[\s*"[^"\[\]{}]*(?:\s*,\s*"[^"\[\]{}]*)*)\s*,\s*("type"\s*:)/g, "$1],$2")
      .replace(/([}\]"0-9truefalsnul]+)\s*\n(\s*")/g, "$1,\n$2");
    return t;
  }

  /* Balance mismatched brackets: drop stray closers, append missing ones. */
  function balanceBrackets(t) {
    const pairs = { "]": "[", "}": "{", ")": "(" };
    const closeOf = { "[": "]", "{": "}", "(": ")" };
    const stack = [];
    let inStr = false, escc = false, out = "";
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (escc) { out += c; escc = false; continue; }
      if (c === "\\" && inStr) { out += c; escc = true; continue; }
      if (c === '"') { inStr = !inStr; out += c; continue; }
      if (inStr) { out += c; continue; }
      if (c === "[" || c === "{" || c === "(") { stack.push(c); out += c; continue; }
      if (c === "]" || c === "}" || c === ")") {
        if (stack.length && stack[stack.length - 1] === pairs[c]) { stack.pop(); out += c; }
        else if (stack.length) { // mismatched but something is open → close the opener properly
          const want = closeOf[stack[stack.length - 1]];
          if (want === c) { stack.pop(); out += c; }
          else { out += want + c; stack.pop(); } // e.g. "…]" where "{" was open
        }
        // stray closer with empty stack → drop it
        continue;
      }
      out += c;
    }
    // close any still-open brackets (but never inside a string)
    let tail = "";
    while (stack.length) tail = closeOf[stack.pop()] + tail;
    return out + (inStr ? '"' : "") + tail;
  }
  function salvageFix(t) {
    // strip prose before the first { or [ and after the last } or ]
    const i1 = t.search(/[{[]/), i2 = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    return i1 >= 0 && i2 > i1 ? t.slice(i1, i2 + 1) : t;
  }

  function salvage(s) {
    // try the largest outer object first
    const outer = s.indexOf("{") >= 0 ? braceSlice(s, s.indexOf("{"), "{", "}") : null;
    if (outer) {
      const inner = outer.body.slice(1, -1); // without {}
      const repairedObj = repairObjectBody(inner);
      if (repairedObj) return repairedObj;
    }
    // try the largest array
    const arr = s.indexOf("[") >= 0 ? braceSlice(s, s.indexOf("["), "[", "]") : null;
    if (arr) {
      const items = splitTop(arr.body.slice(1, -1));
      const parsed = [];
      items.forEach(it => {
        const v = quickParse(it);
        if (v !== undefined) parsed.push(v);
      });
      if (parsed.length >= 2) return parsed;
    }
    return null;
  }

  function braceSlice(s, start, open, close) {
    let depth = 0, inStr = false, escc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (escc) { escc = false; continue; }
      if (c === "\\") { if (inStr) escc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return { body: s.slice(start, i + 1), end: i + 1 }; }
    }
    return null;
  }

  function splitTop(s) {
    const out = []; let depth = 0, inStr = false, escc = false, cur = "";
    for (const c of s) {
      if (escc) { cur += c; escc = false; continue; }
      if (c === "\\" && inStr) { cur += c; escc = true; continue; }
      if (c === '"') { inStr = !inStr; cur += c; continue; }
      if (inStr) { cur += c; continue; }
      if (c === "{" || c === "[") depth++;
      if (c === "}" || c === "]") depth--;
      if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }

  function quickParse(item) {
    let t = item.trim().replace(/^,+|,+$/g, "").trim();
    if (!t) return undefined;
    for (const fix of [t, t.replace(/,\s*([}\]])/g, "$1"),
        t.replace(/"([A-Za-z_][A-Za-z0-9_]*)"\s+(?=["\[\{\dtnf])/g, '"$1":')]) {
      try { return JSON.parse(fix); } catch (e) { /* next */ }
    }
    return undefined;
  }

  function repairObjectBody(inner) {
    const members = splitTop(inner);
    const obj = {};
    let ok = 0;
    members.forEach(m => {
      const v = quickParse(m);
      if (v !== undefined) { return; } // full member already fine (shouldn't happen at top level)
      const mm = m.match(/^"([^"]+)"\s*:\s*([\s\S]*)$/);
      if (mm) {
        let val = quickParse(mm[2]);
        if (val === undefined && /^\[[\s\S]*\]?\s*$/.test(mm[2].trim())) {
          // array with a broken item → salvage items individually, keep the good ones
          const innerArr = mm[2].trim().replace(/^\[/, "").replace(/\]\s*$/, "");
          const items = splitTop(innerArr).map(quickParse).filter(x => x !== undefined);
          if (items.length) val = items;
        }
        if (val === undefined && /^"[\s\S]*"?$/.test(mm[2].trim())) {
          const raw = mm[2].trim();
          const unq = raw.replace(/^"+/, "").replace(/"+$/, "");
          if (unq && !/[[\]{}\u0000-\u001f]/.test(unq.replace(/\\./g, ""))) { val = unq; } // salvage as string
        }
        if (val !== undefined) { obj[mm[1]] = val; ok++; }
      }
    });
    return ok ? obj : null;
  }

  /* ============================================================
     KEY ALIAS MAP — the model sometimes translates JSON keys to
     Chinese (问题/难度/选项…) or uses near-synonyms. Map everything
     to the canonical keys BEFORE normalization, recursively.
     ============================================================ */
  const KEY_ALIASES = {
    // quiz / generic
    "问题": "questions", "题目": "questions", "试题": "questions", "问答": "questions",
    "questions": "questions", "items": "items", "qs": "qs",
    "标题": "title", "名称": "title", "主题": "title",
    "难度": "difficulty", "等级": "difficulty",
    "答案": "answer", "正确答案": "answer", "答案们": "answers",
    "选项": "options", "选择": "options", "选项们": "options",
    "解释": "explain", "解析": "explain", "说明": "explain", "原因": "explain",
    "提示": "hint", "线索": "hint",
    "类型": "type", "题型": "type",
    "接受": "accept", "可接受": "accept",
    "分数": "score", "得分": "score",
    // flashcards
    "卡片": "cards", "正面": "front", "背面": "back",
    // scorecard
    "评分": "rating", "最高分": "ratingMax", "满分": "ratingMax",
    "标语": "headline", "头条": "headline",
    "统计": "stats", "排名": "ranked", "笔记": "notes",
    // stats / table / compare
    "项目": "items", "数值": "value", "标签": "label", "副标题": "sub",
    "列": "columns", "行": "rows", "表头": "columns", "列名": "columns",
    "赢家": "winner", "获胜": "winner", "结论": "verdict",
    // steps / timeline / terms / progress
    "步骤": "steps", "事件": "events", "术语": "terms",
    "任务": "tasks", "权重": "weight", "截止": "due", "期限": "due",
    "时间": "when", "何时": "when", "什么": "what", "详情": "detail",
    "定义": "def", "例子": "example", "示例": "example"
  };
  function mapKeysDeep(v, depth) {
    if (depth > 6) return v;
    if (Array.isArray(v)) return v.map(x => mapKeysDeep(x, depth + 1));
    if (v && typeof v === "object") {
      const out = {};
      Object.keys(v).forEach(k => {
        const nk = KEY_ALIASES[k] || k;
        out[nk] = mapKeysDeep(v[k], depth + 1);
      });
      return out;
    }
    return v;
  }

  function normType(t) {
    t = String(t || "").toLowerCase().replace(/[\s-]+/g, "_");
    if (/mcq|multiple_choice|choice|single|radio|mc$/.test(t)) return "mcq";
    if (/multi|select_all|checkbox|multiple_response/.test(t)) return "multi";
    if (/tf|true_false|boolean|bool/.test(t)) return "tf";
    if (/short|open|input|fill|text|free|written/.test(t)) return "short";
    return (t ? "mcq" : null);
  }
  function normAnswer(q, type, choices) {
    let a = q.answer ?? q.correct ?? q.ans ?? q.a;
    if (type === "tf") {
      if (typeof a === "boolean") return a ? 0 : 1;
      const s = String(a).toLowerCase().trim();
      return (s === "false" || s === "f" || s === "0" || s === "no") ? 1 : 0;
    }
    if (type === "mcq") {
      if (typeof a === "number" && a >= 0 && a < choices.length) return a;
      const s = String(a == null ? "" : a).trim();
      if (/^\d+$/.test(s)) { const n = +s; if (n >= 0 && n < choices.length) return n; }
      const letter = s.toUpperCase().match(/^([A-H])\b/);
      if (letter) { const n = letter[1].charCodeAt(0) - 65; if (n >= 0 && n < choices.length) return n; }
      const idx = choices.findIndex(c => norm(c) === norm(s));
      if (idx >= 0) return idx;
      const idx2 = choices.findIndex(c => norm(c).includes(norm(s)) && norm(s).length > 2);
      if (idx2 >= 0) return idx2;
      return 0;
    }
    return a;
  }
  function normalizeQuiz(d) {
    if (!d || typeof d !== "object") return null;
    if (Array.isArray(d)) d = { questions: d };
    const qs = [];
    (d.questions || d.items || d.qs || []).forEach(q => {
      if (!q || typeof q !== "object") return;
      const qText = q.q || q.question || q.prompt || (typeof q.questions === "string" ? q.questions : null) || q.text;
      if (!qText) return;
      const q2 = {
        q: String(qText),
        options: Array.isArray(q.options) ? q.options.filter(o => o != null).map(String)
          : (q.options != null && typeof q.options === "string" ? [q.options] : null),
        explain: q.explain || q.explanation || q.why || null,
        hint: q.hint || null
      };
      q2.type = normType(q.type || (q2.options ? "mcq" : "short")) || "short";
      if (q2.type === "tf") q2.options = ["True", "False"];
      if (q2.type === "mcq" && (!q2.options || q2.options.length < 2)) return;
      if (q2.type === "multi" && (!q2.options || q2.options.length < 2)) return;
      if (q2.type === "mcq" || q2.type === "tf") {
        q2.answer = normAnswer(q, q2.type, q2.options || ["True", "False"]);
      } else if (q2.type === "multi") {
        let answers = q.answers ?? q.answer;
        if (answers == null) answers = [];
        if (!Array.isArray(answers)) answers = [answers];
        q2.answers = answers.map(a => {
          const n = typeof a === "number" ? a : parseInt(String(a), 10);
          return (isNaN(n) && q2.options) ? q2.options.findIndex(o => norm(o) === norm(a)) : n;
        }).filter(n => n >= 0 && n < (q2.options || []).length);
        if (!q2.answers.length) return;
      } else {
        const acc = [].concat(q.accept || q.accepts || []).map(String);
        q2.answer = String(q.answer ?? q.answers ?? q.a ?? "").trim();
        if (!q2.answer && !acc.length) return;
        q2.accept = acc;
      }
      qs.push(q2);
    });
    if (qs.length < 1) return null;
    return { title: d.title || d.topic || "Quiz", difficulty: d.difficulty || null, questions: qs };
  }

  /* ============================================================
     LAST-RESORT REGEX QUIZ EXTRACTION
     When even the salvage pipeline fails (severely malformed JSON),
     scan the raw text for question/options/answer patterns and
     rebuild a quiz from whatever is recognizable. Better than a
     raw code dump.
     ============================================================ */
  function scanStringArray(s, start) {
    let i = start + 1;
    const items = [];
    const skipWs = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    skipWs();
    if (s[i] === "]") return { items, end: i + 1 };
    while (i < s.length) {
      skipWs();
      if (s[i] === '"') {
        let v = "", j = i + 1;
        while (j < s.length) {
          if (s[j] === "\\") { v += s[j] + (s[j + 1] || ""); j += 2; continue; }
          if (s[j] === '"') break;
          v += s[j]; j++;
        }
        items.push(v); i = j + 1;
        skipWs();
        if (s[i] === ",") { i++; continue; }
        return { items, end: i + 1 }; // ] or key-leak — either way we're done
      } else break;
    }
    return { items, end: i };
  }

  function regexQuizExtract(body) {
    const s = String(body || "");
    if (!/"(q|question|题)"\s*:\s*"/.test(s)) return null;
    const marks = [];
    const qre = /"(?:q|question|题)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = qre.exec(s))) marks.push({ text: m[1], at: m.index });
    if (marks.length < 2) return null;
    const questions = [];
    marks.forEach((mk, i) => {
      const seg = s.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : mk.length ? s.length : s.length);
      const q = { q: mk.text, type: "short", answer: "", explain: "" };
      // options
      const oi = seg.search(/"(?:options|选项)"\s*:\s*\[/);
      let optionsEnd = -1;
      if (oi >= 0) {
        const br = seg.indexOf("[", oi);
        const scanned = scanStringArray(seg, br);
        if (scanned.items.length >= 2) { q.options = scanned.items; q.type = "mcq"; optionsEnd = oi + scanned.end; }
      }
      const tail = optionsEnd > 0 ? seg.slice(optionsEnd) : seg;
      // type
      const tm = tail.match(/"(?:type|类型|题型)"\s*:\s*"([^"]*)"/);
      if (tm) q.type = tm[1];
      // answers
      const am = tail.match(/"(?:answers)"\s*:\s*\[/);
      if (am) {
        const scanned = scanStringArray(tail, tail.indexOf("[", am.index));
        q.answers = scanned.items.map(x => parseInt(x, 10)).filter(x => !isNaN(x));
        if (q.answers.length && q.options) q.type = "multi";
      } else {
        const am2 = tail.match(/"(?:answer|答案|正确答案)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(-?\d+)|(true|false))/);
        if (am2) q.answer = am2[1] != null ? am2[1] : (am2[2] != null ? parseInt(am2[2], 10) : am2[3] === "true");
        else if (q.type === "mcq" && q.options) q.answer = 0;
        if (typeof q.answer === "string" && /^(true|false)$/i.test(q.answer)) { q.answer = q.answer.toLowerCase() === "true"; }
        if (typeof q.answer === "boolean" && q.options) { q.type = "tf"; q.options = ["True", "False"]; }
      }
      // explain / hint
      const em = tail.match(/"(?:explain|explanation|解析|解释|说明)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (em) q.explain = em[1];
      const hm = tail.match(/"(?:hint|提示)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (hm) q.hint = hm[1];
      if (q.type === "short" && !q.answer) return; // no answer recoverable
      questions.push(q);
    });
    if (questions.length < 2) return null;
    const tt = s.match(/"(?:title|标题|主题)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return { title: tt ? tt[1] : "Quiz", questions };
  }

  /* ============ QUIZ ============ */
  function renderQuiz(raw, ctx) {
    const d = normalizeQuiz(raw);
    if (!d) return null;
    const wrap = el("div", "blk blk-quiz");
    const qs = d.questions;
    const state = Object.assign({ screen: "start", i: 0, answers: {}, score: 0 },
      (ctx.state && ctx.state.quiz) || {});
    const save = () => ctx.save && ctx.save({ quiz: state });
    let order = state.order && state.order.length === qs.length ? state.order : qs.map((_, i) => i);

    function startScreen() {
      wrap.innerHTML = "";
      const head = el("div", "blk-quiz-head",
        `<div class="blk-quiz-badge">${Ace.ICON("bulb", 16)}</div>
         <div><div class="blk-quiz-title">${esc(d.title || "Quiz")}</div>
         <div class="blk-quiz-meta">${qs.length} questions${d.difficulty ? ` · ${esc(d.difficulty)}` : ""} · mixed types</div></div>`);
      const go = btn("Start quiz", "btn-primary", "play");
      go.onclick = () => { state.screen = "q"; state.i = 0; state.score = 0; state.answers = {};
        if (state.reshuffle) { order = qs.map((_, i) => i).sort(() => Math.random() - .5); state.order = order; state.reshuffle = false; }
        save(); draw(); };
      const row = el("div", "blk-quiz-actions"); row.append(go); head.append(row);
      wrap.append(head);
    }

    function question(q, qi) {
      const picked = state.answers[qi];
      const isAnswered = picked != null;
      const correct = isAnswered && picked.correct;
      wrap.innerHTML = "";
      const prog = el("div", "blk-prog", `<div class="blk-prog-bar" style="width:${(qi / qs.length) * 100}%"></div>`);
      const head = el("div", "blk-quiz-qhead",
        `<span class="blk-quiz-count">Question ${qi + 1} of ${qs.length}</span>
         <span class="blk-quiz-score">${Ace.ICON("check", 13)} ${state.score} correct</span>`);
      const qEl = el("div", "blk-quiz-q", mdInline(q.q));

      const type = q.type;
      const body = el("div", "blk-quiz-body");
      let chosen = isAnswered ? picked.choice : (type === "mcq" || type === "tf" ? -1 : type === "multi" ? [] : "");
      const choices = type === "tf" ? ["True", "False"] : (q.options || []);

      function submit() {
        let ok = false;
        if (type === "mcq" || type === "tf") ok = chosen === q.answer;
        else if (type === "multi") {
          const want = (q.answers || []).slice().sort().join(",");
          ok = chosen.slice().sort().join(",") === want;
        } else {
          const acc = [q.answer].concat(q.accept || []).map(norm).filter(Boolean);
          const mine = norm(chosen);
          ok = acc.some(a => a === mine ||
            (mine.length > 3 && a.length > 3 && (a.includes(mine) || mine.includes(a))));
        }
        state.answers[qi] = { choice: chosen, correct: ok, text: type === "short" ? chosen : null };
        if (ok) state.score++;
        save(); draw();
      }

      if (type === "mcq" || type === "tf") {
        choices.forEach((opt, oi) => {
          const o = el("button", "blk-opt" + (chosen === oi ? " sel" : ""),
            `<span class="blk-opt-mark"></span><span class="blk-opt-text">${mdInline(opt)}</span>`);
          const mark = o.querySelector(".blk-opt-mark");
          o.onclick = () => { if (isAnswered) return; chosen = oi; wrap.querySelectorAll(".blk-opt").forEach(x => x.classList.remove("sel")); o.classList.add("sel"); };
          if (isAnswered) {
            const isRight = oi === q.answer;
            if (isRight) { o.classList.add("right"); mark.innerHTML = Ace.ICON("check", 11); }
            else if (chosen === oi) { o.classList.add("wrong"); mark.innerHTML = Ace.ICON("close", 11); }
            o.disabled = true;
          }
          body.append(o);
        });
      } else if (type === "multi") {
        choices.forEach((opt, oi) => {
          const o = el("button", "blk-opt blk-opt-multi" + (chosen.includes(oi) ? " sel" : ""),
            `<span class="blk-opt-mark"></span><span class="blk-opt-text">${mdInline(opt)}</span>`);
          const mark = o.querySelector(".blk-opt-mark");
          o.onclick = () => { if (isAnswered) return;
            chosen = chosen.includes(oi) ? chosen.filter(x => x !== oi) : chosen.concat([oi]);
            o.classList.toggle("sel"); };
          if (isAnswered) {
            if ((q.answers || []).includes(oi)) { o.classList.add("right"); mark.innerHTML = Ace.ICON("check", 11); }
            else if (chosen.includes(oi)) { o.classList.add("wrong"); mark.innerHTML = Ace.ICON("close", 11); }
            o.disabled = true;
          }
          body.append(o);
        });
      } else {
        const inp = el("input", "blk-input");
        inp.type = "text"; inp.placeholder = "Type your answer…"; inp.value = chosen || "";
        inp.oninput = () => chosen = inp.value;
        inp.onkeydown = (e) => { if (e.key === "Enter" && !isAnswered && inp.value.trim()) submit(); };
        if (isAnswered) inp.disabled = true;
        body.append(inp);
      }

      const foot = el("div", "blk-quiz-actions");
      if (!isAnswered) {
        if (q.hint) {
          const hintBtn = btn("Hint", "btn-ghost", "bulb");
          hintBtn.onclick = () => {
            const ex = foot.querySelector(".blk-hint");
            if (ex) ex.remove();
            else foot.append(el("div", "blk-hint", "<b>Hint:</b> " + mdInline(q.hint)));
          };
          foot.append(hintBtn);
        }
        const go = btn(type === "short" ? "Check answer" : "Submit", "btn-primary", "check");
        const canSubmit = () => type === "multi" ? chosen.length : type === "short" ? String(chosen).trim() : chosen >= 0;
        go.onclick = () => { if (canSubmit()) submit(); };
        if (type === "mcq" || type === "tf") {
          const tick = () => go.classList.toggle("disabled", !canSubmit());
          body.querySelectorAll(".blk-opt").forEach(o => o.addEventListener("click", tick));
        }
        if (type === "short") inp.addEventListener("input", () => go.classList.toggle("disabled", !canSubmit()));
        go.classList.add("disabled");
        foot.append(go);
      } else {
        const ansText = type === "short" ? q.answer
          : type === "multi" ? (q.answers || []).map(i => choices[i]).join(", ")
          : choices[q.answer];
        const verdict = el("div", "blk-verdict " + (correct ? "ok" : "no"),
          correct ? `${Ace.ICON("check", 15)} Correct!` :
          `${Ace.ICON("close", 15)} Not quite — answer: <b>${esc(ansText)}</b>`);
        foot.append(verdict);
        if (q.explain) foot.append(el("div", "blk-explain", "<b>Why:</b> " + mdInline(q.explain)));
        const next = btn(qi + 1 < qs.length ? "Next question" : "See results", "btn-primary", "chev");
        next.onclick = () => {
          if (qi + 1 < qs.length) { state.i = qi + 1; }
          else state.screen = "done";
          save(); draw();
        };
        foot.append(next);
      }
      wrap.append(prog, head, qEl, body, foot);
    }

    function doneScreen() {
      wrap.innerHTML = "";
      const pct = Math.round((state.score / qs.length) * 100);
      const grade = pct >= 90 ? "Outstanding" : pct >= 75 ? "Strong" : pct >= 50 ? "Getting there" : "Keep drilling";
      const card = el("div", "blk-quiz-result",
        `<div class="blk-quiz-score-big">${state.score}<span>/${qs.length}</span></div>
         <div class="blk-quiz-grade">${grade}</div>
         <div class="blk-quiz-pct">${pct}%</div>`);
      const review = el("div", "blk-quiz-review");
      qs.forEach((q, qi2) => {
        const a = state.answers[qi2];
        review.append(el("div", "blk-quiz-revrow " + (a && a.correct ? "ok" : "no"),
          `<span>${a && a.correct ? Ace.ICON("check", 12) : Ace.ICON("close", 12)}</span><span>${mdInline(q.q)}</span>`));
      });
      const foot = el("div", "blk-quiz-actions");
      const retry = btn("Retry", "btn-ghost", "refresh");
      retry.onclick = () => { state.screen = "start"; state.reshuffle = true; save(); draw(); };
      const harder = btn("Make it harder", "btn-primary");
      harder.onclick = () => wrap.dispatchEvent(new CustomEvent("ace:block-action",
        { bubbles: true, detail: { type: "quiz-harder", topic: d.title || "" } }));
      foot.append(retry, harder);
      wrap.append(card, review, foot);
    }

    function draw() {
      if (state.screen === "start") startScreen();
      else if (state.screen === "done") doneScreen();
      else question(qs[order[state.i]] || qs[state.i], state.i);
    }
    draw();
    return wrap;
  }

  /* ============ FLASHCARDS ============ */
  function renderFlashcards(raw, ctx) {
    const d = Array.isArray(raw) ? { cards: raw } : raw;
    const cards = (d.cards || []).filter(c => c && (c.front || c.back));
    if (!cards.length) return null;
    const state = Object.assign({ i: 0, flipped: false, known: [] }, (ctx.state && ctx.state.cards) || {});
    const save = () => ctx.save && ctx.save({ cards: state });
    const wrap = el("div", "blk blk-fc");
    const title = el("div", "blk-title", `${esc(d.title || "Flashcards")} <span class="blk-sub">${cards.length} cards</span>`);

    const stage = el("div", "blk-fc-stage");
    const cardEl = el("div", "blk-fc-card");
    const front = el("div", "blk-fc-face blk-fc-front"), back = el("div", "blk-fc-face blk-fc-back");
    cardEl.append(front, back);

    function draw() {
      const c = cards[state.i] || {};
      front.innerHTML = mdInline(c.front);
      back.innerHTML = mdInline(c.back);
      cardEl.classList.toggle("flipped", !!state.flipped);
      stage.innerHTML = "";
      const count = el("div", "blk-fc-count", `Card ${state.i + 1} / ${cards.length} · ${state.known.length} known`);
      cardEl.onclick = () => { state.flipped = !state.flipped; save(); cardEl.classList.toggle("flipped", state.flipped); };
      const nav = el("div", "blk-quiz-actions");
      const prev = btn("Prev", "btn-ghost"); prev.onclick = () => { state.i = Math.max(0, state.i - 1); state.flipped = false; save(); draw(); };
      const know = btn(state.known.includes(state.i) ? "Known" : "Got it", state.known.includes(state.i) ? "btn-ok" : "btn-ghost", state.known.includes(state.i) ? "check" : null);
      know.onclick = () => {
        if (!state.known.includes(state.i)) state.known.push(state.i); else state.known = state.known.filter(x => x !== state.i);
        save(); draw();
      };
      const next = btn("Next", "btn-primary"); next.onclick = () => { state.i = Math.min(cards.length - 1, state.i + 1); state.flipped = false; save(); draw(); };
      const shuffle = btn("", "btn-icon", "refresh");
      shuffle.title = "Shuffle";
      shuffle.onclick = () => { cards.sort(() => Math.random() - .5); state.i = 0; state.flipped = false; save(); draw(); };
      nav.append(prev, shuffle, know, next);
      stage.append(count, cardEl, nav);
    }
    draw();
    wrap.append(title, stage);
    return wrap;
  }

  /* ============ SCORECARD ============ */
  function renderScorecard(d) {
    const wrap = el("div", "blk blk-scorecard");
    const max = d.ratingMax || 10;
    const head = el("div", "blk-sc-head",
      `<div class="blk-sc-rating"><span class="blk-sc-num">${esc(d.rating != null ? d.rating : "–")}</span><span class="blk-sc-max">/${esc(max)}</span></div>
       <div class="blk-sc-titlewrap"><div class="blk-sc-title">${esc(d.title || "Scorecard")}</div>
       ${d.headline ? `<div class="blk-sc-headline">${mdInline(d.headline)}</div>` : ""}</div>`);
    wrap.append(head);
    if (d.rating != null) {
      const bar = el("div", "blk-sc-bar", `<div style="width:${Math.max(0, Math.min(100, (d.rating / max) * 100))}%"></div>`);
      wrap.append(bar);
    }
    if (d.stats && d.stats.length) {
      const grid = el("div", "blk-sc-grid");
      d.stats.forEach(s => grid.append(el("div", "blk-sc-stat",
        `<div class="blk-sc-val">${esc(s.value)}</div><div class="blk-sc-lbl">${esc(s.label)}</div>`)));
      wrap.append(grid);
    }
    if (d.ranked && d.ranked.length) {
      const list = el("div", "blk-sc-ranked");
      d.ranked.forEach((r, i) => list.append(el("div", "blk-sc-rank",
        `<div class="blk-sc-rankn">${i + 1}</div>
         <div class="blk-sc-rankbody"><div class="blk-sc-ranklbl">${mdInline(r.label)}</div>
         ${r.note ? `<div class="blk-sc-ranknote">${mdInline(r.note)}</div>` : ""}</div>
         <div class="blk-sc-rankval">${esc(r.value)}</div>`)));
      wrap.append(list);
    }
    if (d.notes) wrap.append(el("div", "blk-notes", mdInline(d.notes)));
    if (d.best && d.best.length) {
      const best = el("div", "blk-sc-best");
      d.best.forEach(b => best.append(el("div", "blk-sc-brow",
        `<div class="blk-sc-blbl">${esc(b.label)}</div><div class="blk-sc-bval">${mdInline(b.value)}${b.note ? ` <span class="blk-sub">— ${mdInline(b.note)}</span>` : ""}</div>`)));
      wrap.append(best);
    }
    return wrap;
  }

  /* ============ STATS ============ */
  function renderStats(d) {
    const items = d.items || [];
    if (!items.length) return null;
    const wrap = el("div", "blk blk-stats");
    if (d.title) wrap.append(el("div", "blk-title", esc(d.title)));
    const grid = el("div", "blk-stat-grid");
    items.forEach(s => grid.append(el("div", "blk-stat",
      `<div class="blk-stat-val">${esc(s.value)}</div>
       <div class="blk-stat-lbl">${esc(s.label)}</div>
       ${s.sub ? `<div class="blk-stat-sub">${esc(s.sub)}</div>` : ""}`)));
    wrap.append(grid);
    return wrap;
  }

  /* ============ COMPARE ============ */
  function renderCompare(d) {
    const cols = d.columns || [];
    const rows = (d.rows || []).filter(r => r && r.values);
    if (!cols.length || !rows.length) return null;
    const wrap = el("div", "blk blk-compare");
    if (d.title) wrap.append(el("div", "blk-title", esc(d.title)));
    const t = el("table", "blk-compare-t");
    t.innerHTML = `<thead><tr><th></th>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>`;
    const tb = el("tbody");
    rows.forEach(r => {
      const tr = el("tr");
      tr.append(el("td", "blk-compare-lbl", esc(r.label)));
      r.values.forEach((v, i) => {
        tr.append(el("td", r.winner === i ? "win" : "", `${mdInline(v)}${r.winner === i ? `<span class="win-b">${Ace.ICON("check", 11)}</span>` : ""}`));
      });
      tb.append(tr);
    });
    t.append(tb); wrap.append(t);
    if (d.verdict) wrap.append(el("div", "blk-notes", "<b>Verdict:</b> " + mdInline(d.verdict)));
    return wrap;
  }

  /* ============ STEPS ============ */
  function renderSteps(d) {
    const steps = d.steps || [];
    if (!steps.length) return null;
    const wrap = el("div", "blk blk-steps");
    if (d.title) wrap.append(el("div", "blk-title", esc(d.title)));
    steps.forEach((s, i) => {
      if (typeof s === "string") s = { detail: s };
      wrap.append(el("div", "blk-step",
        `<div class="blk-step-n">${i + 1}</div>
         <div class="blk-step-body">${s.name ? `<div class="blk-step-name">${mdInline(s.name)}</div>` : ""}
         <div class="blk-step-detail">${mdInline(s.detail || s.text || "")}</div></div>`));
    });
    return wrap;
  }

  /* ============ TIMELINE ============ */
  function renderTimeline(d) {
    const evs = d.events || [];
    if (!evs.length) return null;
    const wrap = el("div", "blk blk-tl");
    if (d.title) wrap.append(el("div", "blk-title", esc(d.title)));
    const rail = el("div", "blk-tl-rail");
    evs.forEach(e => rail.append(el("div", "blk-tl-ev",
      `<div class="blk-tl-dot"></div>
       <div class="blk-tl-when">${esc(e.when || "")}</div>
       <div class="blk-tl-what">${mdInline(e.what || "")}</div>
       ${e.detail ? `<div class="blk-tl-detail">${mdInline(e.detail)}</div>` : ""}`)));
    wrap.append(rail);
    return wrap;
  }

  /* ============ TERMS ============ */
  function renderTerms(d) {
    const terms = (d.terms || []).filter(t => t && t.term);
    if (!terms.length) return null;
    const wrap = el("div", "blk blk-terms");
    if (d.title) wrap.append(el("div", "blk-title", esc(d.title)));
    const grid = el("div", "blk-terms-grid");
    terms.forEach(t => grid.append(el("div", "blk-term",
      `<div class="blk-term-t">${mdInline(t.term)}</div>
       <div class="blk-term-d">${mdInline(t.def || t.definition)}</div>
       ${t.example ? `<div class="blk-term-e"><b>e.g.</b> ${mdInline(t.example)}</div>` : ""}`)));
    wrap.append(grid);
    return wrap;
  }

  /* ============ TABLE ============ */
  function renderTable(d) {
    const cols = d.columns || d.headers || [];
    const rows = (d.rows || []).filter(r => Array.isArray(r) ? r.length : r);
    if (!cols.length || !rows.length) return null;
    const wrap = el("div", "blk blk-table");
    if (d.title) wrap.append(el("div", "blk-title", esc(d.title)));
    const tw = el("div", "blk-tablewrap");
    const t = el("table", "blk-table-t");
    const thead = el("thead");
    const hr = el("tr");
    cols.forEach((c, ci) => {
      const th = el("th", "", esc(c) + (d.sortable === false ? "" : ` <span class="sort-ic">${Ace.ICON("chevDown", 10)}</span>`));
      if (d.sortable !== false) th.onclick = () => sortRows(ci, th);
      hr.append(th);
    });
    thead.append(hr); t.append(thead);
    const tb = el("tbody");
    function drawRows(data) {
      tb.innerHTML = "";
      data.forEach(r => tb.append(el("tr", cols.map((_, i) => `<td>${mdInline(Array.isArray(r) ? r[i] : (r[cols[i]] ?? ""))}</td>`).join(""))));
    }
    function sortRows(ci, th) {
      const cur = th.getAttribute("data-dir");
      const dir = cur === "asc" ? -1 : 1;
      t.querySelectorAll("th").forEach(x => x.removeAttribute("data-dir"));
      th.setAttribute("data-dir", dir === 1 ? "asc" : "desc");
      drawRows(rows.slice().sort((a, b) => {
        const x = String(Array.isArray(a) ? a[ci] : a[cols[ci]] ?? ""), y = String(Array.isArray(b) ? b[ci] : b[cols[ci]] ?? "");
        const nx = parseFloat(x.replace(/[^0-9.\-]/g, "")), ny = parseFloat(y.replace(/[^0-9.\-]/g, ""));
        if (!isNaN(nx) && !isNaN(ny) && x.match(/\d/)) return (nx - ny) * dir;
        return x.localeCompare(y) * dir;
      }));
    }
    drawRows(rows);
    t.append(tb); tw.append(t); wrap.append(tw);
    return wrap;
  }

  /* ============ PROGRESS ============ */
  function renderProgress(d, ctx) {
    const tasks = (d.tasks || []).filter(t => t && t.label);
    if (!tasks.length) return null;
    const state = Object.assign({ done: [] }, (ctx.state && ctx.state.progress) || {});
    const save = () => ctx.save && ctx.save({ progress: state });
    const wrap = el("div", "blk blk-progress");
    const totalW = tasks.reduce((a, t) => a + (t.weight || 1), 0);
    const doneW = tasks.reduce((a, t, i) => a + (state.done.includes(i) ? (t.weight || 1) : 0), 0);
    if (d.title) wrap.append(el("div", "blk-title", `${esc(d.title)} ${d.due ? `<span class="blk-sub">· due ${esc(d.due)}</span>` : ""}`));
    wrap.append(el("div", "blk-prog blk-prog-lg", `<div class="blk-prog-bar" style="width:${totalW ? (doneW / totalW) * 100 : 0}%"></div>`));
    wrap.append(el("div", "blk-prog-lbl", `${doneW}/${totalW} points · ${Math.round(totalW ? (doneW / totalW) * 100 : 0)}%`));
    const list = el("div", "blk-progress-list");
    tasks.forEach((t, i) => {
      const on = state.done.includes(i);
      const row = el("div", "blk-prow" + (on ? " on" : ""),
        `<button class="blk-pcheck" aria-label="toggle">${on ? Ace.ICON("check", 13) : ""}</button>
         <span class="blk-plabel">${mdInline(t.label)}</span>
         <span class="blk-pweight">${Ace.ICON("check", 8).repeat(Math.min(5, t.weight || 1))}</span>`);
      row.querySelector(".blk-pcheck").onclick = () => {
        state.done = on ? state.done.filter(x => x !== i) : state.done.concat([i]);
        save();
        wrap.replaceWith(renderProgress(d, ctx));
      };
      list.append(row);
    });
    wrap.append(list);
    return wrap;
  }

  /* ============ CODE BLOCK (fallback fence) ============ */
  function renderCode(lang, body) {
    const wrap = el("div", "blk blk-code");
    const head = el("div", "blk-code-head",
      `<span>${esc(lang || "code")}</span>`);
    const cp = btn("Copy", "btn-ghost", "copy");
    cp.onclick = () => {
      navigator.clipboard && navigator.clipboard.writeText(body).then(() => {
        cp.innerHTML = Ace.ICON("check", 14) + "Copied";
        setTimeout(() => cp.innerHTML = Ace.ICON("copy", 14) + "Copy", 1400);
      });
    };
    head.append(cp);
    const pre = el("pre", "", `<code>${esc(body)}</code>`);
    wrap.append(head, pre);
    return wrap;
  }

  /* ============ dispatcher ============ */
  const RENDERERS = { quiz: renderQuiz, flashcards: renderFlashcards, scorecard: renderScorecard,
    stats: renderStats, compare: renderCompare, steps: renderSteps, timeline: renderTimeline,
    terms: renderTerms, table: renderTable, progress: renderProgress };

  /* Shape-based inference: the model sometimes labels blocks ```json (or nothing).
     Detect the intended component from the JSON's fields. */
  function inferType(d) {
    if (!d || typeof d !== "object") return null;
    if (Array.isArray(d)) {
      if (d.length && d[0] && ("front" in d[0] || "back" in d[0])) return "flashcards";
      if (d.length && d[0] && ("q" in d[0] || "question" in d[0])) return "quiz";
      return null;
    }
    if (Array.isArray(d.questions)) return "quiz";
    if (Array.isArray(d.cards)) return "flashcards";
    if (d.rating != null && (d.stats || d.ranked || d.headline || d.best)) return "scorecard";
    if (Array.isArray(d.items) && d.items[0] && "value" in d.items[0]) return "stats";
    if (Array.isArray(d.rows) && d.rows[0] && typeof d.rows[0] === "object" && "values" in d.rows[0]) return "compare";
    if (Array.isArray(d.steps)) return "steps";
    if (Array.isArray(d.events)) return "timeline";
    if (Array.isArray(d.terms)) return "terms";
    if (Array.isArray(d.tasks)) return "progress";
    if (Array.isArray(d.columns) && Array.isArray(d.rows)) return "table";
    return null;
  }

  Ace.Blocks = {
    isBlock(lang) { return RENDERERS.hasOwnProperty(String(lang || "").toLowerCase()); },
    parse: parseLoose,
    render(lang, body, ctx) {
      const langN = String(lang || "").toLowerCase();
      let data = parseLoose(body);
      if (data === null || data === undefined) {
        // LAST RESORT for quiz-ish fences: regex extraction from broken JSON
        if (langN === "quiz" || langN === "json" || langN === "") {
          try { data = regexQuizExtract(body); } catch (e) { data = null; }
        }
        if (data === null || data === undefined) return renderCode(langN, body);
      }
      try { data = mapKeysDeep(data, 0); } catch (e) { /* keep raw */ }
      const type = RENDERERS[langN] ? langN : inferType(data);
      if (!type) return renderCode(langN, body);
      try {
        const node = RENDERERS[type](data, ctx || {});
        return node || renderCode(langN, body);
      } catch (e) {
        console.warn("block render failed", type, e);
        // final parachute: broken quiz payload → regex extraction
        if (type === "quiz") {
          try {
            const rx = regexQuizExtract(body);
            if (rx) return renderQuiz(rx, ctx || {}) || renderCode(langN, body);
          } catch (e2) { /* fall through */ }
        }
        return renderCode(langN, body);
      }
    },
    renderCode
  };
})();
