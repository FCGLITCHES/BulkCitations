#!/usr/bin/env python
"""Turn the project's Markdown + HTML docs into clean, self-contained, shareable HTML:
 - one styled page per doc (opens standalone in any browser)
 - a MODERN index.html portal: sticky category nav (scroll-spy), search filter, doc cards
 - a combined handbook.html / PDF
Excludes the auto-generated docs/test-results/ machine logs."""
import re, html, pathlib, datetime, markdown

ROOT = pathlib.Path(".").resolve()
OUT = ROOT / "docs-export"

CAT_META = {
    "Overview": ("\U0001F4D6", "#0ea5e9"), "Project": ("\U0001F4E6", "#64748b"),
    "Engine": ("⚙️", "#4f46e5"), "ML System": ("\U0001F9E0", "#db2777"),
    "API": ("\U0001F50C", "#0891b2"), "Operations": ("\U0001F680", "#ea580c"),
    "Governance": ("\U0001F4CB", "#16a34a"), "Frontend": ("\U0001F5A5️", "#7c3aed"),
    "Shared / Architecture": ("\U0001F3DB️", "#ca8a04"),
}
ORDER = ["Overview", "Project", "Engine", "ML System", "API", "Operations", "Governance", "Frontend", "Shared / Architecture"]

# ---------- per-doc page style ----------
DOC_CSS = """
:root{--fg:#1c2024;--muted:#5b6570;--accent:#4f46e5;--border:#e6e8eb;--bg:#fff;--code-bg:#f6f8fa;}
@media (prefers-color-scheme:dark){:root{--fg:#e8edf4;--muted:#9aa6b2;--accent:#818cf8;--border:#222b39;--bg:#0d1219;--code-bg:#141b27;}}
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg);line-height:1.65;max-width:840px;margin:0 auto;padding:40px 28px 110px;background:var(--bg);font-size:16px;-webkit-font-smoothing:antialiased;}
.docnav{font-size:13px;color:var(--muted);margin-bottom:30px;border-bottom:1px solid var(--border);padding-bottom:14px;position:sticky;top:0;background:var(--bg);}
.docnav a{color:var(--accent);text-decoration:none;font-weight:600;}.docnav a:hover{text-decoration:underline;}
.docnav .cat{text-transform:uppercase;letter-spacing:.06em;font-size:11px;}
h1{font-size:2rem;line-height:1.22;margin:.1em 0 .5em;letter-spacing:-.021em;}
h2{font-size:1.42rem;margin:2.1em 0 .55em;padding-bottom:.28em;border-bottom:1px solid var(--border);letter-spacing:-.01em;}
h3{font-size:1.16rem;margin:1.7em 0 .45em;}h4{font-size:1.01rem;margin:1.4em 0 .35em;color:var(--muted);}
p,li{font-size:1rem;}a{color:var(--accent);}
code{font-family:ui-monospace,"Cascadia Code",Consolas,monospace;font-size:.87em;background:var(--code-bg);padding:.13em .4em;border-radius:5px;border:1px solid var(--border);}
pre{background:var(--code-bg);border:1px solid var(--border);border-radius:9px;padding:15px 17px;overflow:auto;font-size:.84em;line-height:1.5;}pre code{background:none;padding:0;border:0;}
table{border-collapse:collapse;width:100%;margin:1.2em 0;font-size:.9em;display:block;overflow:auto;}
th,td{border:1px solid var(--border);padding:7px 12px;text-align:left;vertical-align:top;}th{background:var(--code-bg);font-weight:600;}
blockquote{margin:1.2em 0;padding:.35em 1.15em;border-left:4px solid var(--accent);color:var(--muted);background:var(--code-bg);border-radius:0 6px 6px 0;}
hr{border:0;border-top:1px solid var(--border);margin:2.4em 0;}img{max-width:100%;}ul,ol{padding-left:1.45em;}li{margin:.18em 0;}
@media print{body{max-width:none;padding:0 12px;font-size:10.5pt;}h1,h2,h3{page-break-after:avoid;}pre,table,blockquote{page-break-inside:avoid;}a{color:#1c2024;text-decoration:none;}.docnav{display:none;}}
"""

