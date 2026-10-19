#!/usr/bin/env python3
"""Test the browser-direct search pipeline with real queries + CORS checks."""
import json, urllib.request, urllib.parse, re

def get(url, origin="https://user.github.io"):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
        "Origin": origin})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")

def test(label, fn):
    try:
        r = fn()
        print(f"[OK] {label}: {str(r)[:220]}")
    except Exception as e:
        print(f"[FAIL] {label}: {e}")
    print()

q = "Islam Makhachev record"

# 1. DDG Instant Answer
def ddg():
    j = json.loads(get("https://api.duckduckgo.com/?q=" + urllib.parse.quote(q) + "&format=json&no_html=1&skip_disambig=1"))
    out = []
    if j.get("AbstractText"): out.append("ABSTRACT: " + j["AbstractText"][:200])
    if j.get("Answer"): out.append("ANSWER: " + str(j["Answer"])[:100])
    out.append("related: " + "; ".join(t.get("Text", "")[:60] for t in (j.get("RelatedTopics") or [])[:3]))
    return " | ".join(out)
test("DDG IA '" + q + "'", ddg)

# 2. Wikipedia search
def wiki():
    j = json.loads(get("https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" + urllib.parse.quote(q) + "&srlimit=4&format=json&origin=*"))
    return [h["title"] for h in j["query"]["search"]]
test("Wikipedia search", wiki)

# 3. Wikipedia extracts (intro paragraphs of top articles)
def wiki_extracts():
    titles = wiki()
    j = json.loads(get("https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=" +
                       urllib.parse.quote("|".join(titles)) + "&format=json&origin=*"))
    pages = j["query"]["pages"]
    out = []
    for p in list(pages.values())[:3]:
        out.append(p.get("title", "?") + " => " + (p.get("extract", "")[:160]).replace("\n", " "))
    return out
test("Wikipedia extracts", wiki_extracts)

# 4. searx instances with format=json
for inst in ["https://searx.be", "https://search.brave... skip", "https://priv.au", "https://searx.tiekoetter.com"]:
    if "skip" in inst: continue
    def sx(inst=inst):
        r = get(inst + "/search?q=" + urllib.parse.quote(q) + "&format=json")
        j = json.loads(r)
        return [res.get("title", "")[:50] for res in (j.get("results") or [])[:4]]
    test(f"searx {inst}", sx)

# 5. Reddit search json
def reddit():
    j = json.loads(get("https://www.reddit.com/search.json?q=" + urllib.parse.quote(q) + "&limit=3"))
    return [c["data"]["title"][:60] for c in j["data"]["children"]]
test("reddit search.json", reddit)

# 6. Wikipedia "morelike" (related articles) - skip; 7. Wikidata
def wikidata():
    j = json.loads(get("https://www.wikidata.org/w/api.php?action=wbsearchentities&search=" + urllib.parse.quote("Islam Makhachev") + "&language=en&limit=2&format=json&origin=*"))
    return [x["label"] + ": " + (x.get("description") or "") for x in j["search"]]
test("wikidata", wikidata)
