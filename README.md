# The Certificate Gap

Product research and thesis for an **autonomous vendor-insurance compliance
agent** — software that collects, reads, verifies and chases Certificates of
Insurance on behalf of US general contractors, property managers and
facilities firms.

**Status:** research complete, pre-build. The validation gate in
[`docs/PRODUCT-THESIS.md`](docs/PRODUCT-THESIS.md) has not yet been passed —
no product code should be written until it is.

## Start here

- [`docs/PRODUCT-THESIS.md`](docs/PRODUCT-THESIS.md) — the full thesis: the
  buyer, the wedge, the market gap, pricing, MVP scope, go-to-market,
  validation gate, risks and kill criteria, plus the runner-up ideas that were
  considered and rejected.

## One-paragraph summary

Contractors and property managers hold folders of subcontractor insurance
certificates that expire constantly. When one lapses and something goes wrong
on site, the GC's own insurance absorbs a claim it never priced. Today a
compliance coordinator chases this by hand. Existing software stores the PDFs
and sends reminders; none of it does the chasing, the reading, or the
judging. That end-to-end loop is what this product automates, and it is newly
buildable. The gap in the market is priced at $60–150 per vendor per year,
between $30/yr storage tools and $450–900/yr enterprise platforms.