def discover():
    out = []
    for p in sorted(ROOT.glob("docs/**/*")):
        if p.is_file() and p.suffix in (".md", ".html") and "test-results" not in p.parts:
            out.append(p)
    for name in ("README.md", "AGENTS.md"):
        if (ROOT / name).exists():
            out.append(ROOT / name)
    return out

def title_of(p, text):
    m = re.search(r"^#\s+(.+)$", text, re.M) if p.suffix == ".md" else re.search(r"<title>(.*?)</title>|<h1[^>]*>(.*?)</h1>", text, re.I | re.S)
    if m:
        t = (m.group(1) if p.suffix == ".md" else (m.group(1) or m.group(2) or "")).strip()
        return re.sub(r"<[^>]+>", "", t) or p.stem
    return p.stem.replace("-", " ").replace("_", " ").title()

def describe(text, suffix):
    s = ""
    if suffix == ".html":
        m = re.search(r"<p[^>]*>(.*?)</p>", text, re.I | re.S)
        s = re.sub(r"<[^>]+>", "", m.group(1)) if m else ""
    else:
        for line in text.splitlines():
            l = line.strip()
            if not l or l[0] in "#|>-*<" or l.startswith("```") or l.startswith("!["):
                continue
            s = l
            break
        s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
        s = re.sub(r"[*_`>]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return (s[:148].rstrip() + "…") if len(s) > 150 else s

def category_of(p):
    rel = p.relative_to(ROOT)
    if rel.parts[0] != "docs":
        return "Project"
    if len(rel.parts) <= 2:
        return "Overview"
    seg = rel.parts[1]
    return {"engine": "Engine", "ml-system": "ML System", "api": "API", "operations": "Operations",
            "governance": "Governance", "frontend": "Frontend", "shared": "Shared / Architecture"}.get(seg, seg.title())

def doc_page(title, body, nav):
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{html.escape(title)} — BulkReferences Docs</title><style>{DOC_CSS}</style></head>'
            f'<body>{nav}{body}</body></html>')

def md_body(text):
    md = markdown.Markdown(extensions=["extra", "tables", "fenced_code", "codehilite", "toc", "sane_lists", "admonition"],
                           extension_configs={"codehilite": {"guess_lang": False, "noclasses": True}})
    return md.convert(text)

OUT.mkdir(exist_ok=True)
entries = []
for p in discover():
    rel = p.relative_to(ROOT)
    text = p.read_text(encoding="utf-8", errors="replace")
    title, cat, desc = title_of(p, text), category_of(p), describe(text, p.suffix)
    out_rel = rel.with_suffix(".html") if rel.parts[0] == "docs" else pathlib.Path("project") / rel.with_suffix(".html").name
    out_path = OUT / out_rel
    out_path.parent.mkdir(parents=True, exist_ok=True)
    up = "../" * (len(out_rel.parts) - 1)
    nav = (f'<div class="docnav"><a href="{up}index.html">← All docs</a> &nbsp;/&nbsp; '
           f'<span class="cat">{html.escape(cat)}</span> &nbsp;/&nbsp; {html.escape(title)}</div>')
    if p.suffix == ".html":
        m = re.search(r"<body[^>]*>(.*)</body>", text, re.I | re.S)
        body = m.group(1) if m else text
    else:
        body = md_body(text)
    body = re.sub(r'(href=")([^":]+?)\.md(["#])', r'\1\2.html\3', body)
    out_path.write_text(doc_page(title, body, nav), encoding="utf-8")
    entries.append({"cat": cat, "title": title, "out": str(out_rel).replace("\\", "/"),
                    "src": str(rel).replace("\\", "/"), "desc": desc})

by_cat = {}
for e in entries:
    by_cat.setdefault(e["cat"], []).append(e)
