/* ============================================================
   Ace — app.js · boot, shell UI, toggles, modals, settings,
   memory manager, voice input, keyboard shortcuts.
   ============================================================ */
"use strict";
window.Ace = window.Ace || {};
(function () {
  const $ = (id) => document.getElementById(id);
  const App = { mode: "chat", toggles: { think: false, deep: false, web: false }, ready: false };

  /* =============== UI primitives =============== */
  const UI = {};
  UI.toast = (msg, kind) => {
    const t = Ace.el("div", "toast " + (kind || "info"), msg);
    $("toasts").append(t);
    setTimeout(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 350); }, 3600);
  };

  function modal(title, bodyNode, opts) {
    const root = $("modalRoot");
    root.innerHTML = "";
    const back = Ace.el("div", "modal-back");
    const m = Ace.el("div", "modal");
    m.setAttribute("role", "dialog");
    m.setAttribute("aria-modal", "true");
    const head = Ace.el("div", "modal-head",
      `<div class="modal-title">${Ace.esc(title)}</div>`);
    const x = Ace.el("button", "modal-x", Ace.ICON("close", 18));
    x.onclick = close;
    head.append(x);
    m.append(head);
    const body = Ace.el("div", "modal-body");
    body.append(bodyNode);
    m.append(body);
    if (opts && opts.footer) m.append(opts.footer);
    back.append(m);
    back.onclick = (e) => { if (e.target === back) close(); };
    root.append(back);
    requestAnimationFrame(() => back.classList.add("show"));
    function close() { back.classList.remove("show"); setTimeout(() => { if (root.contains(back)) root.removeChild(back); }, 200); }
    return { close, modal: m };
  }
  UI.modal = modal;

  UI.confirm = (title, body, onOk, okLabel) => {
    const b = Ace.el("div", "", `<p class="muted">${Ace.esc(body)}</p>`);
    const foot = Ace.el("div", "modal-foot");
    const cancel = Ace.el("button", "btn btn-ghost", "Cancel");
    const ok = Ace.el("button", "btn btn-danger", okLabel || "Delete");
    foot.append(cancel, ok);
    const h = modal(title, b, { footer: foot });
    cancel.onclick = h.close;
    ok.onclick = async () => { h.close(); await onOk(); };
  };

  UI.prompt = (title, value, onOk) => {
    const b = Ace.el("div", "");
    const inp = Ace.el("input", "input");
    inp.type = "text"; inp.value = value || "";
    b.append(inp);
    const foot = Ace.el("div", "modal-foot");
    const cancel = Ace.el("button", "btn btn-ghost", "Cancel");
    const ok = Ace.el("button", "btn btn-primary", "Save");
    foot.append(cancel, ok);
    const h = modal(title, b, { footer: foot });
    cancel.onclick = h.close;
    const go = () => { if (inp.value.trim()) { h.close(); onOk(inp.value.trim()); } };
    ok.onclick = go;
    inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
    setTimeout(() => inp.focus(), 60);
  };

  /* =============== SETTINGS =============== */
  UI.openSettings = async () => {
    const s = await Ace.Store.getSettings();
    const b = Ace.el("div", "settings");

    // API key
    const keySec = section("Z.ai API key");
    const keyRow = Ace.el("div", "field-row");
    const keyInp = Ace.el("input", "input mono");
    keyInp.type = "password"; keyInp.placeholder = "Paste your Z.ai API key";
    keyInp.value = Ace.API.key || "";
    const eye = Ace.el("button", "btn btn-icon");
    eye.innerHTML = Ace.ICON("eye", 15);
    eye.title = "Show / hide";
    eye.onclick = () => {
      keyInp.type = keyInp.type === "password" ? "text" : "password";
      eye.innerHTML = Ace.ICON(keyInp.type === "password" ? "eye" : "eyeOff", 15);
    };
    const testB = Ace.el("button", "btn btn-ghost", "Test");
    const saveB = Ace.el("button", "btn btn-primary", "Save key");
    keyRow.append(keyInp, eye, testB, saveB);
    testB.onclick = async () => {
      testB.textContent = "Testing…"; testB.disabled = true;
      const r = await Ace.API.testKey(keyInp.value);
      testB.textContent = "Test"; testB.disabled = false;
      UI.toast(r.ok ? "Key works — free GLM-4.5 Flash responded" : Ace.API.friendlyError(r.error), r.ok ? "ok" : "warn");
    };
    saveB.onclick = async () => {
      const k = keyInp.value.trim();
      if (!k) return UI.toast("Paste a key first", "warn");
      Ace.API.setKey(k);
      try { await Ace.Store.setSharedKey(k); } catch (e) { /* local fallback keeps it anyway */ }
      localStorage.setItem("ace:v1:key", k);
      UI.toast("Key saved — stored in your Firebase, not in the repo", "ok");
      hideSetup();
      Ace.API.warm && Ace.API.warm(); // pre-warm the CORS preflight (static hosts)
    };
    keySec.append(keyRow, note("Stored privately in your Firestore (config/secrets) — it never ships in the GitHub repo. Get a free key at z.ai → API Keys."));
    b.append(keySec);

    // models
    const modelSec = section("Default models");
    modelSec.append(modelSelect("Chat (casual)", "chatModel", Ace.ROUTE.chat, m => !m.vision));
    modelSec.append(modelSelect("Think (deep answers)", "thinkModel", Ace.ROUTE.think));
    modelSec.append(modelSelect("Agent (app builder)", "workModel", Ace.ROUTE.work));
    modelSec.append(note("Free models work with zero balance. Premium models auto-fall back to GLM-4.5 Flash if your key lacks balance (error 1113). You can also switch the Agent model from the top bar in Agent mode."));
    b.append(modelSec);

    // behavior
    const behSec = section("Behavior");
    behSec.append(toggleRow("Auto web search on current-events questions", "autoWebSearch", s.autoWebSearch !== false));
    behSec.append(toggleRow("Auto-remember important things about me", "autoMemory", s.autoMemory !== false));
    b.append(behSec);

    // data
    const dataSec = section("Data");
    const exp = Ace.el("button", "btn btn-ghost", Ace.ICON("download", 14) + "Export this chat (.md)");
    exp.onclick = () => { Ace.Chat.exportChat(); };
    const wipe = Ace.el("button", "btn btn-danger", Ace.ICON("trash", 14) + "Erase all local data");
    wipe.onclick = () => UI.confirm("Erase everything?", "All chats and memories saved on this device will be wiped. Cloud data stays in your Firebase.", async () => {
      ["ace:v1:chats", "ace:v1:memories", "ace:v1:settings", "ace:v1:uid"].forEach(k => localStorage.removeItem(k));
      location.reload();
    });
    dataSec.append(exp, wipe);
    b.append(dataSec);

    const about = Ace.el("div", "settings-about",
      `<b>Ace</b> v${Ace.VERSION} · AI study copilot · GLM models via Z.ai · ${Ace.Store.mode === "cloud" ? "Cloud synced (Firebase)" : "Saved locally (this device)"}<br>
       Runs 100% in your browser — perfect for GitHub Pages + school Chromebooks.`);
    b.append(about);

    function section(t) { return Ace.el("div", "settings-sec", `<div class="settings-sec-t">${t}</div>`); }
    function note(t) { return Ace.el("div", "settings-note", t); }
    function toggleRow(label, key, on) {
      const row = Ace.el("div", "toggle-row");
      row.innerHTML = `<span>${label}</span>`;
      const tg = Ace.el("button", "switch" + (on ? " on" : ""), "<span></span>");
      tg.onclick = async () => {
        tg.classList.toggle("on");
        await Ace.Store.saveSettings({ [key]: tg.classList.contains("on") });
      };
      row.append(tg);
      return row;
    }
    function modelSelect(label, key, cur, filter) {
      const row = Ace.el("div", "field-col");
      row.innerHTML = `<label class="lbl">${label}</label>`;
      const sel = Ace.el("select", "input");
      const models = Ace.MODELS.filter(m => filter ? filter(m) : true);
      if (!models.find(m => m.id === cur)) {
        const o = Ace.el("option", "", "Auto (best available)");
        o.value = ""; sel.append(o);
      }
      models.forEach(m => {
        const o = Ace.el("option", "", `${m.label} — ${m.tag}`);
        o.value = m.id; if (m.id === cur) o.selected = true;
        sel.append(o);
      });
      sel.onchange = async () => { await Ace.Store.saveSettings({ [key]: sel.value }); applyRouteOverrides(await Ace.Store.getSettings()); };
      row.append(sel);
      return row;
    }
    modal("Settings", b);
  };

  function applyRouteOverrides(s) {
    if (s.chatModel) Ace.ROUTE.chat = s.chatModel;
    if (s.thinkModel) Ace.ROUTE.think = s.thinkModel;
    if (s.workModel) Ace.ROUTE.work = s.workModel;
  }

  /* =============== MEMORY MANAGER =============== */
  UI.openMemory = async () => {
    const mems = await Ace.Memory.all();
    const b = Ace.el("div", "memory");
    const head = Ace.el("div", "memory-head",
      `<div class="memory-count"><b>${mems.length}</b> memor${mems.length === 1 ? "y" : "ies"}</div>
       <div class="muted">Ace weaves these into every conversation — manage what sticks.</div>`);
    b.append(head);
    const addRow = Ace.el("div", "memory-add");
    const inp = Ace.el("input", "input");
    inp.placeholder = "Teach Ace something to remember… (e.g. I have a chemistry final on June 3)";
    const addB = Ace.el("button", "btn btn-primary", "Remember");
    addRow.append(inp, addB);
    b.append(addRow);
    addB.onclick = async () => {
      if (!inp.value.trim()) return;
      await Ace.Store.saveMemory({
        id: Ace.uid(), type: "fact", content: inp.value.trim(), importance: 4,
        createdAt: Date.now(), lastAccessed: Date.now(), accessCount: 0, pinned: false
      });
      inp.value = "";
      UI.toast("Remembered", "ok");
      h.close();
      UI.openMemory();
    };

    const groups = {};
    mems.forEach(m => { (groups[m.type || "fact"] = groups[m.type || "fact"] || []).push(m); });
    Object.entries(groups).forEach(([type, list]) => {
      b.append(Ace.el("div", "memory-group-t", type.toUpperCase()));
      list.forEach(m => {
        const row = Ace.el("div", "memory-row");
        const main = Ace.el("div", "memory-main",
          `<div class="memory-content">${Ace.esc(m.content)}</div>
           <div class="memory-meta">${"●".repeat(m.importance || 1)}${"○".repeat(Math.max(0, 5 - (m.importance || 1)))} · used ${m.accessCount || 0}×</div>`);
        const acts = Ace.el("div", "memory-acts");
        const pin = Ace.el("button", "mact" + (m.pinned ? " on" : ""), Ace.ICON("pin", 13));
        pin.title = "Pin (always in context)";
        pin.onclick = async () => { m.pinned = !m.pinned; await Ace.Store.saveMemory(m); h.close(); UI.openMemory(); };
        const edit = Ace.el("button", "mact", Ace.ICON("edit", 13));
        edit.title = "Edit";
        edit.onclick = () => UI.prompt("Edit memory", m.content, async v => {
          m.content = v; await Ace.Store.saveMemory(m); h.close(); UI.openMemory();
        });
        const del = Ace.el("button", "mact", Ace.ICON("trash", 13));
        del.title = "Forget";
        del.onclick = () => UI.confirm("Forget this?", m.content, async () => {
          await Ace.Store.deleteMemory(m.id); h.close(); UI.openMemory(); UI.toast("Forgotten", "info");
        });
        acts.append(pin, edit, del);
        row.append(main, acts);
        b.append(row);
      });
    });
    if (!mems.length) b.append(Ace.el("div", "sb-empty", "Nothing yet — chat for a bit and Ace will start remembering the important stuff."));
    const h = modal("Memory", b);
  };

  /* =============== MODEL INFO POPOVER / AGENT MODEL PICKER =============== */
  function updateModelChip() {
    const chip = $("btnModelChip");
    if (!chip) return;
    if (App.mode === "work") {
      const m = Ace.modelById(Ace.ROUTE.work) || {};
      chip.innerHTML = Ace.ICON("code", 14) + " " + (m.label || "GLM-4.5 Flash");
      chip.title = "Agent builder model — click to change";
    } else {
      chip.innerHTML = Ace.ICON("spark", 14) + " Smart models";
      chip.title = "Model routing";
    }
  }

  function agentModelPicker() {
    const b = Ace.el("div", "modelpick");
    b.append(Ace.el("div", "modelpop-t", "Agent builder model <span class=\"muted\">· powers plan, code & self-review</span>"));
    Ace.MODELS.forEach(m => {
      const sel = m.id === Ace.ROUTE.work;
      const row = Ace.el("button", "mp-row" + (sel ? " sel" : ""));
      row.innerHTML = `<span class="mp-ic">${Ace.ICON(m.vision ? "img" : "code", 15)}</span>
        <span class="mp-body"><span class="mp-name">${Ace.esc(m.label)}</span><span class="mp-tag">${Ace.esc(m.tag)}</span></span>
        <span class="mp-radio">${sel ? Ace.ICON("check", 14) : ""}</span>`;
      row.onclick = async () => {
        Ace.ROUTE.work = m.id;
        try { await Ace.Store.saveSettings({ workModel: m.id }); } catch (e) {}
        h.close(); updateModelChip();
        Ace.UI.toast(`${m.label} is now the Agent builder`, "ok");
      };
      b.append(row);
    });
    b.append(Ace.el("div", "modelpop-note", "Free models need zero Z.ai balance. Premium picks auto-fall back to GLM-4.5 Flash when your key lacks balance (error 1113)."));
    const h = modal("Agent model", b);
  }

  function modelPopover() {
    if (App.mode === "work") return agentModelPicker();
    const b = Ace.el("div", "modelpop");
    const freeTag = (id) => { const m = Ace.modelById(id) || {}; return m.free ? "free" : "premium*"; };
    b.innerHTML = `
      <div class="modelpop-t">Smart routing <span class="muted">· auto-picks per task</span></div>
      ${row("spark", "Casual chat", "GLM-4.5 Flash · reasoning off", "free")}
      ${row("bulb", "Think toggle", "GLM-4.5 Flash · reasoning on", "free")}
      ${row("globe", "Web search", "GLM-4.5 Flash + live search", "free")}
      ${row("img", "Images", "GLM-4.6V Flash", "free")}
      ${row("code", "Agent builder", (Ace.modelById(Ace.ROUTE.work) || {}).label, freeTag(Ace.ROUTE.work))}
      ${row("search", "Deep research", (Ace.modelById(Ace.ROUTE.deep) || {}).label, freeTag(Ace.ROUTE.deep))}
      <div class="modelpop-note">Everything runs on free models by default — no Z.ai balance needed. * Premium picks in Settings auto-fall back to free Flash when your key lacks balance. Switch to the Agent tab to pick the builder model directly.</div>`;
    function row(ic, task, model, tag) {
      return `<div class="modelpop-row"><span class="mp-ic">${Ace.ICON(ic, 15)}</span><span class="mp-task">${task}</span><span class="mp-model">${Ace.esc(model || "")}</span><span class="mp-tag ${tag === "free" ? "ok" : ""}">${tag}</span></div>`;
    }
    modal("Models", b);
  }

  /* =============== SETUP SCREEN =============== */
  function showSetup() {
    const scr = $("setupScreen");
    scr.classList.remove("hidden");
    const inp = $("setupKey");
    const go = $("setupGo");
    const msg = $("setupMsg");
    inp.focus();
    go.onclick = async () => {
      const k = inp.value.trim();
      if (!k) { msg.textContent = "Paste your key to continue (it's stored privately in your Firebase, never in the GitHub repo)."; return; }
      go.disabled = true; go.textContent = "Checking key…";
      const r = await Ace.API.testKey(k);
      go.disabled = false; go.textContent = "Launch Ace →";
      if (!r.ok) { msg.textContent = Ace.API.friendlyError(r.error); return; }
      Ace.API.setKey(k);
      await Ace.Store.setSharedKey(k).catch(() => {});
      localStorage.setItem("ace:v1:key", k);
      hideSetup();
      UI.toast("Connected — GLM-4.5 Flash responded", "ok");
    };
    inp.onkeydown = (e) => { if (e.key === "Enter") go.click(); };
  }
  function hideSetup() { $("setupScreen").classList.add("hidden"); }

  /* =============== SHELL =============== */
  App.setMode = (mode) => {
    App.mode = mode;
    try { localStorage.setItem("ace:v1:mode", mode); } catch (e) {}
    document.querySelectorAll(".mode-pill button").forEach(b =>
      b.classList.toggle("active", b.dataset.mode === mode));
    const input = $("input");
    input.placeholder = mode === "work" ? "Describe an app, game, or site to build…" : "Ask anything — homework, essays, quizzes, research";
    $("btnNewChat").querySelector("span").textContent = mode === "work" ? "New project" : "New chat";
    updateModelChip();
    Ace.Chat.showWelcome(Ace.Chat.messages.length === 0 || !Ace.Chat.activeChat);
  };

  App.setWeb = (on) => { App.toggles.web = on; $("btnWeb").classList.toggle("on", on); };

  App.setSending = (busy) => {
    const send = $("btnSend");
    send.innerHTML = busy ? Ace.ICON("stop", 18) : Ace.ICON("arrowUp", 18);
    send.classList.toggle("stop", busy);
    send.title = busy ? "Stop" : "Send";
  };

  App.resizeInput = () => {
    const i = $("input");
    i.style.height = "auto";
    i.style.height = Math.min(i.scrollHeight, 190) + "px";
  };

  App.sendCurrent = () => Ace.Chat.send();

  /* voice input */
  let rec = null, recOn = false;
  function initVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = $("btnMic");
    if (!SR) { btn.style.display = "none"; return; }
    rec = new SR();
    rec.continuous = false; rec.interimResults = true;
    rec.lang = (navigator.languages && navigator.languages[0]) || navigator.language || "en-US";
    let base = "";
    rec.onstart = () => { recOn = true; base = $("input").value ? $("input").value + " " : ""; btn.classList.add("rec"); };
    rec.onresult = (e) => {
      let t = "";
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      $("input").value = base + t;
      App.resizeInput();
    };
    rec.onend = () => { recOn = false; btn.classList.remove("rec"); $("input").focus(); };
    rec.onerror = () => { recOn = false; btn.classList.remove("rec"); };
    btn.onclick = () => {
      if (recOn) { rec.stop(); return; }
      try { rec.start(); } catch (e) {}
    };
  }

  /* =============== EVENTS =============== */
  function injectIcons() {
    const set = (id, html) => { const e = $(id); if (e) e.innerHTML = html; };
    set("sbCollapse", Ace.ICON("sidebar", 17));
    set("sbOpen", Ace.ICON("sidebar", 17));
    set("btnNewChat", Ace.ICON("plus", 16) + "<span>New chat</span>");
    set("sbSearchIc", Ace.ICON("search", 14));
    set("btnMemory", Ace.ICON("brain", 16) + 'Memory <span class="count" id="memCount">0</span>');
    set("btnSettings", Ace.ICON("settings", 15) + "Settings");
    set("btnSettingsTop", Ace.ICON("settings", 17));
    set("btnModelChip", Ace.ICON("spark", 14) + "Smart models");
    set("btnExport", Ace.ICON("download", 17));
    set("btnPrint", Ace.ICON("print", 17));
    set("btnAttach", Ace.ICON("plus", 20));
    set("btnMic", Ace.ICON("mic", 18));
    updateModelChip();
    App.setSending(false);
  }

  function bindEvents() {
    injectIcons();
    $("btnSend").onclick = () => {
      if (Ace.Chat.sending || (Ace.Work && Ace.Work.running)) { Ace.Chat.abort && Ace.Chat.abort.abort(); return; }
      Ace.Chat.send();
    };
    const input = $("input");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); Ace.Chat.send(); }
    });
    input.addEventListener("input", App.resizeInput);

    $("btnThink").onclick = () => { App.toggles.think = !App.toggles.think; $("btnThink").classList.toggle("on", App.toggles.think); };
    $("btnDeep").onclick = () => {
      App.toggles.deep = !App.toggles.deep; $("btnDeep").classList.toggle("on", App.toggles.deep);
      if (App.toggles.deep) { App.setWeb(false); App.toggles.think = false; $("btnThink").classList.remove("on"); }
    };
    $("btnWeb").onclick = () => App.setWeb(!App.toggles.web);

    document.querySelectorAll(".mode-pill button").forEach(b =>
      b.onclick = async () => {
        if (b.dataset.mode === App.mode) return;
        App.setMode(b.dataset.mode);
        // reopen the most recent chat of the new mode (projects stay visible)
        const last = Ace.Chat.chats.filter(c => (c.mode || "chat") === b.dataset.mode)
          .sort((a, b2) => (b2.updatedAt || 0) - (a.updatedAt || 0))[0];
        if (last) await Ace.Chat.open(last.id);
        else Ace.Chat.newChat();
      });

    $("sbCollapse").onclick = () => document.body.classList.add("sb-closed");
    $("sbOpen").onclick = () => document.body.classList.remove("sb-closed");
    $("btnNewChat").onclick = () => Ace.Chat.newChat();
    $("chatSearch").addEventListener("input", Ace.Chat.renderSidebar);
    $("btnMemory").onclick = UI.openMemory;
    $("btnSettings").onclick = UI.openSettings;
    $("btnSettingsTop").onclick = UI.openSettings;
    $("btnModelChip").onclick = modelPopover;
    $("btnExport").onclick = () => Ace.Chat.exportChat();
    $("btnPrint").onclick = () => window.print();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { const m = document.querySelector(".modal-back"); if (m) m.remove(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); $("chatSearch").focus(); }
    });
    document.addEventListener("ace:memory-updated", () => updateMemCount());
    window.addEventListener("hashchange", () => {
      const h = location.hash.replace("#", "");
      if (h && Ace.Chat.chats.find(c => c.id === h)) Ace.Chat.open(h);
    });
  }

  async function updateMemCount() {
    const mems = await Ace.Memory.all().catch(() => []);
    const el = $("memCount"); if (el) el.textContent = mems.length;
    const hint = $("memHint");
    if (hint) hint.textContent = mems.length ? `${mems.length} memories active` : "";
  }

  /* =============== BOOT =============== */
  async function boot() {
    await Ace.Store.init();
    document.body.classList.toggle("is-local", Ace.Store.mode !== "cloud");
    const sync = $("syncStatus");
    if (sync) {
      sync.textContent = Ace.Store.mode === "cloud" ? "Cloud synced" : "Saved on this device";
      sync.title = Ace.Store.mode === "cloud" ? "Chats & memories sync to your Firebase" :
        "Firebase unreachable from this domain/network — data saves in this browser. Add this domain to Firebase authorized domains to enable sync.";
    }

    // key: shared (Firestore) → local mirror → none
    let key = await Ace.Store.getSharedKey();
    if (!key) { try { const v = localStorage.getItem("ace:v1:key"); if (v) key = v.trim().replace(/^["']|["']$/g, ""); } catch (e) {} }
    if (key) Ace.API.setKey(key);

    const settings = await Ace.Store.getSettings();
    applyRouteOverrides(settings);

    bindEvents();
    Ace.Images.init();
    Ace.Files && Ace.Files.init();
    initVoice();
    let savedMode = "chat";
    try { savedMode = localStorage.getItem("ace:v1:mode") === "work" ? "work" : "chat"; } catch (e) {}
    App.setMode(savedMode);
    Ace.Chat.init();
    Ace.Memory.sweep().then(updateMemCount).catch(() => {});
    updateMemCount();
    App.ready = true;

    if (!Ace.API.hasKey()) showSetup();
    else {
      $("input").focus();
      // silent preflight warm-up (static hosts only): wins the CORS
      // preflight lottery while the user types, so the first message
      // connects instantly (cached for 1h after one success)
      Ace.API.warm && Ace.API.warm();
    }
  }

  App.UI = UI;
  Ace.UI = UI; // direct alias — blocks/chat/work modules call Ace.UI.toast()
  Ace.App = App;
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
})();
