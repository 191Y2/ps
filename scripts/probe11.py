#!/usr/bin/env python3
"""Round-4 probes: hallucination fixes + long-stream stability.
Q1: Does Z.ai's native web_search tool actually fire on free models now?
Q2: Does thinking mode work on glm-4.5-flash, and does it reduce hallucination?
Q3: How stable are long builder-style streams (the 'Can't reach api.z.ai' bug)?
"""
import json, urllib.request, time, sys

KEY = "84defeb435fb416e8c19ab99f5e6f71a.7727UW2uFGeraDb5"
URL = "https://api.z.ai/api/paas/v4/chat/completions"

def call(payload, label, timeout=300, stream=False):
    t0 = time.time()
    payload = dict(payload)
    if stream:
        payload["stream"] = True
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                                 headers={"Authorization": "Bearer " + KEY,
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if not stream:
                j = json.loads(r.read().decode())
                msg = (j.get("choices") or [{}])[0].get("message", {})
                u = j.get("usage", {})
                print(f"[OK {time.time()-t0:.1f}s] {label}: content={len(msg.get('content') or '')}c "
                      f"reasoning={len(msg.get('reasoning_content') or '')}c ctok={u.get('completion_tokens')} "
                      f"web_search={'web_search' in json.dumps(msg)}")
                return msg
            # stream: parse SSE, watch for drops
            body = r.read().decode("utf-8", "replace")
            chunks, content, reasoning = 0, "", ""
            for line in body.split("\n"):
                line = line.strip()
                if not line.startswith("data:"): continue
                d = line[5:].strip()
                if d == "[DONE]": continue
                try: j = json.loads(d)
                except Exception: continue
                ch = (j.get("choices") or [{}])[0]
                delta = ch.get("delta") or {}
                content += delta.get("content") or ""
                reasoning += delta.get("reasoning_content") or ""
                chunks += 1
            print(f"[OK {time.time()-t0:.1f}s] {label}: chunks={chunks} content={len(content)}c "
                  f"reasoning={len(reasoning)}c has</html>={'</html>' in content}")
            return {"content": content, "reasoning": reasoning}
    except urllib.error.HTTPError as e:
        print(f"[HTTP {e.code} {time.time()-t0:.1f}s] {label}: {e.read().decode()[:300]}")
    except Exception as ex:
        print(f"[ERR {time.time()-t0:.1f}s] {label}: {type(ex).__name__}: {ex}")
    return {}

Q = "What is Islam Makhachev's current professional MMA record (wins-losses), and who did he most recently fight?"

# --- Q1: native web_search tool, current formats, free models ---
print("=" * 70)
print("Q1: native web_search tool on free models")
for model in ["glm-4.5-flash", "glm-4.6-flash"]:
    for tools in [
        [{"type": "web_search", "web_search": {"enable": True, "search_result": True}}],
        [{"type": "web_search"}],
    ]:
        m = call({"model": model, "max_tokens": 400, "tools": tools,
                  "messages": [{"role": "user", "content": Q}]},
                 f"{model} tools={json.dumps(tools)[:60]}", timeout=90)
        if m:
            c = (m.get("content") or "")
            ws = json.dumps(m.get("web_search") or m.get("search_result") or "")[:150]
            print(f"    answer head: {c[:220].replace(chr(10),' ')}")
            print(f"    tool results: {ws}")

# --- Q2: thinking on/off hallucination comparison ---
print("=" * 70)
print("Q2: thinking mode on glm-4.5-flash (hallucination comparison)")
for think in [{"type": "enabled"}, {"type": "disabled"}, None]:
    p = {"model": "glm-4.5-flash", "max_tokens": 1200, "temperature": 0.6,
         "messages": [{"role": "user", "content": Q}]}
    if think: p["thinking"] = think
    m = call(p, f"thinking={think}", timeout=120)
    if m:
        print(f"    answer: {(m.get('content') or '')[:300].replace(chr(10),' ')}")

# --- Q2b: what models exist right now ---
print("=" * 70)
print("Q2b: models list")
try:
    req = urllib.request.Request("https://api.z.ai/api/paas/v4/models",
                                 headers={"Authorization": "Bearer " + KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.loads(r.read().decode())
        ids = [m.get("id") for m in j.get("data", [])]
        print("models:", ids)
except Exception as ex:
    print("models list failed:", ex)

# --- Q3: long builder-style STREAM stability (this is the reported crash) ---
print("=" * 70)
print("Q3: long streaming build (clicker game, like the user's failing request)")
m = call({"model": "glm-4.5-flash", "max_tokens": 16000, "temperature": 0.55,
          "thinking": {"type": "disabled"},
          "messages": [{"role": "user", "content":
              "Build a polished single-file HTML clicker game called 'Neon Clicker': click button +1 score, upgrades shop (auto-clicker, multiplier), neon dark style, localStorage save. Output the ENTIRE file inside one ```html fence. No text outside the fence."}]},
         "STREAM clicker build", timeout=300, stream=True)
