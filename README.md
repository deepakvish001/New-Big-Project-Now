# The Certificate Gap

Product research and thesis for an **autonomous vendor-insurance compliance
agent** — software that collects, reads, verifies and chases Certificates of
Insurance on behalf of US general contractors, property managers and
facilities firms.

**Status:** research complete, pre-build. The validation gate in
[`docs/PRODUCT-THESIS.md`](docs/PRODUCT-THESIS.md) has not yet been passed —
no product code should be written until it is.

## Start here

- [`docs/INDIA-THESIS.md`](docs/INDIA-THESIS.md) — **India market, ship first.**
  Contractor compliance verification for principal employers: the labour-code
  window, the liability chain, per-contractor pricing, the services-led revenue
  ramp, and a four-week v0.
- [`docs/PRODUCT-THESIS.md`](docs/PRODUCT-THESIS.md) — **US market, higher ARPU.**
  Vendor-insurance (COI) compliance: the buyer, the wedge, the price-ladder gap,
  MVP scope, go-to-market, validation gate, risks and kill criteria, plus the
  runner-up ideas that were considered and rejected.

Both documents describe the **same engine** — collect, read, verify against
rules, chase until resolved, gate the payment, re-run every cycle. Only the
document type and the rule library differ. India is the cash-flow market and
can be reached this month; the US is the ARPU market, at roughly 15–20× revenue
per account.

## One-paragraph summary

Contractors and property managers hold folders of subcontractor insurance
certificates that expire constantly. When one lapses and something goes wrong
on site, the GC's own insurance absorbs a claim it never priced. Today a
compliance coordinator chases this by hand. Existing software stores the PDFs
and sends reminders; none of it does the chasing, the reading, or the
judging. That end-to-end loop is what this product automates, and it is newly
buildable. The gap in the market is priced at $60–150 per vendor per year,
between $30/yr storage tools and $450–900/yr enterprise platforms.
