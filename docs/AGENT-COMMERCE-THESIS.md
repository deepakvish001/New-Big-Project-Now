# Third Thesis — Agent-Readiness for Product Catalogs

**Date:** 14 September 2026
**Companion to:** [`PRODUCT-THESIS.md`](PRODUCT-THESIS.md) (US, insurance) ·
[`INDIA-THESIS.md`](INDIA-THESIS.md) (India, labour)
**Status:** Research complete, pre-validation.

---

## 1. Why this one is a different shape

The first two theses are the same species: **cost-of-risk products**. The buyer
pays to avoid a fine, a claim, or a liability. Those sell, but they are slow —
field sales, a compliance buyer, a long "what if nothing goes wrong" objection.

This one is the opposite: a **revenue-upside product**. The merchant pays
because it makes them money, and the result is measurable in their own order
data within weeks. Different buyer, different sales motion, different
distribution, and crucially — different speed.

| | Thesis 1 & 2 | This thesis |
| --- | --- | --- |
| Buyer motivation | Avoid loss | Capture revenue |
| Sales motion | Field / consultative | Self-serve + app store |
| Time to first rupee | Weeks (audit) | Days (install) |
| Proof | "Nothing went wrong" | Attributed orders |
| Ceiling | Limited by sales headcount | Limited by catalogue count |

---

## 2. The gap

**AI shopping agents cannot see most merchants' products — because the product
data is written for humans.**

Two protocols standardised the plumbing this year. OpenAI and Stripe's
**Agentic Commerce Protocol (ACP)** uses a push model: merchants submit
structured feeds that surface inside ChatGPT, with Instacart, DoorDash,
Shopify and Etsy among the partners. Google's **Universal Commerce Protocol
(UCP)** launched 11 January 2026 at NRF, co-developed with Shopify, Target,
Walmart, Etsy and Wayfair, and endorsed by 20+ partners. ACP support already
ships in Salesforce, BigCommerce, Wix, Squarespace, WooCommerce and PayPal.

So the pipes exist. What does not exist is **data good enough to travel
through them.**

Stripe's own retrospective on early agentic commerce found most real-world
failures trace back to data quality: prices that do not match across surfaces,
inventory that is not current, and attributes that do not answer the query
that surfaced the product in the first place.

The blunt version: *humans compensate for incomplete product data; agents do
not.* A product without structured, machine-readable attributes will not be
recommended, no matter how well its description reads to a person.

And the clock is real — protocol implementation and conformance testing are
measured in months, not weeks. Starting in 2026 is not early.

### What this looks like on one SKU

A real agent query: *"warm hiking socks that don't itch"*.

**Before** — what actually sits in the merchant's store:

```
title           Crew Sock - Charcoal - M
description     Our bestselling sock. Super comfy!
material        —
gtin            —
size_system     —
use_case        —
care            —
availability    in stock            (last synced 6 days ago)
price           mismatched across web / feed / marketplace
```

The agent cannot match this to the query. It never surfaces.

**After** — the same SKU, agent-readable:

```
title           Merino Wool Crew Sock — Charcoal, Men's M (UK 7–9)
material        80% merino wool, 18% nylon, 2% elastane
fibre_grade     17.5 micron merino — non-itch
gtin            8901234567894
size_system     UK men's 7–9 · EU 41–43
use_case        hiking · cold weather · 0–15 °C
care            machine wash 30 °C, do not tumble dry
availability    in_stock            (synced 4 minutes ago)
price           ₹899 INR — single authoritative source
```

Now the query matches on three independent attributes — fibre grade, use case,
and material. The product becomes findable by a machine.

Doing that once by hand is easy. Doing it across 40,000 SKUs is the product.

---

## 3. Who is underserved

- **Enterprise** is covered — Bluestone PIM, commercetools and the PIM
  category sell exactly this, at enterprise price and a multi-month
  implementation.
- **Micro-merchants** do not matter yet; a 50-SKU store has no data problem
  worth paying for.
- **The middle — roughly 2,000 to 200,000 SKUs — is stranded.** They are on
  Shopify, BigCommerce or WooCommerce, so the protocol plumbing is handled for
  them. Their catalogue data is not. They cannot fund a PIM project and have no
  one to write 40,000 sets of structured attributes.

That middle is the market.

---

## 4. What to build

Four jobs, in this order:

1. **Score.** Ingest the catalogue (Shopify / BigCommerce / WooCommerce / feed)
   and grade every SKU for agent-readability against ACP and UCP requirements.
   Output one number per store and a ranked list of what is costing the most
   visibility. *This is the free tier and the entire acquisition engine.*
2. **Fix.** Generate the missing structured attributes — material, dimensions,
   compatibility, use case, care, sizing, fibre grade — at catalogue scale.
   This is the part that is genuinely impossible by hand and newly possible now.
3. **Truth-check.** Reconcile price and inventory across every surface the
   merchant publishes to. This is Stripe's number-one reported failure and
   nobody sells it as a product.
4. **Attribute.** Monitor whether the merchant's products are actually being
   surfaced and cited by agents, for which queries, and what revenue followed.

Job 4 is the retention hook. Jobs 1–3 are a project; job 4 is a subscription —
and unlike a compliance product, it proves its own worth every month.

**Not in v0:** a full PIM, DAM, multi-language, ERP integrations, or supporting
every protocol. Pick ACP and UCP, ship, expand later.

---

## 5. Revenue and distribution

**Pricing by catalogue size** — $99 / $299 / $999 per month at roughly 2K /
20K / 200K SKUs, with the readiness score free forever.

This is the genuinely different part: **distribution is self-serve.**

- **Shopify App Store** — the merchant installs it themselves. No demo, no
  procurement, no field visit. This is the single biggest structural
  difference from the other two theses.
