// Unit tests for the Ace api.js network-resilience layer.
// Simulates: (1) initial-connect failures that should retry, (2) mid-stream
// drops that must return partial content with interrupted:true, (3) total
// failures, (4) abort during backoff, (5) abort mid-stream (user Stop).
// Run: node test_resilience.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../download/ace/js/api.js");

// hard timeout so a hang fails loudly instead of hanging CI
const killer = setTimeout(() => { console.error("TEST TIMEOUT — something hung"); process.exit(2); }, 30000);

// browser-ish globals the module expects
globalThis.window = { Ace: {} };
globalThis.Ace = globalThis.window.Ace;
globalThis.document = { dispatchEvent: () => {}, addEventListener: () => {} };
Ace.API_BASE = "https://api.z.ai/api/paas/v4";
Ace.API_PATH_CHAT = "/chat/completions";

new Function(fs.readFileSync(SRC, "utf8"))();
const API = Ace.API;
API.setKey("test-key");

const enc = new TextEncoder();
const chunk = (txt) => enc.encode("data: " + JSON.stringify({ choices: [{ delta: { content: txt } }] }) + "\n\n");
const concat = (parts) => {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const sse = (...events) => concat([...events.map(chunk), enc.encode("data: [DONE]\n\n")]);
const okRes = (body) => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  console.log((cond ? "PASS " : "FAIL ") + name + (extra ? "  -> " + extra : ""));
  cond ? pass++ : fail++;
};
// bypass proxy auto-detect (it would hit our stubbed fetch)
const noProxy = () => { API.proxy = false; };

// ---------- Test 1: initial connect fails twice, third attempt succeeds ----------
{
  noProxy();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls < 3) throw new TypeError("Failed to fetch");
    return okRes(sse("hello ", "world"));
  };
  const r = await API.stream({ model: "m", messages: [{ role: "user", content: "hi" }] });
  check("connect-retry: succeeds on 3rd attempt", r.content === "hello world" && calls === 3, `calls=${calls} content="${r.content}"`);
  check("connect-retry: not marked interrupted", r.interrupted === false);
}

// ---------- Test 2: mid-stream drop keeps partial content ----------
{
  noProxy();
  let pull = 0;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(ctrl) {
      // one chunk per pull; error only on a LATER pull (error() discards
      // queued chunks per spec — same as a real socket dying after delivery)
      if (pull === 0) ctrl.enqueue(chunk("<!DOCTYPE html><html><he"));
      else if (pull === 1) ctrl.enqueue(chunk("ad><title>x"));
      else ctrl.error(new TypeError("net::ERR_CONNECTION_RESET"));
      pull++;
    }
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  const deltas = [];
  const r = await API.stream({
    model: "m", messages: [{ role: "user", content: "hi" }],
    onDelta: (c) => deltas.push(c)
  }).catch(e => ({ content: "", interrupted: false, __threw: e }));
  check("mid-drop: returns partial content, no throw",
    r.interrupted === true && /DOCTYPE/.test(r.content) && /title/.test(r.content) && !r.__threw,
    `interrupted=${r.interrupted} len=${(r.content || "").length}${r.__threw ? " THREW: " + r.__threw.message : ""}`);
}

// ---------- Test 3: drop with ZERO content → network error ----------
{
  noProxy();
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(ctrl) { ctrl.error(new TypeError("Failed to fetch")); }
  }), { status: 200 });
  let threw = null;
  try { await API.stream({ model: "m", messages: [{ role: "user", content: "hi" }] }); }
  catch (e) { threw = e; }
  check("zero-content drop: throws network error", threw && threw.kind === "network", threw && threw.message);
}

// ---------- Test 4: total connection failure after 3 attempts ----------
{
  noProxy();
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError("Failed to fetch"); };
  let threw = null;
  try { await API.stream({ model: "m", messages: [{ role: "user", content: "hi" }] }); }
  catch (e) { threw = e; }
  check("total failure: throws network error after 3 attempts",
    threw && threw.kind === "network" && calls === 3, `calls=${calls}`);
}

// ---------- Test 5: abort during backoff sleep rejects immediately ----------
{
  noProxy();
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError("Failed to fetch"); };
  const ctl = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ctl.abort(), 100);
  let threw = null;
  try { await API.stream({ model: "m", messages: [{ role: "user", content: "hi" }], signal: ctl.signal }); }
  catch (e) { threw = e; }
  check("abort during backoff: prompt AbortError", threw && threw.name === "AbortError" && Date.now() - t0 < 1500,
    `${threw && threw.name} after ${Date.now() - t0}ms`);
}

// ---------- Test 6: friendlyError wording ----------
{
  const e = new Error("x"); e.kind = "network";
  const msg = API.friendlyError(e);
  check("friendlyError: network message mentions drop + Retry",
    /dropped/i.test(msg) && /[Rr]etry/i.test(msg));
}

// ---------- Test 7: abort mid-stream throws AbortError (user pressed Stop) ----------
// Emulates browser semantics: aborting the fetch signal errors the body
// reader with an AbortError.
{
  noProxy();
  const ctl = new AbortController();
  globalThis.fetch = async (u, opts) => {
    let rc = null;
    const stream = new ReadableStream({
      start(c) { rc = c; c.enqueue(chunk("abc")); /* then stall */ }
    });
    opts.signal.addEventListener("abort", () => {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      try { rc.error(err); } catch (e) { /* already closed */ }
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  setTimeout(() => ctl.abort(), 120);
  let threw = null;
  try {
    await API.stream({ model: "m", messages: [{ role: "user", content: "hi" }], signal: ctl.signal });
  } catch (e) { threw = e; }
  check("mid-stream abort: AbortError (Stop button works)", threw && threw.name === "AbortError", threw && threw.name);
}

// ---------- Test 8: 429 → polite retry succeeds ----------
{
  noProxy();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response("{\"error\":{\"code\":\"1302\"}}", { status: 429 });
    return okRes(sse("after 429"));
  };
  const t0 = Date.now();
  const r = await API.stream({ model: "m", messages: [{ role: "user", content: "hi" }] });
  check("429 retry: succeeds after backoff", r.content === "after 429" && calls === 2 && Date.now() - t0 >= 2100,
    `calls=${calls} elapsed=${Date.now() - t0}ms`);
}

clearTimeout(killer);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
