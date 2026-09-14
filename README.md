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
