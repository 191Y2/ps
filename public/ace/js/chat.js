/* ============================================================
   Ace — chat.js · conversations: sidebar, rendering, send flow,
   regenerate/edit, export. Work-mode message handling lives in
   work.js; this file powers Chat mode + shared plumbing.
   Includes the live TASK STOPWATCH: every phase of an answer
   (Searching the web · 3.4s, Thinking · 2.1s, Creating quiz UI ·
   7.9s …) streams into a chip row under the message header, with
   a "Worked for 12.5s" total when it finishes.
   ============================================================ */
"use strict";
window.Ace = window.Ace || {};
(function () {
  const $ = (id) => document.getElementById(id);
  const C = { chats: [], activeChat: null, messages: [], sending: false, abort: null };

  /* ================= SIDEBAR ================= */
  function groupLabel(ts) {
    const d = new Date(ts), now = new Date();
    const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days <= 7) return "Previous 7 days";
    if (days <= 30) return "Previous 30 days";
    return "Older";
  }

  C.renderSidebar = () => {
    const list = $("chatList");
    if (!list) return;
    const mode = Ace.App ? Ace.App.mode : "chat";
    const q = (($("chatSearch") && $("chatSearch").value) || "").toLowerCase().trim();
    let items = C.chats.filter(c => (c.mode || "chat") === mode);
    if (q) items = items.filter(c => (c.title || "").toLowerCase().includes(q));
    items.sort((a, b) => ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || ((b.updatedAt || 0) - (a.updatedAt || 0)));
    list.innerHTML = "";

    const pinned = items.filter(c => c.pinned);
    const rest = items.filter(c => !c.pinned);
    if (!items.length) {
      list.append(Ace.el("div", "sb-empty", mode === "work" ?
        "No projects yet — describe an app or game to build." :
        "No chats yet. Start one — I remember what matters."));
      return;
    }
    if (pinned.length) list.append(section("Pinned", pinned));
    const groups = {};
    rest.forEach(c => { const g = groupLabel(c.updatedAt || c.createdAt || 0); (groups[g] = groups[g] || []).push(c); });
    const ORDER = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];
    ORDER.forEach(g => { if (groups[g]) list.append(section(g, groups[g])); });

    function section(label, chats) {
      const sec = Ace.el("div", "sb-section");
      sec.append(Ace.el("div", "sb-sec-label", label));
      chats.forEach(chat => sec.append(item(chat)));
      return sec;
    }
    function item(chat) {
      const it = Ace.el("div", "sb-item" + (C.activeChat && C.activeChat.id === chat.id ? " active" : ""));
      const title = Ace.el("div", "sb-item-title", Ace.esc(chat.title || "New chat"));
      const acts = Ace.el("div", "sb-item-acts");
      const pinB = actBtn("pin", chat.pinned ? "Unpin" : "Pin");
      pinB.innerHTML = Ace.ICON("pin", 13);
      if (chat.pinned) pinB.classList.add("on");
      pinB.onclick = async (e) => {
        e.stopPropagation();
        chat.pinned = !chat.pinned;
        await Ace.Store.updateChat(chat.id, { pinned: chat.pinned });
        C.renderSidebar();
      };
      const renB = actBtn("edit", "Rename"); renB.innerHTML = Ace.ICON("edit", 13);
      renB.onclick = (e) => { e.stopPropagation(); renameChat(chat); };
      const delB = actBtn("trash", "Delete"); delB.innerHTML = Ace.ICON("trash", 13);
      delB.onclick = (e) => {
        e.stopPropagation();
        Ace.UI.confirm("Delete this chat?", "This removes the conversation and its messages.", async () => {
          await Ace.Store.deleteChat(chat.id);
          C.chats = C.chats.filter(x => x.id !== chat.id);
          if (C.activeChat && C.activeChat.id === chat.id) { C.activeChat = null; C.messages = []; C.renderMessages(); C.showWelcome(); }
          C.renderSidebar();
        });
      };
      acts.append(pinB, renB, delB);
      it.append(title, acts);
      it.onclick = () => C.open(chat.id);
      return it;
    }
    function actBtn(name, title) {
      const b = Ace.el("button", "sb-act", "");
      b.title = title; b.setAttribute("aria-label", title);
      return b;
    }
  };

  function renameChat(chat) {
    Ace.UI.prompt("Rename chat", chat.title || "", async (val) => {
      if (!val || !val.trim()) return;
      chat.title = val.trim().slice(0, 60);
      await Ace.Store.updateChat(chat.id, { title: chat.title });
      C.renderSidebar();
    });
  }

  async function loadChats() {
    try { C.chats = await Ace.Store.listChats(); }
    catch (e) { C.chats = []; }
    C.renderSidebar();
  }
  C.loadChats = loadChats;

  /* ================= MESSAGE RENDERING ================= */
  C.renderMessages = () => {
    const wrap = $("messages");
    wrap.innerHTML = "";
    C.messages.forEach(m => wrap.append(renderMessage(m)));
    C.showWelcome(C.messages.length === 0);
    C.scrollBottom(true);
  };

  C.showWelcome = (show) => {
    const w = $("welcome"), msgs = $("messages");
    if (!w) return;
    const mode = Ace.App ? Ace.App.mode : "chat";
    $("welcomeTitle").textContent = mode === "work" ? "What are we building?" : "What are we working on?";
    $("welcomeSub").textContent = mode === "work" ?
      "Describe an app, game, or site. Ace plans it, builds it, reviews it, ships it." :
      "Homework, essays, quizzes, research — I got you.";
    w.classList.toggle("hidden", !show);
    if (msgs && show) msgs.classList.add("hidden"); else if (msgs) msgs.classList.remove("hidden");
    renderWelcomeChips(mode);
  };

  function renderWelcomeChips(mode) {
    const wrap = $("welcomeChips");
    if (!wrap) return;
    wrap.innerHTML = "";
    const chips = mode === "work"
      ? [["code", "Build a game", "Build a polished browser game — canvas, 60fps, score, restart, mobile-friendly. Pick a fun concept and go."],
         ["clock", "Study tool app", "Build a study tool app — focus timer + task list + pomodoro stats, saved locally, clean design."],
         ["stats", "Dashboard site", "Build a sleek personal dashboard site — clock, quick links, notes with localStorage, dark mode."],
         ["spark", "Flashcard app", "Build a flashcards web app — decks, flip animation, known/review tracking, shuffle. Make it beautiful."]]
      : [["edit", "Essay help", "Help me write an essay — ask me for my topic, then guide me with structure and a strong intro."],
         ["bulb", "Quiz me", "Quiz me on something I'm studying — ask what subject first, then build me quizzes."],
         ["img", "Study guide", "Make me a study guide with key terms, a timeline, and a study plan."],
         ["img", "Solve from photo", ""],
         ["globe", "Search the web", ""]];
    chips.forEach(([icon, label, fill]) => {
      const ch = Ace.el("button", "chip", Ace.ICON(icon, 15) + " " + label);
      ch.onclick = () => {
        if (label === "Solve from photo") { const fi = $("fileInput"); fi && fi.click(); return; }
        if (label === "Search the web") { Ace.App.setWeb(true); const i = $("input"); i.placeholder = "Ask about anything current…"; i.focus(); return; }
        const i = $("input"); i.value = fill; Ace.App.resizeInput(); i.focus();
      };
      wrap.append(ch);
    });
  }

  /* ================= TASK STOPWATCH =================
     ai.tasks = [{k, label, t0, t1}] — t1 null while running.
     Rendered as chips; a 120ms interval re-renders the live one so
     the seconds tick in real time. */
  const fmtSecs = (ms) => ((ms || 0) / 1000).toFixed(1);

  function renderTaskBar(m) {
    const tasks = m.tasks || [];
    if (!tasks.length) return null;
    const running = m.streaming !== false && tasks.some(t => !t.t1);
    const bar = Ace.el("div", "taskbar");
    tasks.forEach((t, i) => {
      const live = !t.t1;
      const ms = live ? Date.now() - t.t0 : t.t1 - t.t0;
      const chip = Ace.el("span", "task-chip" + (live ? " run" : " done"),
        `${live ? '<span class="task-dot"></span>' : Ace.ICON("check", 11)}<span class="task-lbl">${Ace.esc(t.label)}</span><span class="task-time">${fmtSecs(ms)}s</span>`);
      chip.dataset.taskIdx = i;
      bar.append(chip);
    });
    const last = tasks[tasks.length - 1];
    if (!running && last && last.t1) {
      const total = tasks.reduce((a, t) => a + ((t.t1 || t.t0) - t.t0), 0);
      const tot = Ace.el("span", "task-total", `${Ace.ICON("clock", 11)} Worked for ${fmtSecs(total)}s`);
      bar.append(tot);
    }
    return bar;
  }

  const taskTimers = {};
  function startTaskTicker(m) {
    stopTaskTicker(m);
    taskTimers[m.id] = setInterval(() => {
      const node = document.querySelector(`[data-mid="${m.id}"] .taskbar`);
      if (!node) return;
      const bar = renderTaskBar(m);
      if (bar) node.replaceWith(bar);
      C.scrollBottom();
    }, 120);
  }
  function stopTaskTicker(m) {
    clearInterval(taskTimers[m.id]); delete taskTimers[m.id];
  }
  function finishTasks(m) {
    (m.tasks || []).forEach(t => { if (!t.t1) t.t1 = Date.now(); });
    stopTaskTicker(m);
  }

  function renderMessage(m) {
    if (m.role === "user") {
      const el = Ace.el("div", "msg msg-user");
      el.dataset.mid = m.id;
      const bubble = Ace.el("div", "bubble");
      if (m.images && m.images.length) {
        const grid = Ace.el("div", "msg-imgs");
        m.images.forEach(im => {
          const img = Ace.el("img", "msg-img");
          img.src = im.dataUrl || im; img.alt = "attached image";
          img.onclick = () => Ace.Images.lightbox(img.src);
          grid.append(img);
        });
        bubble.append(grid);
      }
      if (m.files && m.files.length) {
        const fr = Ace.el("div", "msg-files");
        m.files.forEach(f => {
          const kb = f.size < 1024 ? f.size + " B" : (f.size / 1024).toFixed(1) + " KB";
          fr.append(Ace.el("div", "msg-file",
            `<span class="fc-ic">${Ace.ICON(/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(f.name) ? "img" : "file", 13)}</span>
             <span class="msg-file-name" title="${Ace.esc(f.name)}">${Ace.esc(f.name)}</span>
             <span class="msg-file-size">${kb}</span>`));
        });
        bubble.append(fr);
      }
      if (m.content) bubble.append(Ace.el("div", "msg-text", Ace.esc(m.content).replace(/\n/g, "<br>")));
      const tools = Ace.el("div", "msg-tools");
      const edit = Ace.el("button", "mact", Ace.ICON("edit", 14));
      edit.title = "Edit & resend";
      edit.onclick = () => C.editUser(m.id);
      tools.append(edit);
      el.append(bubble, tools);
      return el;
    }

    // assistant
    const el = Ace.el("div", "msg msg-ai");
    el.dataset.mid = m.id;
    const avatar = Ace.el("div", "ai-avatar", Ace.ICON("spark", 15));
    const col = Ace.el("div", "msg-col");

    // header
    const head = Ace.el("div", "msg-head");
    const name = Ace.el("span", "msg-name", "Ace");
    const modelTag = m.model ? Ace.el("span", "msg-model", Ace.esc((Ace.modelById(m.model) || {}).label || m.model)) : null;
    head.append(name);
    if (modelTag) head.append(modelTag);
    if (m.flags && m.flags.web) head.append(Ace.el("span", "msg-flag", Ace.ICON("globe", 12) + " Searched the web"));
    if (m.flags && m.flags.think) head.append(Ace.el("span", "msg-flag", Ace.ICON("bulb", 12) + " Thought hard"));
    if (m.flags && m.flags.deep) head.append(Ace.el("span", "msg-flag", Ace.ICON("search", 12) + " Deep research"));
    if (m.fallbackUsed) head.append(Ace.el("span", "msg-flag warn", Ace.ICON("warn", 12) + " fell back to free model"));
    if (m.error) head.append(Ace.el("span", "msg-flag warn", Ace.ICON("warn", 12) + " error"));

    col.append(head);

    // task stopwatch chips
    const tb = renderTaskBar(m);
    if (tb) col.append(tb);

    if (m.reasoning) {
      const t = Ace.el("details", "thinking");
      t.innerHTML = `<summary>${Ace.ICON("bulb", 13)} Reasoning</summary><div class="thinking-body">${Ace.esc(m.reasoning).replace(/\n/g, "<br>")}</div>`;
      if (m.streaming) t.open = true;
      col.append(t);
    }

    if (m.workTrace) col.append(Ace.Work.renderTrace(m)); // work-mode agent trace

    const body = Ace.el("div", "msg-body");
    body.append(...renderContent(m));
    col.append(body);

    if (m.searchResult && m.searchResult.length) col.append(renderSources(m.searchResult));

    // actions
    const acts = Ace.el("div", "msg-acts");
    const copy = Ace.el("button", "mact", Ace.ICON("copy", 14));
    copy.title = "Copy";
    copy.onclick = () => {
      navigator.clipboard && navigator.clipboard.writeText(m.content || "");
      copy.innerHTML = Ace.ICON("check", 14);
      setTimeout(() => copy.innerHTML = Ace.ICON("copy", 14), 1200);
    };
    acts.append(copy);
    if (!m.streaming && !m.error) {
      const regen = Ace.el("button", "mact", Ace.ICON("refresh", 14));
      regen.title = "Regenerate";
      regen.onclick = () => C.regenerate(m.id);
      acts.append(regen);
      const up = Ace.el("button", "mact" + (m.rating === 1 ? " on" : ""), Ace.ICON("thumbUp", 15));
      const down = Ace.el("button", "mact" + (m.rating === -1 ? " on" : ""), Ace.ICON("thumbDown", 15));
      up.title = "Good answer"; down.title = "Bad answer";
      up.onclick = () => rate(m, 1); down.onclick = () => rate(m, -1);
      acts.append(up, down);
    }
    if (m.streaming) {
      const stop = Ace.el("button", "mact stop", Ace.ICON("stop", 14) + " Stop");
      stop.onclick = () => C.abort && C.abort.abort();
      acts.append(stop);
    }
    if (m.error) {
      const retry = Ace.el("button", "mact", Ace.ICON("refresh", 14) + " Retry");
      retry.onclick = () => C.regenerate(m.id, true);
      acts.append(retry);
    }
    col.append(acts);
    el.append(avatar, col);
    return el;
  }

  function rate(m, v) {
    m.rating = m.rating === v ? 0 : v;
    Ace.Store.updateMessage(C.activeChat.id, m.id, { rating: m.rating }).catch(() => {});
    C.rerenderMessage(m);
  }

  function renderSources(sources) {
    const wrap = Ace.el("div", "sources");
    wrap.append(Ace.el("div", "sources-label", Ace.ICON("globe", 13) + " Sources"));
    const row = Ace.el("div", "sources-row");
    sources.slice(0, 10).forEach((s, i) => {
      let host = s.media || s.link || "";
      try { host = new URL(s.link).hostname.replace(/^www\./, ""); } catch (e) {}
      const chip = Ace.el("a", "source-chip",
        `${s.icon ? `<img class="src-ic" src="${Ace.esc(s.icon)}" alt="">` : `<span class="src-n">${i + 1}</span>`}
         <span class="src-t">${Ace.esc(s.title || host).slice(0, 42)}</span><span class="src-h">${Ace.esc(host)}</span>`);
      chip.href = s.link || "#"; chip.target = "_blank"; chip.rel = "noopener noreferrer";
      chip.title = s.title || host;
      row.append(chip);
    });
    wrap.append(row);
    return wrap;
  }

  /* ---- content segments: markdown runs + UI blocks + code fences ---- */
  function renderContent(m, streaming) {
    const nodes = [];
    const segs = Ace.MD.split(m.content || "");
    segs.forEach((seg, idx) => {
      if (seg.kind === "md") {
        if (!seg.text.trim()) return;
        const div = Ace.el("div", "md");
        div.innerHTML = Ace.MD.render(seg.text);
        nodes.push(div);
      } else { // fence
        const looksUI = Ace.Blocks.isBlock(seg.lang) || seg.lang === "json" || seg.lang === "";
        if (looksUI && !seg.closed && m.streaming) {
          nodes.push(Ace.el("div", "blk blk-skeleton", `<div class="skel-line"></div><div class="skel-line short"></div><div class="skel-line"></div><div class="skel-note">${Ace.ICON("spark", 13)} composing UI…</div>`));
        } else if (looksUI) {
          nodes.push(Ace.Blocks.render(seg.lang, seg.body, blockCtx(m, idx)));
        } else if (seg.lang === "html" && m.artifacts && m.artifacts.length) {
          // handled by work.js trace/artifact UI; skip raw echo
        } else if (seg.body && seg.body.trim()) {
          nodes.push(Ace.Blocks.renderCode(seg.lang, seg.body));
        }
      }
    });
    return nodes;
  }

  function blockCtx(m, idx) {
    return {
      messageId: m.id, blockIndex: idx,
      state: (m.uiStates || {})[idx],
      save: (patch) => {
        m.uiStates = m.uiStates || {};
        m.uiStates[idx] = Object.assign({}, m.uiStates[idx], patch);
        C.persistUIStates(m);
      }
    };
  }
  const uiTimers = {};
  C.persistUIStates = (m) => {
    clearTimeout(uiTimers[m.id]);
    uiTimers[m.id] = setTimeout(() => {
      if (C.activeChat) Ace.Store.updateMessage(C.activeChat.id, m.id, { uiStates: m.uiStates || {} }).catch(() => {});
    }, 900);
  };

  /* ================= OPEN / CREATE ================= */
  C.open = async (chatId) => {
    const chat = C.chats.find(c => c.id === chatId);
    if (!chat) return;
    C.activeChat = chat;
    if (Ace.App.mode !== (chat.mode || "chat")) Ace.App.setMode(chat.mode || "chat");
    try { C.messages = await Ace.Store.listMessages(chatId); }
    catch (e) { C.messages = []; }
    C.renderSidebar();
    C.renderMessages();
    history.replaceState(null, "", "#" + chatId);
  };

  C.newChat = () => {
    C.activeChat = null; C.messages = [];
    C.renderSidebar(); C.renderMessages();
    history.replaceState(null, "", "#");
    const i = $("input"); if (i) i.focus();
  };

  async function ensureChat(mode) {
    if (C.activeChat) return C.activeChat;
    const chat = {
      id: Ace.uid(), title: "", mode: mode || "chat",
      createdAt: Date.now(), updatedAt: Date.now(), pinned: false, msgCount: 0, summary: ""
    };
    await Ace.Store.createChat(chat);
    C.chats.unshift(chat);
    C.activeChat = chat;
    C.renderSidebar();
    return chat;
  }

  /* ================= SEND FLOW ================= */
  C.send = async () => {
    if (C.sending) return;
    const input = $("input");
    const text = input.value.trim();
    const images = Ace.Images.pending.slice();
    const files = Ace.Files ? Ace.Files.take() : [];
    if (!text && !images.length && !files.length) return;
    if (!Ace.API.hasKey()) { Ace.UI.openSettings(); return; }

    input.value = ""; Ace.App.resizeInput();
    Ace.Images.pending.length = 0; Ace.Images.renderChips();

    const mode = Ace.App.mode;
    if (mode === "work") return Ace.Work.send(text, images, files); // agent mode pipeline

    const chat = await ensureChat(mode);
    const userMsg = { id: Ace.uid(), role: "user", content: text, images, files, createdAt: Date.now() };
    C.messages.push(userMsg);
    C.appendMessage(userMsg);
    await Ace.Store.addMessage(chat.id, userMsg);
    if (!chat.title) {
      chat.title = text.slice(0, 40) || (images.length ? "Images" : "Files");
      Ace.Store.updateChat(chat.id, { title: chat.title }).catch(() => {});
      Ace.Memory.genTitle(text || "image analysis", chat.id).then(t => {
        chat.title = t; C.renderSidebar();
      }).catch(() => {});
    }
    C.renderSidebar();
    await runCompletion(chat);
  };

  /* task helpers bound to an assistant message */
  function taskBegin(ai, k, label) {
    ai.tasks = ai.tasks || [];
    const ex = ai.tasks.find(t => t.k === k);
    if (ex) { if (ex.t1) { ex.t1 = null; ex.label = label; } }
    else ai.tasks.push({ k, label, t0: Date.now(), t1: null });
    if (ai.streaming !== false) startTaskTicker(ai);
    C.rerenderMessage(ai);
  }
  function taskEnd(ai, k) {
    const t = (ai.tasks || []).find(t => t.k === k && !t.t1);
    if (t) t.t1 = Date.now();
    C.rerenderMessage(ai);
  }
  C.taskBegin = taskBegin;   // used by work.js (agentic trace timings)
  C.taskEnd = taskEnd;
  C.finishTasks = finishTasks;
  C.runCompletion = runCompletion; // used by work.js (agent → chat fallback for non-build requests)

  async function runCompletion(chat, retryOf) {
    C.sending = true;
    Ace.App.setSending(true);
    const t0 = Date.now();
    const ai = retryOf || {
      id: Ace.uid(), role: "assistant", content: "", createdAt: Date.now(),
      model: "", flags: { think: Ace.App.toggles.think, web: Ace.App.toggles.web, deep: Ace.App.toggles.deep },
      uiStates: {}, tasks: []
    };
    ai.tasks = ai.tasks || [];
    if (!retryOf) { C.messages.push(ai); }
    ai.streaming = true;
    C.rerenderMessage(ai);
    C.scrollBottom();
    startTaskTicker(ai);

    const lastUser = [...C.messages].reverse().find(m => m.role === "user");
    const userText = (lastUser && lastUser.content) || "";
    const hasImages = !!(lastUser && lastUser.images && lastUser.images.length);
    const hasFiles = !!(lastUser && lastUser.files && lastUser.files.length);

    try {
      // context assembly
      const settings = await Ace.Store.getSettings();
      const memories = await Ace.Memory.recall(userText).catch(() => []);
      const memHint = $("memHint"); if (memHint) memHint.textContent = memories.length ? `${memories.length} memories in context` : "";

      /* Auto web-grounding: current-events / live-fact questions get real
         references even when the Web toggle is off (the #1 hallucination
         source is stale training data answering "current" questions). */
      const autoWeb = settings.autoWebSearch !== false && !hasImages && !hasFiles && !Ace.App.toggles.web &&
        /\b(latest|today|tonight|right now|current(ly)?|news|prices?|record|score|champion|winner|reign)\b|\bwho (won|is|was|are|beat|plays|fought)\b|\bwho'?s (the|a|playing|winning)\b|\bhow (old|tall|many)\b|\bnet worth\b|\b(ranking|ranked|standings?|stats?|statistics)\b|\bweather\b|\b(up ?to ?date|update on|updated)\b|\b(stock|election|released|coming out|game last night|season|episode|schedule|draft|trade)\b|\b(still )?(alive|dead|retired|dating|married|together)\b|\btop \d+\b|\btrue or false\b|\b(fake|real)\b.*(news|story|video)?\s*\?|20(2[5-9]|3[0-9])/i.test(userText);
      const useWeb = Ace.App.toggles.web || autoWeb;
      const useDeep = Ace.App.toggles.deep && !hasImages;
      if (autoWeb) Ace.UI.toast("Auto web search on — this looks like a current-events question", "info");

      if (useDeep) {
        await runDeep(chat, ai, userText);
      } else {
        /* ---- REAL web search (blocks the reply; stopwatch shows live) ---- */
        let refs = [];
        if (useWeb && !hasImages) {
          taskBegin(ai, "search", "Searching the web");
          refs = await Ace.API.searchWeb(userText).catch(() => []);
          taskEnd(ai, "search");
          if (!refs.length && Ace.App.toggles.web)
            Ace.UI.toast("The web search came back empty — Ace will answer from what it knows and say so", "warn");
        }
        ai.flags.web = useWeb && !!refs.length; // honest flag: only claim it if it actually happened

        const sysPrompt = Ace.PROMPTS.chat({
          webSearch: useWeb, refs, memories, summary: chat.summary,
          quizHint: /quiz|test me|flash ?card|drill me|practice (test|questions?)|study for/i.test(userText),
          imageCount: hasImages ? lastUser.images.length : 0,
          fileCount: hasFiles ? lastUser.files.length : 0
        });
        const history = C.messages.slice(-Ace.HISTORY_LIMIT)
          .map(m => {
            const isLastUser = m.role === "user" && m === lastUser;
            let content = m.content;
            // files ride along with the LAST user message (full contents for the AI to view)
            if (isLastUser && m.files && m.files.length && Ace.Files)
              content = (content || "") + Ace.Files.buildContextFrom(m.files);
            return {
              role: m.role, content,
              // images only survive on the LAST user message (vision routing);
              // older image messages degrade to text so text models don't reject them
              images: (m.role === "user" && m === lastUser) ? m.images : undefined
            };
          });
        history.unshift({ role: "system", content: sysPrompt });

        /* routing: free-first. Think = reasoning ON (same free model).
           Images route to the vision model. Everything else runs with
           thinking OFF for instant first tokens. */
        let model, chain, thinking = "disabled";
        if (hasImages) { model = Ace.ROUTE.vision; chain = Ace.chainFor(Ace.ROUTE.vision, "vision"); thinking = "disabled"; }
        else if (Ace.App.toggles.think) { model = Ace.ROUTE.think; chain = Ace.chainFor(Ace.ROUTE.think, "text"); thinking = "enabled"; }
        else { model = Ace.ROUTE.chat; chain = Ace.chainFor(Ace.ROUTE.chat, "text"); }

        let streamDone = false; // ignore any late delta racing after completion
        const onDelta = (content, reasoning) => {
          if (streamDone) return;
          ai.content = content; ai.reasoning = reasoning; ai.streaming = true;
          // phase detection for the stopwatch
          if (reasoning && !content) taskBegin(ai, "think", "Thinking");
          else if (content) {
            if ((ai.tasks || []).some(t => t.k === "think" && !t.t1)) taskEnd(ai, "think");
            const opens = (content.match(/```/g) || []).length;
            if (opens % 2 === 1) { // we're inside an open fence right now
              const fm = content.slice(content.lastIndexOf("```")).match(/^```(\w+)/);
              if (fm && Ace.Blocks.isBlock(fm[1]))
                taskBegin(ai, "ui", "Creating " + (/quiz/.test(fm[1]) ? "quiz" : fm[1]) + " UI");
              else taskBegin(ai, "ui", "Writing code");
            } else {
              taskBegin(ai, "write", "Writing");
            }
          }
          C.rerenderMessage(ai, true);
          C.scrollBottom();
        };
        const res = await Ace.API.stream({
          model, fallbackChain: chain, taskKey: "chat", thinking,
          temperature: 0.35, // factual-first (hallucination research: 0.1-0.4)
          messages: history, signal: (C.abort = new AbortController()).signal,
          onDelta
        });
        streamDone = true;

        ai.content = res.content; ai.reasoning = res.reasoning || "";
        ai.model = res.model; ai.fallbackUsed = res.fallbackUsed;
        if (res.interrupted) { // connection dropped mid-answer — keep what streamed
          ai.content += "\n\n*(the connection dropped — this answer may be cut off; tap Retry to regenerate)*";
          ai.error = true;
        }
        ai.streaming = false;
        ai.searchResult = (useWeb && refs.length) ? refs : null;
        finishTasks(ai);
        C.rerenderMessage(ai);
        await Ace.Store.addMessage(chat.id, ai);
      }

      // background: memory + summary (never blocks the reply)
      Ace.Memory.extract(C.messages.slice(0, -1), chat.id).then(r => {
        if (r && (r.added || r.updated || r.deleted)) {
          const parts = [];
          if (r.added) parts.push(`${r.added} new`);
          if (r.updated) parts.push(`${r.updated} updated`);
          Ace.UI.toast(`Memory: ${parts.join(", ")}`, "ok");
        }
      }).catch(() => {});
      if (C.messages.length >= Ace.SUMMARIZE_AFTER && C.messages.length % 8 === 0) {
        Ace.Memory.summarize(chat, C.messages).catch(() => {});
      }
      await Ace.Store.updateChat(chat.id, { msgCount: C.messages.length, updatedAt: Date.now() });
    } catch (e) {
      finishTasks(ai);
      if (e.name === "AbortError") {
        ai.streaming = false; ai.content = ai.content || "*(stopped)*";
        C.rerenderMessage(ai);
        if (ai.content && ai.content !== "*(stopped)*") await Ace.Store.addMessage(chat.id, ai);
      } else {
        ai.streaming = false; ai.error = true;
        const partial = (ai.content || "").trim();
        const netDrop = e.kind === "network" || /dropped/i.test(e.message || "");
        if (partial && netDrop) {
          // keep whatever streamed before the drop — it's usually still useful
          ai.content = partial + "\n\n*(the connection dropped mid-answer — tap Retry to regenerate)*";
        } else {
          ai.content = `**Something went wrong.** ${Ace.esc(Ace.API.friendlyError(e))}`;
        }
        C.rerenderMessage(ai);
      }
    } finally {
      C.sending = false; C.abort = null;
      Ace.App.setSending(false);
      Ace.Images.pending.length = 0;
    }
  }

  /* ---- deep research pipeline ---- */
  async function runDeep(chat, ai) {
    const lastUser = [...C.messages].reverse().find(m => m.role === "user");
    const query = (lastUser && lastUser.content) || "";
    ai.flags.deep = true;
    ai.flags.web = true;
    const res = await Ace.API.deepResearch({
      query, chain: Ace.chainFor(Ace.ROUTE.deep, "text"),
      signal: (C.abort = new AbortController()).signal,
      onStep: (label, state) => {
        const k = "step-" + label.split(" ")[0].toLowerCase();
        if (state === "run") taskBegin(ai, k, label);
        else taskEnd(ai, k);
      }
    });
    ai.content = res.report; ai.model = res.model || Ace.ROUTE.deep;
    ai.searchResult = res.sources; ai.streaming = false;
    ai.reasoning = "";
    finishTasks(ai);
    C.rerenderMessage(ai);
    await Ace.Store.addMessage(chat.id, ai);
  }

  /* ================= ACTIONS ================= */
  C.regenerate = async (msgId, isRetry) => {
    if (C.sending) return;
    const idx = C.messages.findIndex(m => m.id === msgId);
    if (idx < 0) return;
    // drop this assistant msg and everything after it, keep the user turn
    C.messages = C.messages.slice(0, idx);
    const lastUser = [...C.messages].reverse().find(m => m.role === "user");
    if (C.activeChat && (C.activeChat.mode === "work") && lastUser && Ace.Work && !Ace.Work.running) {
      await Ace.Work.run(C.activeChat, lastUser.content || "", lastUser.files || []);
    } else {
      await runCompletion(C.activeChat);
    }
  };

  C.editUser = (msgId) => {
    const idx = C.messages.findIndex(m => m.id === msgId);
    if (idx < 0 || C.sending) return;
    const m = C.messages[idx];
    const input = $("input");
    input.value = m.content || "";
    Ace.Images.pending.length = 0;
    (m.images || []).forEach(im => Ace.Images.pending.push(im));
    Ace.Images.renderChips();
    Ace.App.resizeInput();
    C.messages = C.messages.slice(0, idx);
    C.renderMessages();
    input.focus();
  };

  C.rerenderMessage = (m, streamingSkipScroll) => {
    const old = document.querySelector(`[data-mid="${m.id}"]`);
    if (!old) { C.appendMessage(m); return; }
    const node = renderMessage(m);
    old.replaceWith(node);
  };
  C.appendMessage = (m) => {
    const wrap = $("messages");
    wrap.classList.remove("hidden");
    $("welcome") && $("welcome").classList.add("hidden");
    wrap.append(renderMessage(m));
  };

  /* stick-to-bottom scrolling */
  let pinned = true;
  C.scrollBottom = (force) => {
    const z = $("scrollZone");
    if (!z) return;
    if (force || pinned) requestAnimationFrame(() => { z.scrollTop = z.scrollHeight; });
  };
  C.initScroll = () => {
    const z = $("scrollZone");
    if (!z) return;
    z.addEventListener("scroll", () => {
      pinned = z.scrollHeight - z.scrollTop - z.clientHeight < 120;
    }, { passive: true });
  };

  /* quiz → harder quiz loop */
  document.addEventListener("ace:block-action", (e) => {
    const d = e.detail || {};
    if (d.type === "quiz-harder") {
      const input = $("input");
      input.value = `That quiz was good. Now make a HARDER one on ${d.topic || "the same topic"} — trickier questions, deeper application, same format.`;
      input.focus();
      Ace.App.sendCurrent && Ace.App.sendCurrent();
    }
  });

  /* model fallback notice */
  document.addEventListener("ace:model-fallback", (e) => {
    const to = (Ace.modelById(e.detail.to) || {}).label || e.detail.to;
    Ace.UI.toast(`${to} picked up the job (the preferred model needs Z.ai balance)`, "warn");
  });

  /* ================= EXPORT ================= */
  C.exportChat = () => {
    if (!C.activeChat || !C.messages.length) return Ace.UI.toast("Nothing to export yet", "warn");
    let md = `# ${C.activeChat.title || "Ace chat"}\n\n_${new Date(C.activeChat.createdAt || Date.now()).toLocaleString()} · exported from Ace_\n\n`;
    C.messages.forEach(m => {
      md += m.role === "user" ? `## You\n\n` : `## Ace${m.model ? ` (${m.model})` : ""}\n\n`;
      if (m.images && m.images.length) md += `*(${m.images.length} image${m.images.length > 1 ? "s" : ""} attached)*\n\n`;
      md += (m.content || "") + "\n\n";
    });
    downloadBlob(md, (C.activeChat.title || "ace-chat").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") + ".md", "text/markdown");
  };
  function downloadBlob(text, name, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  C.init = async () => {
    await loadChats();
    C.initScroll();
    const hash = location.hash.replace("#", "");
    if (hash && C.chats.find(c => c.id === hash)) { C.open(hash); return; }
    // no deep link → reopen the most recent chat of the current mode so a
    // reload never loses the conversation (fallback: welcome screen)
    const mode = (Ace.App && Ace.App.mode) || "chat";
    const last = C.chats.filter(c => (c.mode || "chat") === mode)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (last) { await C.open(last.id); return; }
    C.showWelcome(true);
  };

  Ace.Chat = C;
})();
