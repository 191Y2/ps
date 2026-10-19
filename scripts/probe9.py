#!/usr/bin/env python3
"""Reproduce the quiz JSON parse failure with the app's actual system prompt."""
import json, urllib.request, sys
sys.path.insert(0, "/home/z/my-project/scripts")

KEY = "84defeb435fb416e8c19ab99f5e6f71a.7727UW2uFGeraDb5"
URL = "https://api.z.ai/api/paas/v4/chat/completions"

# (abbreviated but faithful to the app's protocol section)
SYS = """You are Ace — a brilliant, warm AI study copilot.
# RICH UI PROTOCOL
Besides normal Markdown, you can emit special components by writing a fenced code block whose language is one of: quiz, flashcards, scorecard, stats, compare, steps, timeline, terms, table, progress. The content inside MUST be pure valid JSON.

## `quiz — interactive quiz (your signature move)
{"title":"Photosynthesis basics","difficulty":"medium","questions":[
 {"q":"Which gas do plants absorb?","type":"mcq","options":["O2","CO2","N2","H2"],"answer":1,"explain":"Plants take in CO2.","hint":"Think carbon."},
 {"q":"Select ALL products","type":"multi","options":["Glucose","Oxygen","CO2","ATP"],"answers":[0,1,3],"explain":"..."},
 {"q":"Mitochondria make food for the cell","type":"tf","answer":false,"explain":"Chloroplasts do."},
 {"q":"Name the pigment","type":"short","answer":"chlorophyll","accept":["chlorophyll a"]}
]}
Rules: 3-8 questions per quiz. Mix types. Always include "explain".
- CRITICAL: the fence language must be EXACTLY the block name — ```quiz. Never ```json.
- JSON must be valid (double quotes, no trailing commas, no comments)."""

def call(user):
    payload = {"model": "glm-4.5-flash", "max_tokens": 3000, "temperature": 0.6,
               "thinking": {"type": "disabled"},
               "messages": [{"role": "system", "content": SYS}, {"role": "user", "content": user}]}
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                                 headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode())["choices"][0]["message"]["content"]

for user_q in ["Quiz me on UFC", "Make me a hard quiz about photosynthesis"]:
    print("=" * 60); print("USER:", user_q)
    c = call(user_q)
    # replicate the app's MD.split + fence extraction
    import re
    fences = re.findall(r"```(\w*)\n(.*?)```", c, re.S)
    if not fences:
        print("NO FENCE FOUND. Content:"); print(c[:500]); continue
    for lang, body in fences:
        print(f"FENCE lang={lang!r} len={len(body)}")
        try:
            d = json.loads(body)
            print(f"  JSON.parse OK — {len(d.get('questions', []))} questions")
        except Exception as e:
            print(f"  JSON.parse FAILED: {e}")
            # show the offending area
            m = re.search(r"position (\d+)", str(e))
            if m:
                pos = int(m.group(1)); print("  CONTEXT:", repr(body[max(0, pos-120):pos+80]))
        # also test the app's loose parse (trailing comma fix)
        try:
            json.loads(re.sub(r",\s*([}\]])", r"\1", body))
            print("  loose parse (trailing-comma fix) OK")
        except Exception as e2:
            print(f"  loose parse FAILED too: {e2}")
