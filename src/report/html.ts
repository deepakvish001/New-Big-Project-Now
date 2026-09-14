import type { CatalogueScore, Severity } from '../types.ts';

export interface HtmlOptions {
  limitations?: string[];
  topN?: number;
  /** Shown in the closing call to action. */
  contact?: string;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: 'Blocker',
  major: 'Major',
  minor: 'Minor',
};

/**
 * A standalone report with no external requests, so it survives being emailed
 * to a prospect as an attachment.
 */
export function renderHtml(result: CatalogueScore, options: HtmlOptions = {}): string {
  const topN = options.topN ?? 10;
  const store = result.storeName ?? result.source;
  const scoredAt = new Date(result.scoredAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const impacts = result.topImpacts.slice(0, topN);
  const worst = result.worstProducts.slice(0, topN);
  const limitations = options.limitations ?? [];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent-readiness report — ${esc(store)}</title>
<style>
  :root{
    --paper:#F3F0F2;--surface:#FCFAFB;--sunk:#E8E1E5;--ink:#1D131A;--muted:#695C64;
    --faint:#9B8B94;--rule:#DCD3D8;--accent:#A81F63;--wash:#F7DDEA;
    --warn:#8E5B0B;--ok:#2C6849;--risk:#A3302A;
  }
  @media (prefers-color-scheme:dark){
    :root{
      --paper:#130E12;--surface:#1E171C;--sunk:#181216;--ink:#F3ECF0;--muted:#AA98A2;
      --faint:#7D6C75;--rule:#2F262C;--accent:#F27CB1;--wash:#3A1929;
      --warn:#DBA557;--ok:#6FC296;--risk:#E08B72;
    }
  }
  *{box-sizing:border-box}
  body{
    margin:0;background:var(--paper);color:var(--ink);
    font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:880px;margin:0 auto;padding:44px 20px 80px}
  h1{font-size:clamp(1.6rem,4vw,2.2rem);line-height:1.1;margin:0 0 .3rem;letter-spacing:-.02em}
  h2{font-size:1.1rem;margin:0 0 .9rem;letter-spacing:-.01em}
  p{margin:0 0 1rem;max-width:66ch}
  .sub{color:var(--muted);font-size:.92rem;margin:0}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}

  .hero{
    display:flex;flex-wrap:wrap;gap:24px;align-items:center;
    background:var(--surface);border:1px solid var(--rule);border-radius:6px;
    padding:26px;margin:28px 0;
  }
  .dial{flex:0 0 auto;text-align:center;min-width:130px}
  .dial .n{font-size:3.4rem;line-height:1;font-weight:700;letter-spacing:-.03em}
  .dial .d{color:var(--faint);font-size:.8rem;letter-spacing:.1em;text-transform:uppercase;margin-top:.35rem}
  .grade{
    display:inline-block;margin-top:.6rem;padding:.2rem .6rem;border-radius:3px;
    font-weight:700;font-size:.85rem;letter-spacing:.06em;
  }
  .hero .say{flex:1 1 300px;min-width:260px}
  .hero .say strong{font-size:1.15rem}

  .g-A,.g-B{background:var(--ok);color:#fff}
  .g-C,.g-D{background:var(--warn);color:#fff}
  .g-F{background:var(--risk);color:#fff}

  .track{height:9px;background:var(--sunk);border-radius:5px;overflow:hidden;min-width:90px}
  .fill{height:100%;border-radius:5px;background:var(--accent)}
  .fill.lo{background:var(--risk)}
  .fill.mid{background:var(--warn)}
  .fill.hi{background:var(--ok)}

  section{margin-top:40px}
  table{border-collapse:collapse;width:100%;font-size:.93rem}
  .scroll{overflow-x:auto;border:1px solid var(--rule);border-radius:6px;background:var(--surface)}
  th{
    text-align:left;font-size:.68rem;letter-spacing:.11em;text-transform:uppercase;
    color:var(--faint);font-weight:600;padding:11px 14px;border-bottom:1px solid var(--rule);
    white-space:nowrap;
  }
  td{padding:12px 14px;border-bottom:1px solid var(--rule);color:var(--muted);vertical-align:top}
  tr:last-child td{border-bottom:none}
  td.lead{color:var(--ink);font-weight:600}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .fix{display:block;margin-top:.3rem;font-size:.86rem;color:var(--muted)}
  .pill{
    display:inline-block;padding:.12rem .42rem;border-radius:3px;font-size:.66rem;
    font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;
  }
  .p-blocker{background:var(--risk);color:#fff}
  .p-major{background:var(--warn);color:#fff}
  .p-minor{background:var(--sunk);color:var(--muted)}

  .groups{display:grid;gap:10px}
  .grow{display:grid;grid-template-columns:minmax(96px,150px) 52px 1fr;gap:12px;align-items:center}
  .grow .k{font-weight:600;font-size:.9rem;text-transform:capitalize}
  .grow .v{font-variant-numeric:tabular-nums;color:var(--muted);font-size:.88rem;text-align:right}

  .note{background:var(--sunk);border-radius:6px;padding:16px 18px;font-size:.9rem;color:var(--muted)}
  .note ul{margin:.5rem 0 0;padding-left:1.1rem}
  .note li{margin-bottom:.3rem}

  .cta{
    margin-top:44px;border:1px solid var(--accent);background:var(--wash);
    border-radius:6px;padding:22px 24px;
  }
  .cta h2{color:var(--accent);margin-bottom:.5rem}
  .cta p{color:var(--ink);margin-bottom:0}
  footer{margin-top:36px;padding-top:16px;border-top:1px solid var(--rule);
    font-size:.8rem;color:var(--faint)}
  @media (max-width:520px){
    .grow{grid-template-columns:1fr 52px;grid-template-areas:"k v" "t t"}
    .grow .k{grid-area:k}.grow .v{grid-area:v}.grow .track{grid-area:t}
  }
</style>
</head>
<body>
<div class="wrap">

  <h1>Agent-readiness report</h1>
  <p class="sub">${esc(store)} · ${result.productCount.toLocaleString('en-IN')} products · ${esc(scoredAt)}</p>

  <div class="hero">
    <div class="dial">
      <div class="n mono">${result.score.toFixed(0)}</div>
      <div class="d">out of 100</div>
      <span class="grade g-${result.grade}">Grade ${result.grade}</span>
    </div>
    <div class="say">
      <p><strong>${result.invisibleShare}% of your catalogue is effectively invisible to AI shopping agents.</strong></p>
      <p style="margin-bottom:0">${result.invisibleCount.toLocaleString('en-IN')} of ${result.productCount.toLocaleString('en-IN')} products score below 50, which means an agent cannot reliably match them to a shopper's question, no matter how well they are written for people.</p>
    </div>
  </div>

  <section>
    <h2>Where the score is lost</h2>
    <div class="groups">
      ${result.groups.map((g) => `
      <div class="grow">
        <span class="k">${esc(g.group)}</span>
        <span class="v mono">${g.score.toFixed(0)}</span>
        <span class="track"><span class="fill ${band(g.score)}" style="width:${clamp(g.score)}%"></span></span>
      </div>`).join('')}
    </div>
  </section>

  ${impacts.length === 0 ? '' : `
  <section>
    <h2>Fix these first</h2>
    <p class="sub" style="margin-bottom:14px">Ranked by how many points of the headline score each one is costing across the whole catalogue.</p>
    <div class="scroll">
      <table>
        <thead><tr><th>Issue</th><th class="num">Products<br>affected</th><th class="num">Points<br>lost</th></tr></thead>
        <tbody>
          ${impacts.map((i) => `
          <tr>
            <td class="lead">${esc(i.title)} <span class="pill p-${i.severity}">${SEVERITY_LABEL[i.severity]}</span>
              <span class="fix">${esc(i.fix)}</span></td>
            <td class="num">${i.affected.toLocaleString('en-IN')}</td>
            <td class="num lead">-${i.catalogueCost.toFixed(1)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </section>`}

  ${worst.length === 0 ? '' : `
  <section>
    <h2>Worst-performing products</h2>
    <div class="scroll">
      <table>
        <thead><tr><th class="num">Score</th><th>Product</th><th>Biggest problem</th></tr></thead>
        <tbody>
          ${worst.map((p) => {
            const top = p.findings[0];
            const detail = top?.detail ? ` — ${top.detail}` : '';
            return `
          <tr>
            <td class="num lead">${p.score.toFixed(0)}</td>
            <td class="lead">${p.url ? `<a href="${esc(p.url)}" style="color:inherit">${esc(p.title)}</a>` : esc(p.title)}</td>
            <td>${top ? esc(top.title + detail) : 'No findings'}</td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </section>`}

  ${limitations.length === 0 ? '' : `
  <section>
    <h2>What this scan could not see</h2>
    <div class="note">
      <ul>${limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    </div>
  </section>`}

  <div class="cta">
    <h2>What happens next</h2>
    <p>Every issue above is fixable without changing a single product photo or price. The work is generating the structured attributes your catalogue is missing, then keeping price and stock truthful across every surface an agent reads.${options.contact ? ` ${esc(options.contact)}` : ''}</p>
  </div>

  <footer>
    Scored against the attribute requirements of the Agentic Commerce Protocol (ACP) and the Universal
    Commerce Protocol (UCP). Scores are a readiness indicator, not a guarantee of placement in any
    specific AI surface.
  </footer>

</div>
</body>
</html>`;
}

function band(score: number): string {
  return score >= 70 ? 'hi' : score >= 40 ? 'mid' : 'lo';
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
