#!/usr/bin/env python3
"""Render a run's report.json as a static HTML scorecard.

Static rather than client-rendered on purpose: the page must be complete in its
first still frame, which is what a shared link and a thumbnail both get.

    python3 scorecard.py <results-dir> <out.html>
"""
import html
import json
import sys
from pathlib import Path

FAMILIES = {
    "A": ("Pinpoint provenance", "What code built this shape?",
          "target recall over search &rarr; fetch"),
    "B": ("Taste synthesis", "What taste runs through all the decks?",
          "reference-term coverage of the corpus answer"),
    "C": ("Style coverage", "Which style elements are actually used?",
          "set recall, plus false-claim count"),
    "D": ("Abstention", "Does it admit when it knows nothing?",
          "1.0 = correctly reported nothing known"),
    "E": ("Recency / supersession", "Is the answer the current one?",
          "current value present AND superseded absent"),
    "F": ("Correction adherence", "Are corrections retrievable later?",
          "target recall over search &rarr; fetch"),
}

FINDINGS = [
    ("Retrieval works. Capture is the weak link.",
     "With the deck facts present in memory, provenance questions score 100% and style coverage 88%: "
     "search finds the right memory and ranks it first. But seeding the same 27 decks through the real "
     "capture path produced only 2 observations and 4 session summaries from 10 slide-build events - the "
     "observer compresses mechanical build work down to deck-level prose and discards the per-shape "
     "coordinates. So the gap between these two numbers is not a search problem to tune; it is work that "
     "memory never recorded."),
    ("It never says &ldquo;I don't know.&rdquo;",
     "All four unanswerable questions returned 12 confident-looking hits. Top-k search cannot itself signal "
     "an empty result, so a question about a slide that does not exist looks exactly like a question about "
     "one that does. Anything built on this needs its own abstention step - the retrieval layer will not "
     "provide one."),
    ("Superseded decisions come back alongside current ones.",
     "Asked for the current accent colour, memory returned the current value together with both retired "
     "ones, with nothing marking which is live. For deck work this is the failure that does active damage: "
     "a template changed twice still answers with its first version."),
]


def esc(s):
    return html.escape(str(s), quote=True)


def band(score):
    if score >= 0.8:
        return "pass"
    if score >= 0.4:
        return "partial"
    return "fail"


