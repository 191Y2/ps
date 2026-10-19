#!/usr/bin/env python3
"""Test grounding adherence: same refs, thinking on vs off, temp 0.35.
Which config reads the references instead of pattern-matching from memory?"""
import json, urllib.request, time, subprocess

KEY = "84defeb435fb416e8c19ab99f5e6f71a.7727UW2uFGeraDb5"
URL = "https://api.z.ai/api/paas/v4/chat/completions"

# pull the REAL refs the app got from its search proxy
refs_raw = subprocess.run(
    ["curl", "-s", "http://localhost:3000/api/zai/search?q=Islam%20Makhachev%20record"],
    capture_output=True, text=True).stdout
refs = json.loads(refs_raw).get("refs", [])[:10]
print(f"got {len(refs)} refs; ref[0] contains 29-1: {'29-1' in (refs[0].get('content') or '')}")

REF_BLOCK = "\n\n".join(
    f"[{i+1}] {r['title']} ({r.get('media','')}) — {r.get('link','')}\n{(r.get('content') or '')[:900]}"
    for i, r in enumerate(refs))

def base_prompt():
    return f"""You are Ace — a brilliant, warm AI study copilot for students.

# HONESTY & FACTS (anti-hallucination — absolute rules)
Today is Mon Oct 19 2026. Your training data has a cutoff and may be months or YEARS out of date.
- For anything time-sensitive your memory may be stale. Unless live references (when provided) confirm it, say plainly that your info may be out of date.
- NEVER invent numbers, dates, statistics, quotes, URLs, or sources. A confident guess presented as fact is a FAILURE.
- If you state a factual claim you are not fully certain of, flag it inline.

# WEB REFERENCES (anti-hallucination protocol — follow strictly)
Live reference material was fetched for this question. It is included below.
Rules:
- The references below are NEWER than your training data. When they conflict with your memory, TRUST THE REFERENCES.
- Ground every factual claim in the reference material below. Cite claims inline as Markdown links.

## Reference material
{REF_BLOCK}

Reminder: anything time-sensitive you can't verify against the references → say your info may be out of date. Never invent numbers."""

QUESTION = "who is islam makhachev and whats his current record"

def run(label, thinking, temperature=0.35):
    payload = {
        "model": "glm-4.5-flash",
        "max_tokens": 800,
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": base_prompt()},
            {"role": "user", "content": QUESTION},
        ],
    }
    if thinking:
        payload["thinking"] = {"type": "enabled"}
    else:
        payload["thinking"] = {"type": "disabled"}
    t0 = time.time()
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                                 headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        j = json.loads(r.read().decode())
        msg = j["choices"][0]["message"]
        c = msg.get("content") or ""
        has_29 = "29-1" in c or "29-1-0" in c or "29 wins" in c or "29–1" in c or "29–1–0" in c
        print(f"[{label}] {time.time()-t0:.1f}s  GROUNDED(29-1)={has_29}")
        print("   ", c[:260].replace("\n", " "))
        print()
        return has_29

run("thinking OFF", False)
run("thinking ON ", True)
run("thinking ON, t=0.15", True, 0.15)
