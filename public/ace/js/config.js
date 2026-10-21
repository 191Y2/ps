/* ============================================================
   Ace — AI Study Copilot · config.js
   Static GitHub Pages app. No build step. No server.
   ============================================================ */
"use strict";
window.Ace = window.Ace || {};

/* ---------- Firebase (client config is public by design; data is
   protected by Firestore rules + anonymous auth) ---------- */
Ace.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBWlEp11jAHPTT4-O2UlwXsyD7mjTapV_M",
  authDomain: "chat-84076.firebaseapp.com",
  projectId: "chat-84076",
  storageBucket: "chat-84076.firebasestorage.app",
  messagingSenderId: "483867839151",
  appId: "1:483867839151:web:25ee4937c3e1b4498e625a",
  measurementId: "G-T4KXKQLREG"
};

/* ---------- Z.ai / Zhipu GLM API ----------
   BROWSER-DIRECT ENDPOINTS (used on GitHub Pages / any static host):
   Zhipu's bigmodel.cn family. Same GLM models, same key format.
   Endpoint selection was verified by direct probing (Oct 2026):
   • api.z.ai — preflight NEVER returns CORS headers → unusable
     browser-direct (0/15 probes). Server-side only (the preview proxy).
   • open.bigmodel.cn — dual-stack (A + AAAA): its IPv4 path answers
     the preflight ~30-50% of the time, its IPv6 path NEVER does.
     Browsers pick a transport per origin and stick to it — on IPv6
     every call dies as "Failed to fetch".
   • bigmodel.cn — IPv4-ONLY + preflight passes 100% (16/16 probes),
     same backend, same key → PRIMARY for static hosting.
   The API client rotates the list below (last-good first) and retries
   aggressively; a won preflight is cached by the browser for 1h. */
Ace.API_BASE = "https://bigmodel.cn/api/paas/v4";
Ace.API_PATH_CHAT = "/chat/completions";
Ace.API_ENDPOINTS = [
  "https://bigmodel.cn/api/paas/v4",         // IPv4-only gateway — preflight 100%
  "https://bigmodel.cn/api/coding/paas/v4",  // coding gateway — same key + models, preflight 100%
  "https://open.bigmodel.cn/api/paas/v4",    // dual-stack fallback (IPv4 dice roll)
  "https://open.bigmodel.cn/api/coding/paas/v4"
];

/* Model registry — verified 2026-10 against the live API.
   free: works on a free Z.ai key (no balance needed).
   alwaysThinks: model rejects thinking:{type:"disabled"} (error 1210) —
   the API client handles this automatically by dropping the param.
   Default routing is FREE-FIRST: instant responses, no balance needed.
   Premium models stay available in Settings for keys with balance. */
Ace.MODELS = [
  { id: "glm-4.5-flash",  label: "GLM-4.5 Flash",  tag: "Free · Fast · Smart",  free: true,  vision: false },
  { id: "glm-4.6v-flash", label: "GLM-4.6V Flash", tag: "Free · Vision",        free: true,  vision: true  },
  { id: "glm-5.3",        label: "GLM-5.3",        tag: "Flagship · needs balance", free: false, vision: false, alwaysThinks: true },
  { id: "glm-5.3-flash",  label: "GLM-5.3 Flash",  tag: "Multimodal coding · needs balance", free: false, vision: true, alwaysThinks: true },
  { id: "glm-5.2",        label: "GLM-5.2",        tag: "needs balance", free: false, vision: false, alwaysThinks: true },
  { id: "glm-4.7",        label: "GLM-4.7",        tag: "needs balance", free: false, vision: false },
  { id: "glm-4.6",        label: "GLM-4.6",        tag: "needs balance", free: false, vision: false },
  { id: "glm-4.5",        label: "GLM-4.5",        tag: "needs balance", free: false, vision: false },
  { id: "glm-4.5-air",    label: "GLM-4.5 Air",    tag: "needs balance", free: false, vision: false }
];
Ace.modelById = (id) => Ace.MODELS.find(m => m.id === id);