def render(report):
    m = report["metadata"]
    by_family = report["byFamily"]
    results = report["results"]
    chroma = m.get("chromaLive")

    rows = []
    for key, (name, question, method) in FAMILIES.items():
        stats = by_family.get(key)
        if not stats:
            continue
        pct = round(stats["mean"] * 100)
        rows.append(f"""
      <li class="fam fam--{band(stats['mean'])}">
        <div class="fam__id">{esc(key)}</div>
        <div class="fam__body">
          <h3>{name}</h3>
          <p class="fam__q">{question}</p>
          <p class="fam__method">{method}</p>
        </div>
        <div class="fam__score">
          <span class="fam__pct">{pct}<span class="fam__unit">%</span></span>
          <span class="fam__n">n={stats['n']}</span>
        </div>
        <div class="fam__meter" role="img" aria-label="{pct} percent">
          <div class="fam__fill" style="width:{pct}%"></div>
        </div>
      </li>""")

    sections = []
    for key, (name, _q, _method) in FAMILIES.items():
        rs = [r for r in results if r["family"] == key]
        if not rs:
            continue
        trs = []
        for r in rs:
            pct = round(r["score"] * 100)
            extra = ""
            if r.get("falseClaims"):
                extra = ('<span class="flag">fabricated: '
                         + esc(", ".join(r["falseClaims"])) + "</span>")
            trs.append(f"""
          <tr>
            <td class="q">{esc(r['question'])}</td>
            <td class="mono route">{esc(r['route'])}</td>
            <td class="mono num">{r['retrieved']}</td>
            <td class="mono num score score--{band(r['score'])}">{pct}%</td>
            <td class="detail">{esc(r['detail'])}{extra}</td>
          </tr>""")
        sections.append(f"""
    <section class="qs">
      <h3><span class="tag">{esc(key)}</span> {name}</h3>
      <div class="tablewrap">
        <table>
          <thead><tr><th>Question</th><th>Route</th><th>Hits</th><th>Score</th><th>Detail</th></tr></thead>
          <tbody>{''.join(trs)}</tbody>
        </table>
      </div>
    </section>""")

    findings = "".join(
        f"""
      <li><h3>{t}</h3><p>{b}</p></li>""" for t, b in FINDINGS)

    chroma_cls = "ok" if chroma else "bad"
    chroma_txt = ("Semantic search (Chroma) was <strong>live</strong> for this run."
                  if chroma else
                  "Semantic search (Chroma) was <strong>down</strong> &mdash; every score below means something different.")

    return f"""<title>Slides Memory Scorecard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
  :root {{
    --ground:#F5F7F8; --surface:#FFFFFF; --surface-2:#EDF1F3;
    --ink:#11171C; --ink-2:#3D4852; --muted:#5A6672; --rule:#D8E0E5;
    --accent:#3F6B8E;
    --pass:#2E7D5B; --partial:#B87514; --fail:#A8404E;
    --display:'Archivo',system-ui,sans-serif;
    --body:'Source Serif 4',Georgia,serif;
    --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
  }}
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme="light"]) {{
      --ground:#0E1418; --surface:#161D23; --surface-2:#1D262D;
      --ink:#E7EDF1; --ink-2:#B6C2CB; --muted:#8A97A2; --rule:#2A353D;
      --accent:#7AA8CC; --pass:#4FA97D; --partial:#D9963A; --fail:#D2707C;
    }}
  }}
  :root[data-theme="dark"] {{
    --ground:#0E1418; --surface:#161D23; --surface-2:#1D262D;
    --ink:#E7EDF1; --ink-2:#B6C2CB; --muted:#8A97A2; --rule:#2A353D;
    --accent:#7AA8CC; --pass:#4FA97D; --partial:#D9963A; --fail:#D2707C;
  }}

  body {{ background:var(--ground); color:var(--ink); font-family:var(--body);
    line-height:1.6; -webkit-font-smoothing:antialiased; }}
  .wrap {{ max-width:64rem; margin:0 auto; padding-inline:20px; padding-block:48px 72px; }}
  h1,h2,h3,.mono,.tag,th {{ font-family:var(--display); }}
  .mono,.num,.score {{ font-family:var(--mono); font-variant-numeric:tabular-nums; }}

  header.head {{ border-bottom:2px solid var(--ink); padding-bottom:20px; margin-bottom:28px; }}
  .eyebrow {{ font-family:var(--display); font-size:.72rem; letter-spacing:.14em;
    text-transform:uppercase; color:var(--accent); font-weight:600; margin:0 0 10px; }}
  h1 {{ font-size:clamp(1.9rem,5vw,2.9rem); font-weight:700; letter-spacing:-.02em;
    line-height:1.08; margin:0 0 12px; text-wrap:balance; }}
  .lede {{ font-size:1.06rem; color:var(--ink-2); max-width:62ch; margin:0; }}

  .meta {{ display:flex; flex-wrap:wrap; gap:8px 28px; margin-top:20px;
    font-family:var(--mono); font-size:.78rem; color:var(--muted); }}
  .meta b {{ color:var(--ink-2); font-weight:500; }}

  .banner {{ display:flex; gap:10px; align-items:flex-start; margin:22px 0 0;
    padding:12px 16px; border-radius:3px; font-size:.92rem; }}
  .banner.ok {{ background:color-mix(in srgb,var(--pass) 12%,transparent);
    border-left:3px solid var(--pass); }}
  .banner.bad {{ background:color-mix(in srgb,var(--fail) 12%,transparent);
    border-left:3px solid var(--fail); }}

  .caveat {{ margin:32px 0; padding:20px 22px; background:var(--surface);
    border:1px solid var(--rule); border-left:3px solid var(--accent); border-radius:3px; }}
  .caveat h2 {{ font-size:1rem; margin:0 0 8px; letter-spacing:-.01em; }}
  .caveat p {{ margin:0; color:var(--ink-2); font-size:.96rem; }}

  h2.sec {{ font-size:.76rem; letter-spacing:.14em; text-transform:uppercase;
    color:var(--muted); font-weight:600; margin:44px 0 16px;
    padding-bottom:8px; border-bottom:1px solid var(--rule); }}

  ul.fams {{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }}
  .fam {{ display:grid; grid-template-columns:auto 1fr auto; gap:4px 18px;
    align-items:center; padding:16px 18px; background:var(--surface);
    border:1px solid var(--rule); border-left:3px solid var(--muted); }}
  .fam--pass {{ border-left-color:var(--pass); }}
  .fam--partial {{ border-left-color:var(--partial); }}
  .fam--fail {{ border-left-color:var(--fail); }}
  .fam__id {{ font-family:var(--mono); font-size:1.1rem; font-weight:600;
    color:var(--muted); width:1.4em; }}
  .fam__body h3 {{ margin:0; font-size:1.02rem; letter-spacing:-.01em; }}
  .fam__q {{ margin:2px 0 0; font-size:.92rem; color:var(--ink-2); }}
  .fam__method {{ margin:3px 0 0; font-family:var(--mono); font-size:.72rem; color:var(--muted); }}
  .fam__score {{ text-align:right; display:flex; flex-direction:column; align-items:flex-end; }}
  .fam__pct {{ font-family:var(--mono); font-size:1.65rem; font-weight:600; line-height:1; }}
  .fam__unit {{ font-size:.9rem; color:var(--muted); }}
  .fam__n {{ font-family:var(--mono); font-size:.7rem; color:var(--muted); margin-top:3px; }}
  .fam__meter {{ grid-column:1/-1; height:3px; background:var(--surface-2); margin-top:12px; }}
  .fam__fill {{ height:100%; background:var(--accent); }}
  .fam--pass .fam__fill {{ background:var(--pass); }}
  .fam--partial .fam__fill {{ background:var(--partial); }}
  .fam--fail .fam__fill {{ background:var(--fail); }}

  ol.findings {{ list-style:none; counter-reset:f; margin:0; padding:0;
    display:flex; flex-direction:column; gap:22px; }}
  ol.findings li {{ counter-increment:f; padding-left:44px; position:relative; }}
  ol.findings li::before {{ content:counter(f,decimal-leading-zero);
    position:absolute; left:0; top:1px; font-family:var(--mono); font-size:.85rem;
    font-weight:600; color:var(--accent); }}
  ol.findings h3 {{ margin:0 0 6px; font-size:1.06rem; letter-spacing:-.01em; text-wrap:balance; }}
  ol.findings p {{ margin:0; color:var(--ink-2); max-width:70ch; }}

  .qs {{ margin-bottom:30px; }}
  .qs h3 {{ font-size:.98rem; margin:0 0 10px; display:flex; align-items:center; gap:9px; }}
  .tag {{ display:inline-flex; align-items:center; justify-content:center;
    width:1.5rem; height:1.5rem; background:var(--surface-2); color:var(--accent);
    font-family:var(--mono); font-size:.78rem; font-weight:600; border-radius:2px; }}
  .tablewrap {{ overflow-x:auto; border:1px solid var(--rule); background:var(--surface); }}
  table {{ border-collapse:collapse; width:100%; min-width:42rem; font-size:.86rem; }}
  th {{ text-align:left; font-size:.68rem; letter-spacing:.1em; text-transform:uppercase;
    color:var(--muted); font-weight:600; padding:9px 12px; border-bottom:1px solid var(--rule); }}
  td {{ padding:9px 12px; border-bottom:1px solid var(--rule); vertical-align:top; }}
  tr:last-child td {{ border-bottom:none; }}
  td.q {{ color:var(--ink); min-width:19rem; }}
  td.route, td.num {{ color:var(--muted); font-size:.8rem; }}
  td.num {{ text-align:right; }}
  td.score {{ font-weight:600; }}
  .score--pass {{ color:var(--pass); }}
  .score--partial {{ color:var(--partial); }}
  .score--fail {{ color:var(--fail); }}
  td.detail {{ color:var(--ink-2); font-size:.82rem; min-width:14rem; }}
  .flag {{ display:block; margin-top:3px; font-family:var(--mono); font-size:.72rem; color:var(--fail); }}

  footer {{ margin-top:52px; padding-top:18px; border-top:1px solid var(--rule);
    font-size:.84rem; color:var(--muted); }}
  footer p {{ margin:0 0 8px; max-width:72ch; }}
  code {{ font-family:var(--mono); font-size:.85em; background:var(--surface-2);
    padding:1px 5px; border-radius:2px; }}

  @media (max-width:560px) {{
    .fam {{ grid-template-columns:auto 1fr; }}
    .fam__score {{ grid-column:2; align-items:flex-start; text-align:left; margin-top:8px; }}
  }}
</style>

<div class="wrap">
  <header class="head">
    <p class="eyebrow">claude-mem &times; OfficeCLI &middot; run {esc(m['timestamp'][:16].replace('T', ' '))}</p>
    <h1>Slides Memory Scorecard</h1>
    <p class="lede">Six question families, scored six different ways, against {m['decksTraced']} reference
      decks. A single blended number would average a retrieval failure together with a synthesis
      failure and hide both.</p>
    <div class="meta">
      <span><b>{m['decksTraced']}</b> decks traced</span>
      <span><b>{m['commandsTraced']:,}</b> officecli commands</span>
      <span><b>{len(results)}</b> questions</span>
      <span>project <b>{esc(m['project'])}</b></span>
      <span>corpus route <b>{'yes' if m.get('corpusUsed') else 'no'}</b></span>
    </div>
    <div class="banner {chroma_cls}"><span>{chroma_txt}</span></div>
  </header>

  <div class="caveat">
    <h2>Read family A as a ceiling, not a grade</h2>
    <p>This run seeded memory directly, so the deck facts were present by construction. Family A's 100%
      therefore measures <em>retrieval only</em> &mdash; proof that search finds and ranks the right memory,
      not proof that a real session would have recorded it. The organic-capture run is the other half of
      that picture, and it is the one that disappoints.</p>
  </div>

  <h2 class="sec">Scores by family</h2>
  <ul class="fams">{''.join(rows)}</ul>

  <h2 class="sec">What the run actually shows</h2>
  <ol class="findings">{findings}</ol>

  <h2 class="sec">Every question</h2>
  {''.join(sections)}

  <footer>
    <p><strong>Scoring caveat.</strong> {esc(m.get('scoringNote', ''))}</p>
    <p>Family D measures the retrieval surface, not the agent: top-k search always returns results, so it
      can never itself report that nothing relevant is known.</p>
    <p>Ground truth comes from running each deck's <code>build.sh</code> with a fake <code>officecli</code>
      that records argv, so the shell performs its own variable expansion. Searches pass an explicit
      <code>dateRange</code>, because Chroma otherwise drops anything older than 90 days silently.</p>
  </footer>
</div>
"""


def main():
    results_dir = Path(sys.argv[1])
    out = Path(sys.argv[2])
    report = json.loads((results_dir / "report.json").read_text())
    out.write_text(render(report))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
