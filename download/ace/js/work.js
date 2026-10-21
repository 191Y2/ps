/* ============================================================
   Ace — work.js · AGENTIC BUILDER (Agent mode, ex-"Work")
   Pipeline: ANALYZE → PLAN → BUILD → REVIEW → (FIX → BUILD)² → SHIP
   Every phase streams into a live, detailed agent trace:
     - what the agent is doing right now (step + live sub-status)
     - real-time code stream with section detection (styles/markup/logic)
     - chars written, elapsed seconds, KB/s
     - plan card with features, steps, palette
     - review verdict with issues + improvements
     - shipped artifact with sandboxed preview / open / download / code
   Files & zip contents the user attached are injected into the
   planner + builder prompts so the agent can extend existing code.
   ============================================================ */
"use strict";
window.Ace = window.Ace || {};
(function () {
  const $ = (id) => document.getElementById(id);
  const W = { running: false };
  const fmtSecs = (ms) => ((ms || 0) / 1000).toFixed(1);
  const fmtKB = (n) => (n / 1024).toFixed(1) + " KB";

  /* ---------- trace rendering (called from chat.js renderMessage) ---------- */
  W.renderTrace = (m) => {
    const t = m.workTrace || {};
    const wrap = Ace.el("div", "work-trace");
    if (t.request) wrap.append(Ace.el("div", "work-request",
      `<span class="wr-ic">${Ace.ICON("spark", 13)}</span><span class="wr-txt">${Ace.esc(t.request)}</span>`));
    if (t.plan) {
      const p = Ace.el("div", "work-plan");
      const pal = ((t.plan.design && t.plan.design.palette) || [])
        .filter(c => /^#[0-9a-fA-F]{3,8}$/.test(String(c))).slice(0, 5);
      const swatches = pal.map(c => '<i style="background:' + Ace.esc(c) + '"></i>').join("");
      const stepCount = (t.plan.steps || []).length;
      p.innerHTML = `
        <div class="work-plan-head">
          <div class="work-plan-title">${Ace.esc(t.plan.title || "Build")}</div>
          <span class="work-plan-type">${Ace.esc(t.plan.type || "app")}</span>
        </div>
        <div class="work-plan-liner">${Ace.esc(t.plan.oneLiner || "")}</div>
        ${t.plan.features && t.plan.features.length ? `<div class="work-plan-feats">${t.plan.features.map(f => `<span class="feat">${Ace.ICON("check", 11)}${Ace.esc(f)}</span>`).join("")}</div>` : ""}
        <div class="work-plan-meta">
          ${stepCount ? `<span class="wpm">${Ace.ICON("chev", 11)} ${stepCount} build steps</span>` : ""}
          ${swatches ? `<span class="wpm pal">${swatches}</span>` : ""}
          ${t.plan.design && t.plan.design.style ? `<span class="wpm">${Ace.esc(t.plan.design.style)}</span>` : ""}
        </div>`;
      wrap.append(p);
    }
    (t.steps || []).forEach(s => {
      const row = Ace.el("div", "work-step " + (s.state || "pending"));
      const icon = s.state === "run" ? '<span class="spin"></span>'
        : s.state === "done" ? Ace.ICON("check", 13)
        : s.state === "fail" ? Ace.ICON("warn", 13) : Ace.ICON("chev", 13);
      const step = Ace.el("details", "work-step-d");
      const secs = s.ms != null ? `<span class="ws-time">${fmtSecs(s.ms)}s</span>` : "";
      const live = (s.state === "run" && s.live) ? `<span class="ws-live">${Ace.ICON("code", 11)} ${Ace.esc(s.live)}</span>` : "";
      step.innerHTML = `<summary><span class="ws-ic ${s.state || ""}">${icon}</span><span class="ws-lbl">${Ace.esc(s.label)}</span>${secs}${live}${s.note ? `<span class="ws-note">${Ace.esc(s.note)}</span>` : ""}</summary>
        ${s.detail ? `<div class="ws-detail">${s.detail}</div>` : ""}`;
      if (s.state === "run") step.open = true;
      wrap.append(step);
      if (s.state === "run" && s.showCode) {
        const liveEl = Ace.el("div", "work-live");
        liveEl.innerHTML = `<div class="work-live-bar"><span class="spin"></span><span class="work-live-lbl">${Ace.esc(s.live || "Working…")}</span><span class="work-live-pct">${Ace.esc(s.pct || "")}</span></div><pre class="work-live-code"><code>${Ace.esc(s.codeTail || "")}</code></pre>`;
        wrap.append(liveEl);
      }
    });
    if (m.artifacts && m.artifacts.length) {
      m.artifacts.forEach(a => wrap.append(artifactCard(m, a)));
    }
    return wrap;
  };

  function artifactCard(m, a) {
    const card = Ace.el("div", "artifact");
    const head = Ace.el("div", "artifact-head",
      `<div class="artifact-title">${Ace.ICON("code", 15)} ${Ace.esc(a.title || "App")}</div>
       <div class="artifact-badges"><span class="badge">v${a.v}</span>${a.score ? `<span class="badge ok">review ${a.score}/10</span>` : ""}<span class="badge">${((a.code || "").length / 1024).toFixed(1)} KB</span></div>`);
    const acts = Ace.el("div", "artifact-acts");
    const run = Ace.el("button", "btn btn-primary", Ace.ICON("play", 14) + "Open app");
    let blobUrl = null;
    run.onclick = () => {
      if (blobUrl) { window.open(blobUrl, "_blank"); return; }
      blobUrl = URL.createObjectURL(new Blob([a.code], { type: "text/html" }));
      window.open(blobUrl, "_blank");
    };
    const dl = Ace.el("button", "btn btn-ghost", Ace.ICON("download", 14) + "Download");
    dl.onclick = () => {
      const b = document.createElement("a");
      b.href = URL.createObjectURL(new Blob([a.code], { type: "text/html" }));
      b.download = (a.title || "ace-app").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() + ".html";
      b.click();
      setTimeout(() => URL.revokeObjectURL(b.href), 8000);
    };
    const view = Ace.el("button", "btn btn-ghost", Ace.ICON("code", 14) + "Code");
    view.onclick = () => {
      const ex = card.querySelector(".artifact-code");
      if (ex) { ex.remove(); return; }
      const code = Ace.el("div", "artifact-code");
      code.append(Ace.Blocks.renderCode("html", a.code));
      card.append(code);
    };
    acts.append(run, dl, view);
    const frame = Ace.el("div", "artifact-frame");
    const ifr = document.createElement("iframe");
    ifr.setAttribute("sandbox", "allow-scripts allow-modals allow-forms allow-pointer-lock");
    ifr.setAttribute("title", a.title || "preview");
    ifr.srcdoc = a.code;
    frame.append(ifr);
    card.append(head, acts, frame);
    return card;
  }

  /* ---------- helpers ---------- */
  const step = (ai, k, label, patch) => {
    const t = ai.workTrace;
    const s = t.steps.find(x => x.k === k);
    if (!s) return;
    if (!patch) delete s.showCode;
    Object.assign(s, patch || {}, { label: label || s.label });
    if (patch && patch.state === "done") { delete s.showCode; if (!s.ms) s.ms = Date.now() - (s._t0 || Date.now()); }
    Ace.Chat.rerenderMessage(ai);
    Ace.Chat.scrollBottom();
  };
  const addStep = (ai, k, label) => {
    // one row per key — later passes (fix loops) relabel the same row
    let s = ai.workTrace.steps.find(x => x.k === k);
    if (s) { Object.assign(s, { label, state: "run", _t0: Date.now() }); delete s.ms; delete s.note; delete s.detail; delete s.live; delete s.showCode; }
    else ai.workTrace.steps.push({ k, label, state: "run", _t0: Date.now() });
    Ace.Chat.taskBegin(ai, k, label);
    Ace.Chat.rerenderMessage(ai);
    Ace.Chat.scrollBottom();
  };
  const endStep = (ai, k, label, patch) => {
    const s = ai.workTrace.steps.find(x => x.k === k);
    if (s && !s.ms) s.ms = Date.now() - (s._t0 || Date.now());
    step(ai, k, label, patch);
    Ace.Chat.taskEnd(ai, k);
  };
  /* update the live line WITHOUT a full rerender (cheap, 10+ fps) */
  const updateLive = (ai, k, liveLabel, pct, codeTail) => {
    const root = document.querySelector(`[data-mid="${ai.id}"]`);
    if (!root) return;
    const lbl = root.querySelector(".work-live-lbl");
    const pctEl = root.querySelector(".work-live-pct");
    const code = root.querySelector(".work-live-code code");
    if (lbl) lbl.textContent = liveLabel;
    if (pctEl) pctEl.textContent = pct || "";
    if (code && codeTail != null) code.textContent = codeTail.length > 4000 ? codeTail.slice(-4000) : codeTail;
  };
  const setLiveSummary = (ai, k, live) => {
    const s = ai.workTrace.steps.find(x => x.k === k);
    if (s) { s.live = live; } // shows as a small chip in the step row on next rerender
  };

  function extractHTML(text) {
    const segs = Ace.MD.split(text || "");
    const fence = segs.find(s => s.kind === "fence" && (s.lang === "html" || s.lang === "") && /<!DOCTYPE|<html/i.test(s.body));
    if (fence) return fence.body.trim();
    const m = (text || "").match(/<!DOCTYPE[\s\S]*<\/html>/i) || (text || "").match(/<html[\s\S]*<\/html>/i);
    if (m) return m[0].trim();
    return null;
  }

  async function callModel(prompt, sysPrompt, temp, maxTok, signal) {
    const msgs = [];
    if (sysPrompt) msgs.push({ role: "system", content: sysPrompt });
    msgs.push({ role: "user", content: prompt });
    return Ace.API.stream({
      model: Ace.ROUTE.work, fallbackChain: Ace.chainFor(Ace.ROUTE.work, "work"), taskKey: "work",
      temperature: temp, maxTokens: maxTok, messages: msgs, signal,
      thinking: "disabled" // structured-output tasks: don't burn tokens on reasoning.
    });
  }

  const parseJSONLoose = (text) => Ace.Blocks.parse(text) ||
    (() => { const m = (text || "").match(/\{[\s\S]*\}/); if (!m) return null;
      try { return JSON.parse(m[0]); } catch (e) { return null; } })();

  /* what part of the HTML file is the model writing right now? */
  function buildSection(code) {
    if (/<\/script>/i.test(code)) return "finishing the file";
    if (/<script/i.test(code)) return "writing the JavaScript logic";
    if (/<body/i.test(code)) return "writing the page markup";
    if (/<style|<\/style>/i.test(code)) return "writing the CSS styles";
    if (/<head/i.test(code)) return "writing the document head";
    return "scaffolding";
  }

  /* files → compact prompt note */
  function filesNote(files) {
    if (!files || !files.length) return "";
    const lines = files.slice(0, 12).map((f, i) => {
      const body = String(f.text || "").slice(0, 14000);
      return `--- FILE ${i + 1}: ${f.name} (${(f.size / 1024).toFixed(1)} KB) ---\n\`\`\`${f.lang && f.lang !== "text" ? f.lang : ""}\n${body}\n\`\`\``;
    }).join("\n\n");
    return `The user attached ${files.length} file(s). Treat them as the source of truth / an existing project to build on:\n\n${lines}`;
  }

  /* ---------- main entry (called by Chat.send in agent mode) ---------- */
  W.send = async (text, images, files) => {
    if (W.running) return;
    files = files || [];
    if (images && images.length) Ace.UI.toast("Agent mode is text-first — building from your description", "info");
    const chat = await ensureWorkChat();
    const userMsg = { id: Ace.uid(), role: "user", content: text, images, files, createdAt: Date.now() };
    Ace.Chat.messages.push(userMsg);
    Ace.Chat.appendMessage(userMsg);
    await Ace.Store.addMessage(chat.id, userMsg);
    if (!chat.title) {
      chat.title = text.slice(0, 40) || "Build";
      Ace.Store.updateChat(chat.id, { title: chat.title }).catch(() => {});
      Ace.Memory.genTitle(text || "app build", chat.id).then(t => { chat.title = t; Ace.Chat.renderSidebar(); }).catch(() => {});
    }
    Ace.Chat.renderSidebar();
    await W.run(chat, text, files);
  };

  async function ensureWorkChat() {
    if (Ace.Chat.activeChat && (Ace.Chat.activeChat.mode || "chat") === "work") return Ace.Chat.activeChat;
    const chat = { id: Ace.uid(), title: "", mode: "work",
      createdAt: Date.now(), updatedAt: Date.now(), pinned: false, msgCount: 0, summary: "" };
    await Ace.Store.createChat(chat);
    Ace.Chat.chats.unshift(chat);
    Ace.Chat.activeChat = chat;
    Ace.Chat.renderSidebar();
    return chat;
  }

  W.run = async (chat, request, files) => {
    W.running = true;
    Ace.Chat.sending = true;
    Ace.App.setSending(true);
    const signal = (Ace.Chat.abort = new AbortController()).signal;
    files = files || [];
    const fNote = filesNote(files);

    // prior artifact in this chat? → iterate instead of replanning
    const priorArtifact = [...Ace.Chat.messages].reverse().find(m => m.artifacts && m.artifacts.length);
    const prior = priorArtifact ? priorArtifact.artifacts[priorArtifact.artifacts.length - 1] : null;

    const ai = {
      id: Ace.uid(), role: "assistant", content: "", createdAt: Date.now(), model: "",
      flags: {}, uiStates: {}, tasks: [],
      workTrace: { steps: [], versions: [], request: request.slice(0, 140) }, artifacts: null
    };
    ai.streaming = true;
    Ace.Chat.messages.push(ai);
    Ace.Chat.rerenderMessage(ai);
    Ace.Chat.scrollBottom();

    try {
      let plan = null, prevCode = prior ? prior.code : null, feedback = null, v = prior ? prior.v + 1 : 1;
      ai.content = "Building…";

      /* ---- ANALYZE (instant, gives the user immediate feedback) ---- */
      addStep(ai, "analyze", "Reading your request");
      const kindGuess = /\b(game|play|player|score|arcade)\b/i.test(request) ? "game" :
        /\b(site|website|page|landing|portfolio)\b/i.test(request) ? "site" :
        /\b(tool|calculator|tracker|timer|converter|generator)\b/i.test(request) ? "tool" : "app";
      const fileBits = files.length ? ` · ${files.length} attached file${files.length > 1 ? "s" : ""}` : "";
      endStep(ai, "analyze", "Reading your request", { state: "done", note: kindGuess + fileBits,
        detail: `Interpreted this as a <b>${kindGuess}</b> build.${files.length ? "<br>The attached files are being passed to the planner and builder as source material." : ""}` });

      /* ---- PLAN (skip when iterating) ---- */
      if (!prior) {
        addStep(ai, "plan", "Planning the build");
        const r = await callModel(Ace.PROMPTS.workPlanner(request, fNote), null, 0.35, 1200, signal);
        plan = parseJSONLoose(r.content) || { title: "Custom app", type: "app", oneLiner: request.slice(0, 100), features: [request.slice(0, 60)], steps: [{ name: "Build" }] };
        if (plan && plan.type === "none") {
          /* Not a build request (a question / small talk) → drop the agent
             placeholder and answer through the normal chat pipeline instead
             of inventing an app. Attached files, memories and auto web
             search all still apply. */
          Ace.Chat.finishTasks(ai); // stop the stopwatch ticker
          const node = document.querySelector(`[data-mid="${ai.id}"]`);
          if (node) node.remove();
          Ace.Chat.messages = Ace.Chat.messages.filter(x => x !== ai);
          await Ace.Chat.runCompletion(chat);
          return;
        }
        ai.workTrace.plan = plan;
        endStep(ai, "plan", "Plan ready: " + (plan.title || "build"), { state: "done",
          note: (plan.features || []).length + " features · " + ((plan.steps || []).length || "?") + " steps",
          detail: `<b>${Ace.esc(plan.oneLiner || "")}</b><br>` +
            (plan.features || []).map(f => "• " + Ace.esc(f)).join("<br>") +
            (plan.design && plan.design.style ? `<div class="ws-sub">Design: ${Ace.esc(plan.design.style)}</div>` : "") +
            ((plan.steps || []).length ? `<div class="ws-sub">Build order: ${plan.steps.map(s => Ace.esc(s.name || "")).join(" → ")}</div>` : "") });
        ai.model = r.model; ai.fallbackUsed = r.fallbackUsed;
      } else {
        plan = prior.plan || { title: prior.title, type: "app", oneLiner: request.slice(0, 100), features: [], steps: [] };
        ai.workTrace.plan = plan;
        addStep(ai, "iter", `Iterating on v${prior.v}`);
        endStep(ai, "iter", `Change request: ${request.slice(0, 60)}`, { state: "done",
          detail: `Building v${v} of <b>${Ace.esc(prior.title || "the app")}</b> with your changes.` });
      }

      /* ---- BUILD loop (build → review → fix, max 2 fixes) ---- */
      let code = null, review = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const buildK = attempt === 0 ? (prior ? "iter" : "build") : "fix";
        if (attempt > 0) addStep(ai, buildK, `Fixing ${review && review.issues && review.issues.length ? review.issues.length + " issue(s)" : "issues"}`);
        else if (attempt === 0 && !ai.workTrace.steps.find(s => s.k === buildK)) addStep(ai, buildK, `Building v${v}`);
        step(ai, buildK, attempt === 0 ? `Building v${v}` : `Rebuilding v${v} (pass ${attempt + 1})`, {
          state: "run", showCode: true, live: "starting…", pct: "" });
        Ace.Chat.taskBegin(ai, buildK, attempt === 0 ? `Building v${v}` : `Fixing v${v}`);
        Ace.Chat.rerenderMessage(ai);

        const buildPrompt = Ace.PROMPTS.workBuilder(plan, attempt > 0 ? code : prevCode, feedback, fNote);
        let full = "";
        const buildT0 = Date.now();
        let lastLive = 0;
        const doBuildStream = () => Ace.API.stream({
          model: Ace.ROUTE.work, fallbackChain: Ace.chainFor(Ace.ROUTE.work, "work"), taskKey: "work",
          temperature: 0.55, maxTokens: 16000, signal,
          messages: [{ role: "user", content: buildPrompt }],
          onDelta: (content) => {
            full = content;
            const now = Date.now();
            if (now - lastLive < 150) return; // cap live updates at ~7fps
            lastLive = now;
            const secs = ((now - buildT0) / 1000).toFixed(0);
            const kbs = ((content.length / 1024) / Math.max(0.5, (now - buildT0) / 1000)).toFixed(1);
            const label = `Building v${v} — ${buildSection(content)} · ${(content.length / 1000).toFixed(1)}k chars · ${kbs} KB/s · ${secs}s`;
            setLiveSummary(ai, buildK, buildSection(content));
            updateLive(ai, buildK, label, "", content);
          }
        });
        /* Builds stream for 1-3 minutes and school wifi / filters sometimes
           cut the connection mid-file. NEVER lose the build: if the stream
           drops, whatever already streamed is kept and the file continues
           from its tail (resumable builder). rawChat already retried the
           connection 3x, so a throw here with zero text is a real failure. */
        let res = null;
        try { res = await doBuildStream(); }
        catch (e) {
          if (e.name === "AbortError" || !full.trim()) throw e;
          step(ai, buildK, `Building v${v} — connection hiccup, resuming from the ${fmtKB(full.length)} already written`,
            { state: "run", showCode: true, live: "resuming where it stopped…" });
        }
        if (res && res.content) full = res.content;
        code = extractHTML(full);
        ai.model = (res && res.model) || ai.model;

        // incomplete or dropped? continue the file FROM WHERE IT STOPPED
        let continues = 0;
        while (!code && continues < 3) {
          continues++;
          step(ai, buildK, `Building v${v} — ${res && res.interrupted ? "connection dropped, " : ""}continuing the file (part ${continues + 1})`, { state: "run", showCode: true, live: "continuing…" });
          const tail = full.slice(-7000);
          let part = "";
          try {
            const c = await callModel(
              "Here is the END of the HTML file you were writing (it got cut off):\n\n```html\n" + tail + "\n```\n\nContinue the file EXACTLY where it stops — do not repeat any earlier code, do not restart, just output the continuation until `</html>`. If the file is already complete, output just `</html>`.",
              null, 0.55, 16000, signal);
            part = c.content || "";
          } catch (e) {
            if (e.name === "AbortError") throw e;
            if (continues >= 3) throw e; // surface the real network error
            // else: one more continuation attempt (transient blip)
          }
          if (!part.trim()) continue;
          full += "\n" + part;
          code = extractHTML(full);
        }
        if (!code) throw new Error("The builder didn't return a complete HTML file — try rephrasing what you want.");

        const lines = code.split("\n").length;
        endStep(ai, buildK, `Built v${v} — ${fmtKB(code.length)} of HTML`, {
          state: "done", note: `${lines} lines · ${fmtSecs(Date.now() - buildT0)}s`,
          detail: `Wrote <b>${fmtKB(code.length)}</b> across <b>${lines} lines</b> in ${fmtSecs(Date.now() - buildT0)}s.<br>Structure: ${[
            /<style[\s\S]*<\/style>/i.test(code) ? "inline CSS" : null,
            /<script[\s\S]*<\/script>/i.test(code) ? "inline JS" : null,
            /canvas/i.test(code) ? "canvas rendering" : null,
            /requestAnimationFrame/i.test(code) ? "animation loop" : null,
            /localStorage/i.test(code) ? "local save" : null
          ].filter(Boolean).join(" · ")}` });

        /* ---- REVIEW ---- */
        const revK = "review" + attempt;
        addStep(ai, revK, "Reviewing the code");
        const rr = await callModel(Ace.PROMPTS.workReviewer(plan, code), null, 0.25, 900, signal);
        review = parseJSONLoose(rr.content) || { verdict: "pass", score: 7, issues: [], improvements: [] };
        const issueTxt = (review.issues || []).length ? (review.issues || []).map(i => "• " + Ace.esc(String(i).slice(0, 160))).join("<br>") : "No blocking issues found.";
        endStep(ai, revK, `Self-review — ${review.score != null ? review.score + "/10" : "done"} · ${review.verdict}`, {
          state: "done", note: (review.issues || []).length + " issue(s)",
          detail: `<b>Score: ${review.score != null ? review.score + "/10" : "?"} — verdict: ${Ace.esc(review.verdict || "?")}</b><br>` + issueTxt +
            ((review.improvements || []).length ? `<div class="ws-sub">Polish notes for later versions:<br>${review.improvements.map(i => "• " + Ace.esc(String(i).slice(0, 140))).join("<br>")}</div>` : "") });

        // gate: only spend a rebuild pass on real breakage. A 7+/10 with
        // polish notes ships as-is (improvements listed for the next version).
        const fatal = (review.issues || []).some(i => /error|crash|broken|undefined|not work|doesn'?t work|fail/i.test(String(i)));
        if (review.verdict !== "fix" || !(review.issues || []).length || attempt >= 2 || ((review.score != null && review.score >= 7) && !fatal)) break;
        feedback = "Fix these issues:\n" + review.issues.map(i => "- " + i).join("\n") +
          "\nAlso apply improvements if trivial:\n" + (review.improvements || []).slice(0, 3).map(i => "- " + i).join("\n");
      }

      /* ---- SHIP ---- */
      ai.artifacts = [{ v, title: plan.title || "App", code, lang: "html", score: review && review.score, verdict: review && review.verdict, plan }];
      const whatNext = `Describe any change — "make it purple", "add a save button", "upload another file" — and I'll ship v${v + 1}.`;
      ai.content = `Shipped **${plan.title || "the app"}** (v${v}).\n\n${prior ? "Updated with your changes — " : ""}${review && review.score ? `Self-review score: **${review.score}/10**. ` : ""}${whatNext}`;
      ai.streaming = false;
      addStep(ai, "ship", `Shipped v${v}`);
      endStep(ai, "ship", `Shipped v${v}`, { state: "done",
        note: fmtKB(code.length) + (review && review.score ? ` · review ${review.score}/10` : ""),
        detail: `Live preview is rendered below. <b>Open app</b> runs it full-screen · <b>Download</b> saves the .html file · <b>Code</b> shows the source.` });
      Ace.Chat.finishTasks(ai);
      Ace.Chat.rerenderMessage(ai);
      await Ace.Store.addMessage(chat.id, ai);
      await Ace.Store.updateChat(chat.id, { msgCount: Ace.Chat.messages.length, updatedAt: Date.now() });
    } catch (e) {
      Ace.Chat.finishTasks(ai);
      if (e.name === "AbortError") {
        ai.streaming = false;
        ai.content = ai.content && ai.content !== "Building…" ? ai.content : "*(stopped)*";
        (ai.workTrace.steps || []).forEach(s => { if (s.state === "run") s.state = "fail"; delete s.showCode; delete s.live; });
        Ace.Chat.rerenderMessage(ai);
      } else {
        console.warn(e);
        ai.streaming = false; ai.error = true;
        (ai.workTrace.steps || []).forEach(s => { if (s.state === "run") s.state = "fail"; delete s.showCode; delete s.live; });
        ai.content = `**Build hit a snag.** ${Ace.esc(Ace.API.friendlyError(e))}`;
        Ace.Chat.rerenderMessage(ai);
      }
    } finally {
      W.running = false;
      Ace.Chat.sending = false;
      Ace.Chat.abort = null;
      Ace.App.setSending(false);
    }
  };

  Ace.Work = W;
})();
