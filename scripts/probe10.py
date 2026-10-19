#!/usr/bin/env python3
"""Test glm-4.5-flash max_tokens limits + a real builder-style call."""
import json, urllib.request, time

KEY = "84defeb435fb416e8c19ab99f5e6f71a.7727UW2uFGeraDb5"
URL = "https://api.z.ai/api/paas/v4/chat/completions"

def call(payload, label, timeout=240):
    t0 = time.time()
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                                 headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            j = json.loads(r.read().decode())
            msg = j["choices"][0]["message"]
            u = j.get("usage", {})
            print(f"[OK {time.time()-t0:.1f}s] {label}: content={len(msg.get('content') or '')}c "
                  f"reasoning={len(msg.get('reasoning_content') or '')}c completion_tokens={u.get('completion_tokens')} "
                  f"finish={j['choices'][0].get('finish_reason')}")
            return msg.get("content") or ""
    except urllib.error.HTTPError as e:
        print(f"[HTTP {e.code} {time.time()-t0:.1f}s] {label}: {e.read().decode()[:220]}")
    except Exception as ex:
        print(f"[ERR {time.time()-t0:.1f}s] {label}: {ex}")
    return ""

# max_tokens acceptance matrix
for mt in [4096, 8192, 12288, 16384, 26000]:
    call({"model": "glm-4.5-flash", "max_tokens": mt, "thinking": {"type": "disabled"},
          "messages": [{"role": "user", "content": "Reply: OK"}]}, f"max_tokens={mt}", timeout=60)

# realistic builder call (small game, one-shot)
print()
t0 = time.time()
c = call({"model": "glm-4.5-flash", "max_tokens": 16000, "temperature": 0.55,
          "thinking": {"type": "disabled"},
          "messages": [{"role": "user", "content": "Build a polished single-file HTML canvas game: 'Dodge the falling blocks'. Arrow keys + touch, score, game over + restart, 60fps delta-time, dark neon style. Output the ENTIRE file inside one ```html fence. No text outside the fence."}]},
         "builder dodge game", timeout=300)
print(f"got {len(c)} chars; has DOCTYPE: {'<!DOCTYPE' in c or '<!doctype' in c}; has </html>: {'</html>' in c}")
