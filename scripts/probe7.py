#!/usr/bin/env python3
"""Deep probe: thinking matrix + web_search ground truth + latency."""
import json, time, urllib.request, urllib.error, sys

KEY = "84defeb435fb416e8c19ab99f5e6f71a.7727UW2uFGeraDb5"
URL = "https://api.z.ai/api/paas/v4/chat/completions"

def call(payload, label, timeout=120):
    t0 = time.time()
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                                 headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            dt = time.time() - t0
            j = json.loads(raw)
            msg = j["choices"][0]["message"]
            content = (msg.get("content") or "")[:180].replace("\n", " ")
            reasoning = (msg.get("reasoning_content") or "")
            ws = j.get("web_search") or msg.get("web_search") or ""
            print(f"[OK {dt:.1f}s] {label}: {content}")
            if reasoning: print(f"          reasoning: {len(reasoning)} chars (first 80): {reasoning[:80]}")
            if ws: print(f"          web_search field: {str(ws)[:200]}")
            keys = [k for k in j.keys()]
            print(f"          top-level keys: {keys}, msg keys: {list(msg.keys())}")
    except urllib.error.HTTPError as e:
        dt = time.time() - t0
        print(f"[HTTP {e.code} {dt:.1f}s] {label}: {e.read().decode()[:300]}")
    except Exception as ex:
        print(f"[ERR] {label}: {ex}")

print("=" * 70)
print("TEST 1: thinking parameter matrix")
print("=" * 70)
for model in ["glm-4.5-flash", "glm-4.6v-flash", "glm-5.3", "glm-4.6", "glm-4.7"]:
    for think in [{"type": "disabled"}, {"type": "enabled"}]:
        call({"model": model, "max_tokens": 60, "thinking": think,
              "messages": [{"role": "user", "content": "Reply with exactly: OK"}]},
             f"{model} thinking={think['type']}", timeout=60)

print()
print("=" * 70)
print("TEST 2: web_search ground truth (BTC price ~Oct 2026)")
print("=" * 70)
q = "What is Bitcoin's price in USD right now? Answer with just the number."
call({"model": "glm-4.5-flash", "max_tokens": 300, "thinking": {"type": "disabled"},
      "messages": [{"role": "user", "content": q}],
      "tools": [{"type": "web_search", "web_search": {"enable": True, "search_result": True, "count": 5}}]},
     "web_search enable=True (bool)", timeout=90)
call({"model": "glm-4.5-flash", "max_tokens": 300,
      "messages": [{"role": "user", "content": q}],
      "tools": [{"type": "web_search", "web_search": {"enable": True, "search_result": True, "count": 5}}]},
     "web_search enable=True (bool, no thinking field)", timeout=90)
