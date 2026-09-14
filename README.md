# Market Research

Three researched product theses, one shared engine. Pick one, validate it,
then build.

**Status:** research complete, pre-build. Each thesis carries its own
validation gate and kill criteria. No product code should be written until a
gate is passed.

## Three theses

| Doc | Market | Sells because | First revenue | Sales motion |
| --- | --- | --- | --- | --- |
| [`docs/AGENT-COMMERCE-THESIS.md`](docs/AGENT-COMMERCE-THESIS.md) | Merchant catalogues, global | Revenue upside | 1–2 weeks | Self-serve |
| [`docs/INDIA-THESIS.md`](docs/INDIA-THESIS.md) | Labour contractors, India | Liability | 3–4 weeks | Field visits |
| [`docs/PRODUCT-THESIS.md`](docs/PRODUCT-THESIS.md) | Vendor insurance, US | Liability | 6–10 weeks | Outbound + audit |

- **Catalogue** — AI shopping agents can't see most merchants' products because
  the data is written for humans. Score, fix, truth-check and attribute at
  catalogue scale. Lowest revenue per account, but nobody has to sell it.
- **Labour** — Indian principal employers carry vicarious liability for their
  contractors' PF, ESI and wage defaults. Collect, verify and gate payment.
  Highest revenue per account; needs field sales.
- **Insurance** — US contractors and property managers chase subcontractor
  Certificates of Insurance by hand. Highest ceiling; slowest to start.

All three run the **same engine** — ingest, read, check against rules, fix or
chase, monitor continuously. Only the document type and the rule library
differ. The choice is about the sales motion you can sustain, not the idea.

The side-by-side decision table is at the end of
[`AGENT-COMMERCE-THESIS.md`](docs/AGENT-COMMERCE-THESIS.md).

## One-paragraph summary

Contractors and property managers hold folders of subcontractor insurance
certificates that expire constantly. When one lapses and something goes wrong
on site, the GC's own insurance absorbs a claim it never priced. Today a
compliance coordinator chases this by hand. Existing software stores the PDFs
and sends reminders; none of it does the chasing, the reading, or the
judging. That end-to-end loop is what this product automates, and it is newly
buildable. The gap in the market is priced at $60–150 per vendor per year,
between $30/yr storage tools and $450–900/yr enterprise platforms.

---

## The tool: `catalog-score`

The first thing from the catalogue thesis, built. It scores a product catalogue
for how readable it is to an AI shopping agent, and produces the free report
that is meant to be the acquisition engine.

```bash
npm install
npm test

# a Shopify product export
npm run dev -- ./products_export.csv --currency INR --out report.html

# any storefront's public product feed — no credentials, no install
npm run dev -- example.com --out report.html

# machine-readable
npm run dev -- ./fixtures/sample-products.json --json
```

Output is a 0–100 score with a grade, a per-group breakdown, the issues ranked
by how many points of the headline score each is costing across the whole
catalogue, and the worst-performing products.

### How it scores

Fifteen weighted rules in five groups, 120 points in total:

| Group | Points | What it checks |
| --- | --- | --- |
| `identity` | 30 | GTIN with a valid check digit, brand, SKU/MPN, mapped taxonomy |
| `descriptive` | 30 | Title self-sufficiency, factual description, structured attribute count |
| `commerce` | 30 | Price, currency, explicit availability, tracked stock, record freshness |
| `media` | 10 | Image count, alt text |
| `answerability` | 20 | Whether the data answers the dimensions shoppers actually ask about |

`answerability` is the differentiated check and the heaviest single rule. For
each category it picks the dimensions queries turn on — material, size, care,
use case, compatibility, capacity — and looks for evidence. **A structured
attribute earns full credit; the same fact buried in description prose earns
half**, because that is roughly how much use an agent gets from each.

### Honesty rules baked in

- **A field that cannot be read is never reported as missing.** A store's public
  `/products.json` does not expose barcodes, stock or currency, so those rules
  are *dropped*, not failed, and the report says which checks were skipped and
  why. The same applies to the CSV path, which carries no timestamp.
- **A malformed GTIN scores zero, not partial credit,** and is called out
  separately — a barcode that fails its check digit is worse than an empty one,
  because the merchant believes they are covered.

### Layout

```
src/
  types.ts              canonical catalogue model
  score.ts              single-pass scoring engine and roll-up
  rules/index.ts        the rule library — the actual asset
  rules/context.ts      category buckets and query-dimension evidence
  adapters/             Shopify products.json, Shopify CSV, CSV reader
  report/               terminal and standalone HTML renderers
  cli.ts                argument parsing and wiring
```

### Status

39 tests pass; typecheck is clean. The live public-feed path is covered by unit
tests with an injected `fetch` (paging, short-page termination, error
messaging), but **the real network hop has not been exercised** — this
development environment's policy blocks outbound requests to arbitrary hosts.
Run `npm run dev -- <a real store domain>` on an unrestricted machine before
relying on it.

Not built yet, by design: attribute generation, cross-surface price and stock
reconciliation, and agent-citation attribution. Those are jobs 2–4 in the
thesis; this is job 1.
