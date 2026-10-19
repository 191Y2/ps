#!/usr/bin/env python3
"""Quick: which models work on this key right now + temperature acceptance."""
import json, urllib.request, time
KEY = "84defeb435fb416e8c19ab99f5e6f71a.7727UW2uFGeraDb5"
URL = "https://api.z.ai/api/paas/v4/chat/completions"

def call(payload, label, timeout=90):
    t0 = time.time()
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                                 headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            j = json.loads(r.read().decode())
            msg = (j.get("choices") or [{}])[0].get("message", {})
            c = msg.get("content") or ""
            print(f"[OK {time.time()-t0:.1f}s] {label}: {len(c)}c reasoning={len(msg.get('reasoning_content') or '')}c")
            return True
    except urllib.error.HTTPError as e:
        print(f"[HTTP {e.code}] {label}: {e.read().decode()[:120]}")
    except Exception as ex:
        print(f"[ERR] {label}: {ex}")
    return False

for m in ["glm-4.5-flash", "glm-4.6v-flash", "glm-5.3-flash", "glm-5.3-flashx", "glm-5.1", "glm-4.6", "glm-4.7"]:
    call({"model": m, "max_tokens": 30, "thinking": {"type": "disabled"},
          "messages": [{"role": "user", "content": "Reply: OK"}]}, m, timeout=45)

# temperature acceptance on the free chat model
for t in [0.1, 0.35, 0.6]:
    call({"model": "glm-4.5-flash", "max_tokens": 20, "temperature": t, "thinking": {"type": "disabled"},
          "messages": [{"role": "user", "content": "Reply: OK"}]}, f"temp={t}", timeout=45)