- **The free score is the funnel.** A merchant runs it, sees "31% of your
  catalogue is invisible to AI shopping agents", and converts without a
  conversation.
- **Agencies and 3PLs resell.** E-commerce agencies already own these
  merchants' catalogues and are being asked about AI shopping right now with
  nothing to sell. White-label it.
- **Content is a real channel here** — unlike compliance, merchants actively
  search for this.

300 merchants at $299 average is roughly **$90K MRR**. Reachable without
hiring a single salesperson, which is why this scales differently.

---

## 6. Risks

| Risk | Reality | Response |
| --- | --- | --- |
| Shopify builds it natively | Genuine and likely for the basics | The durable layer is attribution and cross-surface truth-checking, not feed formatting. Do not build a feed formatter. |
| Protocol churn (ACP / UCP / AP2) | Standards are young and will move | Treat protocols as output adapters over one internal model. Never let the protocol shape the database. |
| PIM vendors move down-market | Bluestone, commercetools have the data model already | Beat them on time-to-value: minutes to a score, not a six-month implementation. |
| Agent traffic stays small | Consumer trust is still forming | Price for today's value (catalogue quality helps ordinary search too), not for a 2030 forecast. |
| AI-written attributes are wrong | A hallucinated fibre grade is a returns and trust problem | Generate only from evidence the merchant already holds; flag low-confidence fields for approval instead of publishing them. |

**Kill criteria:** if 200 merchants run the free score and fewer than 10
convert, the fix is not valuable enough to buy — reposition toward agencies
before building further.

---

## 7. Also considered

**Vernacular voice AI for Bharat.** Vernacular voice queries grew ~156% in
early 2026, native Indic STT/TTS now covers 11–22+ languages in production,
and an agent at ~₹6/min is 75–85% cheaper than a human agent with the same
language skills. But Tracxn counts 32 voice AI startups in India already, and
the core blocker is an accuracy gap — 82–88% in Tier-2, 70–80% in Tier-3.
That is a research problem, not a product problem, and it is not one a small
team wins on.

**The eval gap in AI agents.** LangChain's 2026 report puts 89% of production
agent teams on observability but only 52% on evaluations — a quantified
37-point gap in the hottest infrastructure budget line of the year. But
LangSmith, Langfuse, Arize Phoenix, Braintrust, Confident AI and Latitude are
all funded and already here. Entering now means competing on price against
venture money.

---

## 8. Choosing between the three

| | Insurance (US) | Labour (India) | Catalogue (global) |
| --- | --- | --- | --- |
| Sells because | Liability | Liability | Revenue |
| First revenue | 6–10 weeks | 3–4 weeks | 1–2 weeks |
| Revenue per account | High ($400–1,200/mo) | High (₹30K–1.2L/mo) | Low ($99–999/mo) |
| Accounts needed for scale | ~30 | ~25 | ~300 |
| Sales motion | Outbound + audit | Field visits | Self-serve |
| Needs you to sell in person | Yes | Yes, heavily | No |
| Defensibility | Rule library | State-rule matrix + relationships | Attribution data |
| Biggest risk | Crowded category | Services trap | Platform builds it |
| Window | Open, stable | **Open, dated** | **Open, closing fast** |

**If you want revenue soonest and hate selling:** catalogue.
**If you want the largest revenue per customer and will do field sales:**
labour.
**If you want the highest ceiling and can wait:** insurance.

All three run the same underlying engine — ingest, read, check against rules,
fix or chase, monitor continuously. That is not a coincidence and it is the
real asset. Pick the market by the sales motion you can actually sustain, not
by which idea sounds best.

---

## Sources

- [The new product feed: how ACP and UCP are changing commerce data strategy — Orium](https://orium.com/blog/acp-ucp-agentic-commerce-protocols)
- [Google UCP: merchant guide to agentic commerce — commercetools](https://commercetools.com/blog/google-ucp-merchant-guide-to-agentic-commerce)
- [How to prepare for agentic commerce — Bluestone PIM](https://www.bluestonepim.com/blog/how-to-prepare-for-agentic-commerce)
- [Agentic commerce standards: UCP vs ACP vs AP2 — Digital Applied](https://www.digitalapplied.com/blog/agentic-commerce-standards-ucp-acp-ap2-2026-merchant-guide)
- [AI shopping assistant guide 2026 — Opascope](https://opascope.com/insights/ai-shopping-assistant-guide-2026-agentic-commerce-protocols/)
- [Consumer demand for AI shopping — Checkout.com](https://www.checkout.com/newsroom/consumer-demand-for-ai-shopping-is-forming-fast-but-trust-for-agentic-commerce-is-still-catching-up)
- [Agentic commerce in 2026: why delivery decides who wins — nShift](https://nshift.com/blog/agentic-commerce-future-of-ecommerce)
- [Vernacular voice AI for Tier 2 & 3 India — Haptik](https://www.haptik.ai/blog/vernacular-voice-ai-for-tier-2-tier-3-india)
- [Voice AI startups in India — Tracxn](https://tracxn.com/d/explore/voice-ai-startups-in-india/__s7thq7EI12tPI5Mmcnok_iuzpK5VWI3-4ZhUxzXfMmA)
- [The eval gap — DEV Community](https://dev.to/syncsoftai/the-eval-gap-your-agent-has-observability-but-no-idea-if-its-any-good-1551)
- [Top AI agent observability platforms 2026 — Confident AI](https://www.confident-ai.com/knowledge-base/compare/best-ai-agent-observability-tools-2026)

*Protocol details, partner lists and adoption figures come from vendor and
analyst publications and should be confirmed against the official ACP and UCP
specifications before use in customer-facing material. Pricing and revenue
figures are assumptions, not forecasts.*