cats = [c for c in ORDER if c in by_cat] + [c for c in by_cat if c not in ORDER]

def cid(c):
    return "cat-" + re.sub(r"[^a-z0-9]+", "-", c.lower()).strip("-")

# ---------- MODERN index portal ----------
INDEX_CSS = """
:root{--bg:#f6f7f9;--panel:#ffffff;--fg:#0f172a;--muted:#64748b;--faint:#94a3b8;--border:#e7e9ee;
 --accent:#4f46e5;--accent-soft:#eef2ff;--ring:rgba(79,70,229,.35);--shadow:0 1px 2px rgba(15,23,42,.05),0 8px 24px rgba(15,23,42,.06);}
@media (prefers-color-scheme:dark){:root{--bg:#080b11;--panel:#0f141d;--fg:#e8edf4;--muted:#9aa6b4;--faint:#5b6776;
 --border:#1c2532;--accent:#818cf8;--accent-soft:#1b1f3a;--ring:rgba(129,140,248,.4);--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.4);}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--fg);-webkit-font-smoothing:antialiased;}
.layout{display:grid;grid-template-columns:272px minmax(0,1fr);max-width:1240px;margin:0 auto;gap:0;}
.sidebar{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;padding:26px 16px 40px;border-right:1px solid var(--border);}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:1.02rem;letter-spacing:-.01em;padding:0 8px 4px;}
.brand .dot{width:11px;height:11px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#22d3ee);box-shadow:0 0 0 4px var(--accent-soft);}
.brand small{display:block;font-weight:500;color:var(--faint);font-size:.72rem;letter-spacing:.02em;}
.search{margin:16px 6px;position:relative;}
.search input{width:100%;padding:9px 12px 9px 32px;border:1px solid var(--border);border-radius:10px;background:var(--panel);color:var(--fg);font-size:.86rem;outline:none;}
.search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--ring);}
.search svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--faint);}
.nav{display:flex;flex-direction:column;gap:1px;margin-top:6px;}
.nav a{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;color:var(--muted);text-decoration:none;font-size:.875rem;font-weight:500;transition:background .12s,color .12s;}
.nav a:hover{background:var(--accent-soft);color:var(--fg);}
.nav a.active{background:var(--accent-soft);color:var(--accent);font-weight:650;}
.nav a .ico{font-size:1rem;line-height:1;}
.nav a .count{margin-left:auto;font-size:.72rem;color:var(--faint);background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:1px 8px;}
.main{padding:42px 40px 120px;min-width:0;}
.hero{margin-bottom:14px;}
.hero h1{font-size:2.25rem;line-height:1.1;letter-spacing:-.03em;margin:0 0 10px;}
.hero p{font-size:1.06rem;color:var(--muted);max-width:62ch;margin:0 0 18px;line-height:1.55;}
.stats{display:flex;gap:10px;flex-wrap:wrap;}
.stat{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:10px 16px;box-shadow:var(--shadow);}
.stat b{display:block;font-size:1.35rem;letter-spacing:-.02em;}.stat span{font-size:.76rem;color:var(--faint);text-transform:uppercase;letter-spacing:.05em;}
.section{padding-top:34px;scroll-margin-top:18px;}
.section-h{display:flex;align-items:center;gap:10px;margin:0 0 14px;}
.section-h .badge{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;font-size:1.05rem;}
.section-h h2{font-size:1.28rem;margin:0;letter-spacing:-.01em;}
.section-h .n{color:var(--faint);font-size:.85rem;font-weight:500;}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:13px;}
.card{display:block;background:var(--panel);border:1px solid var(--border);border-radius:13px;padding:15px 16px;text-decoration:none;color:inherit;
 box-shadow:var(--shadow);transition:transform .12s,border-color .12s,box-shadow .12s;border-left:3px solid var(--cardc,var(--accent));}
.card:hover{transform:translateY(-2px);border-color:var(--cardc,var(--accent));box-shadow:0 6px 14px rgba(15,23,42,.1),0 18px 40px rgba(15,23,42,.08);}
.card .t{font-weight:680;font-size:.97rem;letter-spacing:-.01em;margin-bottom:5px;line-height:1.3;}
.card .d{font-size:.84rem;color:var(--muted);line-height:1.5;margin-bottom:9px;}
.card .p{font-size:.72rem;color:var(--faint);font-family:ui-monospace,Consolas,monospace;word-break:break-all;}
.empty{display:none;color:var(--faint);font-size:.9rem;padding:8px 0;}
.foot{margin-top:60px;padding-top:20px;border-top:1px solid var(--border);color:var(--faint);font-size:.8rem;}
.section.hide,.card.hide{display:none;}
.hero-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:4px;}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:#fff;font-weight:650;font-size:.9rem;padding:11px 19px;border-radius:11px;text-decoration:none;box-shadow:var(--shadow);transition:filter .12s,transform .12s;}
.btn:hover{filter:brightness(1.08);transform:translateY(-1px);}.btn svg{width:16px;height:16px;}
.statusbox{margin:20px 0 4px;padding:13px 18px;border:1px solid var(--border);border-left:3px solid #16a34a;border-radius:12px;background:var(--panel);box-shadow:var(--shadow);font-size:.875rem;line-height:1.62;color:var(--muted);}
.statusbox b{color:var(--fg);}.statusbox a{color:var(--accent);font-weight:600;text-decoration:none;}
.statusbox .lbl{font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:#16a34a;font-weight:800;display:block;margin-bottom:5px;}
@media (max-width:880px){.layout{grid-template-columns:1fr;}.sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid var(--border);}
 .nav{flex-direction:row;flex-wrap:wrap;}.nav a .count{display:none;}.main{padding:28px 22px 90px;}.hero h1{font-size:1.8rem;}}
"""