/* Routing defaults — free-first so everything works out of the box.
   "Think" uses the same free model with reasoning ENABLED (no balance
   needed, no paid-model round-trip) instead of swapping models. */
Ace.ROUTE = {
  chat:  "glm-4.5-flash",   // everyday chat (free, thinking off = fast)
  think: "glm-4.5-flash",   // "Think" toggle → same model, reasoning ON
  web:   "glm-4.5-flash",   // web-grounded answers (free)
  vision:"glm-4.6v-flash",  // images (free vision)
  work:  "glm-4.5-flash",   // agentic builder (free, builds complete HTML apps)
  deep:  "glm-4.5-flash",   // deep research synthesis (free)
  memory:"glm-4.5-flash",   // background memory extraction (free)
  title: "glm-4.5-flash"    // chat titles (free)
};

/* Fallback chains: if a premium model is picked in Settings and the key
   lacks balance (1113) or the model is unknown (1211) / rejects thinking
   controls (1210), we walk down to the free models. */
Ace.FALLBACKS = {
  text:   ["glm-4.5-flash"],
  vision: ["glm-4.6v-flash"],
  work:   ["glm-4.5-flash"]
};
Ace.chainFor = (preferred, kind) => {
  const fb = Ace.FALLBACKS[kind || "text"] || [];
  return (preferred && !fb.includes(preferred)) ? [preferred].concat(fb) : fb.slice();
};

/* ---------- UI block types the renderer understands ---------- */
Ace.BLOCK_TYPES = ["quiz", "flashcards", "scorecard", "stats", "compare", "steps",
                   "timeline", "terms", "table", "progress"];

/* ---------- Misc ---------- */
Ace.VERSION = "1.1.7";
Ace.APP_NAME = "Ace";
Ace.MAX_IMAGES = 4;          // per message
Ace.IMG_MAX_DIM = 1024;      // client-side downscale
Ace.HISTORY_LIMIT = 24;      // messages sent as context
Ace.SUMMARIZE_AFTER = 14;    // messages before rolling summary
Ace.MEMORY_TOP_K = 8;        // memories injected per turn
Ace.IMG_MAX_DIM_INLINE = 160;

Ace.ICON = (name, size) => {
  const s = size || 18;
  const P = {
    paperclip: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
    send: "M12 19V5M5 12l7-7 7 7",
    globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
    mic: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8",
    plus: "M12 5v14M5 12h14",
    search: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35",
    sidebar: "M3 3h18v18H3zM9 3v18",
    settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
    brain: "M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4 2.5 2.5 0 0 1 9.5 2zM14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44A2.5 2.5 0 0 0 20 17.5v-11A2.5 2.5 0 0 0 17.5 4 2.5 2.5 0 0 0 14.5 2z",
    close: "M18 6L6 18M6 6l12 12",
    copy: "M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
    check: "M20 6L9 17l-5-5",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
    external: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3",
    refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
    trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z",
    pin: "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
    edit: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z",
    chev: "M9 18l6-6-6-6",
    chevDown: "M6 9l6 6 6-6",
    stop: "M6 6h12v12H6z",
    play: "M5 3l16 9-16 9z",
    code: "M16 18l6-6-6-6M8 6l-6 6 6 6",
    bulb: "M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z",
    expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
    spark: "M12 2l1.9 5.7L20 9.6l-5 3.8 1.9 6.1L12 15.6l-4.9 3.9L9 13.4 4 9.6l6.1-1.9z",
    user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
    bot: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
    cloud: "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z",
    warn: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
    img: "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21",
    print: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
    arrowUp: "M12 19V5M5 12l7-7 7 7",
    thumbUp: "M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3",
    thumbDown: "M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3",
    eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z",
    eyeOff: "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22",
    clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
    file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
    zip: "M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6l2 3h6a2 2 0 0 1 2 2zM12 8h.01M12 11h.01M12 14h.01M12 17h.01"
  };
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.spark}"/></svg>`;
};

/* Tiny DOM helpers used everywhere. */
Ace.el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
Ace.esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
Ace.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
Ace.fmtTime = (ts) => {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};