INDEX_JS = """
const q=document.getElementById('q'),cards=[...document.querySelectorAll('.card')],sections=[...document.querySelectorAll('.section')],links=[...document.querySelectorAll('.nav a')];
q.addEventListener('input',()=>{const v=q.value.trim().toLowerCase();
 cards.forEach(c=>c.classList.toggle('hide',v&&!c.dataset.s.includes(v)));
 sections.forEach(s=>{const vis=[...s.querySelectorAll('.card')].some(c=>!c.classList.contains('hide'));s.classList.toggle('hide',!vis);
  const link=document.querySelector('.nav a[href="#'+s.id+'"]');if(link)link.style.display=vis?'':'none';});});
const byId={};links.forEach(l=>byId[l.getAttribute('href').slice(1)]=l);
const obs=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){links.forEach(l=>l.classList.remove('active'));const a=byId[e.target.id];if(a)a.classList.add('active');}});},{rootMargin:'-15% 0px -75% 0px'});
sections.forEach(s=>obs.observe(s));
"""

def icon_badge(cat):
    ico, col = CAT_META.get(cat, ("\U0001F4C4", "#64748b"))
    return ico, col

nav_html = []
sec_html = []
for c in cats:
    ico, col = icon_badge(c)
    items = sorted(by_cat[c], key=lambda e: e["title"].lower())
    nav_html.append(f'<a href="#{cid(c)}"><span class="ico">{ico}</span>{html.escape(c)}<span class="count">{len(items)}</span></a>')
    cards = []
    for e in items:
        s = html.escape((e["title"] + " " + e["desc"] + " " + e["src"]).lower(), quote=True)
        d = f'<div class="d">{html.escape(e["desc"])}</div>' if e["desc"] else ''
        cards.append(f'<a class="card" style="--cardc:{col}" href="{html.escape(e["out"])}" data-s="{s}">'
                     f'<div class="t">{html.escape(e["title"])}</div>{d}<div class="p">{html.escape(e["src"])}</div></a>')
    sec_html.append(f'<section class="section" id="{cid(c)}"><div class="section-h">'
                    f'<span class="badge" style="background:{col}1f;color:{col}">{ico}</span>'
                    f'<h2>{html.escape(c)}</h2><span class="n">{len(items)} doc{"s" if len(items)!=1 else ""}</span></div>'
                    f'<div class="cards">{"".join(cards)}</div></section>')

today = datetime.date.today().isoformat()
index = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BulkReferences — Documentation</title><style>{INDEX_CSS}</style></head><body>
<div class="layout">
<aside class="sidebar">
  <div class="brand"><span class="dot"></span><div>BulkReferences<small>Documentation</small></div></div>
  <div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
   <input id="q" type="search" placeholder="Search {len(entries)} docs…" autocomplete="off"></div>
  <nav class="nav">{"".join(nav_html)}</nav>
</aside>
<main class="main">
  <div class="hero">
   <h1>Documentation</h1>
   <p>The BulkReferences citation-conversion engine &mdash; engine pipeline, ML/BIO system, enrichment, data governance, API, and operations. A clean, self-contained snapshot you can open anywhere.</p>
   <div class="hero-actions">
     <a class="btn" href="BulkReferences-Documentation.pdf" download><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 21h14"/></svg>Download PDF handbook</a>
     <div class="stat"><b>{len(entries)}</b><span>Documents</span></div>
     <div class="stat"><b>{len(cats)}</b><span>Sections</span></div>
   </div>
   <div class="statusbox"><span class="lbl">Current status &middot; updated {today}</span>
     <b>Enrichment</b> enabled (flagged, +cache+budget) &middot; dead <b>BullMQ removed</b> &middot; <b>4&times;&rarr;1&times;</b> input normalization &middot; <b>AMA / ACS / Chicago-notes</b> render natively (no APA fallback) &middot; <b>pages, ISBN, author-parsing</b> fixed &middot; health now flags <b>confident-wrong</b> fields &middot; <b>DeterministicResolver</b> DOI migration started &middot; <b>AdminTraining</b> decomposition underway.
     Individual technical docs below are point-in-time references &mdash; the <a href="docs/engine/system-assessment.html">System&nbsp;Assessment</a> is the live, up-to-date status.
   </div>
  </div>
  {"".join(sec_html)}
  <div class="foot">Generated {today} &middot; auto-generated test/security logs excluded &middot; each page is self-contained and opens in any browser.</div>
</main></div>
<script>{INDEX_JS}</script></body></html>"""
(OUT / "index.html").write_text(index, encoding="utf-8")

# ---------- combined handbook ----------
toc = ['<div style="background:var(--code-bg);border:1px solid var(--border);border-radius:9px;padding:8px 22px;margin:1.4em 0"><strong>Contents</strong><ul>']
secs = [f'<h1 style="font-size:2.4rem">BulkReferences — Documentation Handbook</h1><p style="color:#5b6570">{len(entries)} documents — generated {today}.</p>']
n = 0
for c in cats:
    toc.append(f'<li style="list-style:none;margin-top:.5em"><strong>{html.escape(c)}</strong><ul>')
    for e in sorted(by_cat[c], key=lambda x: x["title"].lower()):
        n += 1
        toc.append(f'<li><a href="#d{n}">{html.escape(e["title"])}</a></li>')
        full = (OUT / e["out"]).read_text(encoding="utf-8")
        bm = re.search(r"<body[^>]*>(.*)</body>", full, re.I | re.S)
        inner = re.sub(r'<div class="docnav".*?</div>', "", bm.group(1), flags=re.S) if bm else ""
        secs.append(f'<section id="d{n}" style="page-break-before:always"><div style="color:#9aa3ad;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em">{html.escape(c)}</div>{inner}</section>')
    toc.append("</ul></li>")
toc.append("</ul></div>")
(OUT / "handbook.html").write_text(doc_page("Handbook", "".join(secs[:1]) + "".join(toc) + "".join(secs[1:]), ""), encoding="utf-8")

print(f"Built {len(entries)} docs + modern index + handbook -> {OUT}")
print("sections:", {c: len(by_cat[c]) for c in cats})
