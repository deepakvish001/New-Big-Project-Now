# Product Thesis — What to Build

**Date:** 14 September 2026
**Status:** Research complete, pre-build. Validation gate not yet passed.

---

## 1. The verdict

Build an **autonomous vendor-insurance compliance agent** for US-based general
contractors, property management companies, and facilities/staffing firms that
manage between **50 and 500 vendors**.

The product does the job a compliance clerk does today:

1. Asks each vendor (and the vendor's insurance agent) for their Certificate of
   Insurance, W-9, and trade licence.
2. Reads the returned ACORD 25 PDF — coverage types, each-occurrence and
   aggregate limits, policy numbers, expiry dates, additional-insured and
   waiver-of-subrogation endorsements, certificate holder name.
3. Checks it against that vendor's contractual requirements.
4. If it fails, replies to the agent asking for the specific fix — by name,
   not "please resubmit".
5. Re-runs the whole loop 90 / 60 / 30 / 7 days before every expiry, forever.
6. Blocks a non-compliant vendor from being dispatched or paid.

Existing tools **store and alert**. None of them **chase**. Chasing is the
entire job, and it is the part that only became automatable in the last
~18 months.

> Seedhi baat: Indian SMB ko mat becho — ARPU marr jaata hai. Yahi engine US
> buyer ko USD me becho. Kaam India se, paisa dollars me.

---

## 2. Why this group

**They have money and a measurable loss.** One lapsed COI on a job site is an
uninsured claim, a liability transfer failure, and a stop-work order. The cost
of the failure is orders of magnitude above the cost of the software, which is
what makes a price stick.

**The pain is structural, not seasonal.** Policies expire annually, vendors
churn, requirements differ per project. The work never finishes. That is the
definition of a recurring-revenue product.

**They are too big for a spreadsheet and too small for enterprise.** See the
price ladder in §4 — there is a genuine hole in the market between $30/vendor/year
self-serve tools and $450–900/vendor/year enterprise platforms.

**The buyer is reachable.** A risk or operations manager at a 40-person GC can
sign a $400/month tool without procurement, legal review, or a security
questionnaire. No enterprise sales motion required.

**The 2026 standard is moving our way.** The emerging expectation in property
management is *hard-stop dispatching* — the system blocks a vendor from
receiving a work order the moment insurance lapses. That reframes compliance
from an admin chore into a governance control, which is a budget line.

---

## 3. The wedge — what is actually different

Every incumbent is a **filing cabinet with a calendar**. You still need a human
to email the vendor, receive the PDF, read it, and judge it.

Our product is an **agent that closes the loop without a human**:

| Incumbent behaviour | Our behaviour |
| --- | --- |
| "3 certificates expire in 30 days" | Already emailed all 3 agents, got 2 back, verified them, and is negotiating the third |
| Stores the PDF | Reads the PDF and argues with it |
| Generic "please resubmit" reminder | "Your GL aggregate is $1M; the Riverside contract requires $2M and names us as additional insured on a primary/non-contributory basis. Please reissue." |
| Human decides pass/fail | Agent decides, flags only genuine judgement calls |

The technical moat is not the LLM. It is the **requirement rule library** —
the accumulated encoding of what real contracts actually demand, per trade, per
state, per project type. That compounds with every customer and cannot be
copied from a pricing page.

---

## 4. The market gap (real 2026 pricing)

| Tier | Price | Who it serves |
| --- | --- | --- |
| Spreadsheet | ₹0 | Under ~30 vendors |
| Self-serve tools (SubDoc et al.) | $3–10 / vendor / yr | Small, storage-only |
| Full-service COI tracking | $10–30 / vendor / yr | Mid, human-assisted |
| **← the gap →** | **$60–150 / vendor / yr** | **50–500 vendors, wants it done for them** |
| Avetta | $450–900 / vendor / yr | Enterprise supply chains |
| ISNetworld | $875+ / vendor / yr | Enterprise, energy/industrial |

A 150-vendor property manager at $100/vendor/year is **$15,000 ARR from one
account** — and they still save money versus one part-time compliance clerk.

Known competitors: Billy, Certificial, SubDoc, TrackMyVendor, myCOI, Jones,
Avetta, ISNetworld. **A crowded category is validation, not a blocker** — it
proves budget exists. The risk is not competition; it is building the same
filing cabinet they already built.

---

## 5. Money model

- **Pricing:** $249 / mo (up to 75 vendors), $549 / mo (up to 250),
  $999 / mo (up to 600). Annual billing, 15% discount.
- **Target:** 30 accounts at ~$450 average = **$162K ARR**.
- **Gross margin:** 80%+. LLM inference per certificate is cents; the
  recurring revenue is per-vendor-per-year.
- **Expansion is automatic:** customers add vendors, so revenue grows without
  a new sale. Net revenue retention above 100% is the default, not a program.
- **Why USD, not INR:** Indian CA practice-management software sells at
  ₹5,999–₹24,999 **per year** for 10–60 users (~$70–290/yr). Same build effort,
  1/20th the revenue. Build from India, bill in USD.

---

## 6. MVP — v0 in six weeks

Ship only this. Everything else is a distraction.

1. **Vendor list import** — CSV upload. No integrations in v0.
2. **Requirement profiles** — per vendor or per project: required coverages and
   limits, additional-insured, waiver of subrogation, certificate holder text.
3. **The chase engine** — scheduled outbound email to vendor + agent, threaded,
   with reply handling. This is the product. Build it first.
4. **The reader** — ACORD 25 PDF → structured fields. Confidence score per
   field; anything below threshold goes to a human review queue.
5. **The judge** — extracted fields vs. requirement profile → pass / fail /
   needs-human, with the failure reason written in plain language.
6. **One dashboard** — every vendor, status chip (compliant / expiring / lapsed
   / chasing), and the single number that matters: *how many active vendors are
   currently uninsured*.
7. **Audit trail** — every document, every message, timestamped and exportable.
   This is what they show their own insurer after a claim.

**Explicitly not in v0:** mobile app, payments, vendor self-serve portal,
integrations with Procore/AppFolio/Yardi, multi-user permissions, SOC 2.
Integrations are the wedge for v2, not v0.

---

## 7. Go to market — first 10 customers

- **Do not cold email first.** Average cold email reply rates sit around 3.4%;
  signal-triggered outreach lands 15–25%. The signal here is public: a company
  posting a job for "compliance coordinator", "contracts administrator", or
  "vendor onboarding". That posting means they have decided to spend $45K/year
  on this exact problem. Reach them with "before you hire, look at this."
- **Sequence:** 4–5 touches over 14–21 days for SMB buyers.
- **Channel two — the insurance agents.** Every COI is issued by an independent
  agency. Agents hate reissuing certificates almost as much as GCs hate
  chasing them. An agent who likes the tool introduces you to every one of
  their commercial clients. This is the highest-leverage channel and almost
  nobody works it.
- **Channel three — proof, not marketing.** Run a free "insurance gap audit":
  take a prospect's existing COI folder, run it through the reader, and hand
  back a list of everything currently non-compliant. Find three real gaps and
  the sale closes itself.
- **Incorporation:** US entity (Stripe Atlas or equivalent) for USD billing and
  buyer trust. Treat ODI, transfer pricing, repatriation, and Indian books as
  separate questions for a qualified CA — do not improvise these.

---

## 8. Validation gate — before writing product code

Do not build until all three are true:

1. **20 discovery calls** with target-profile operators. Ask what they do today,
   who does it, how many hours, and what happened the last time a certificate
   lapsed. Do not pitch.
2. **5 of 20 describe the chasing loop as their worst part** — unprompted.
3. **3 signed letters of intent** at real pricing, or 3 paid pilots at
   $500 one-off for a manual concierge run (you do it by hand; the software
   comes later).

If the calls say "our broker handles it" or "we just use a spreadsheet and it's
fine", the thesis is wrong at the segment level. Move up-market to 200+ vendor
firms before abandoning it.

---

## 9. Risks and kill criteria

| Risk | Reality | Mitigation |
| --- | --- | --- |
| Crowded category | 8+ named competitors | Compete on the chase loop, not storage. If an incumbent ships autonomous chasing well, re-evaluate. |
| Extraction errors | ACORD forms vary; a wrong "pass" is a liability | Never auto-pass below a confidence threshold. Human review queue is a feature, not a fallback. |
| Liability exposure | If we clear a vendor who turns out uninsured | Product is decision *support* with a full audit trail. Contract terms must be explicit. Get this reviewed. |
| Incumbent integrations | Procore/Yardi lock-in | v0 targets firms not yet on those platforms; integrate in v2. |
| Long sales cycles | Even SMB risk buyers move slowly | The free gap audit compresses it — a real finding creates urgency. |

**Kill criteria:** if after 20 calls and 60 days there are no LOIs and no paid
pilots, stop and move to runner-up #1. Do not build on hope.

---

## 10. Runner-ups considered and why they lost

**DPDP Act compliance-in-a-box (India).** Genuinely deadline-driven — consent
manager registration from 13 Nov 2026, full substantive compliance from
13 May 2027 with no grace period, penalties up to ₹250 crore. But: the top of
the market is already funded and consolidating (IDfy's Privy raised $53M in
Feb 2026; OneTrust, Scrut, Vanta, Complynz all present), the registered
Consent Manager role legally requires ₹2 crore net worth, and the long tail of
small Indian companies has both low willingness to pay and low urgency until
enforcement actually bites. Keep as fallback; revisit if enforcement news
creates a panic buying window in early 2027.

**GEO / AEO — AI search visibility tracking.** Hot, real, and growing. Also has
at least eight competing funded platforms as of mid-2026 and is becoming a
feature of existing SEO suites. Too late to enter as a solo team without a
sharp vertical angle.

**AI receptionist / voice agent for local business.** Real pain (a large share
of small-business calls go unanswered) but the category collapsed to $29–245/mo
commodity pricing with dozens of entrants. Thin margins, high churn, no moat.

---

## 11. The general principle behind this pick

The durable pattern for a small team in 2026 is not "add AI to something", it is:

> **Find a group that is paying a human to read documents and chase people for
> them, in a market where getting it wrong is expensive, and do that job
> end-to-end instead of building a dashboard about it.**

Vendor insurance compliance is one instance. The same engine — collect, read,
verify against rules, chase until resolved, monitor expiry — retargets cleanly
to healthcare-staffing credentials, franchisee compliance, and carrier
onboarding in freight. Build the engine once; the second vertical is a
configuration, not a rewrite.

---

## Sources

- [Micro SaaS ideas 2026 — Redwerk](https://redwerk.com/blog/micro-saas-ideas-that-print-money/)
- [COI tracking software cost 2026 — Vertikal RMS](https://www.vertikalrms.com/article/how-much-does-coi-tracking-software-cost-2026-pricing-guide/)
- [Best COI tracking software 2026 — SubDoc](https://subdoc.io/blog/best-coi-tracking-software-2026)
- [Vendor insurance compliance tracking for property managers — TrackMyVendor](https://trackmyvendor.com/resources/vendor-insurance-compliance-tracking-property-managers)
- [Vendor certificates of insurance — Jones](https://getjones.com/blog/vendor-certificates-of-insurance-what-property-managers-need-to-know/)
- [DPDP compliance timeline 2026–27 — India Briefing](https://www.india-briefing.com/news/india-dpdp-compliance-timeline-enforcement-2026-27-44740.html/)
- [DPDP compliance software buyer's guide — ConsentOS](https://consentos.in/learn/dpdp-compliance-software/)
- [DPDP compliance cost breakdown 2026 — Consently](https://www.consently.in/blog/dpdp-act-compliance-cost-india-2026)
- [Top practice management software for CA firms 2026 — Finexo](https://finexo.in/blog/practice-management/top-10-practice-management-software-for-ca-firms-in-india-2026)
- [Cold email benchmarks for SaaS 2026 — Saleshandy](https://www.saleshandy.com/blog/saas-cold-email/)
- [Cold email guide 2026 — Autobound](https://www.autobound.ai/blog/cold-email-guide-2026)
- [Stripe Atlas — Indian founder guide](https://docs.stripe.com/atlas/indian-founder-guide)
- [GEO platforms in 2026 — MarketScale](https://www.marketscale.com/industries/marketing-tech/ai-answer-engine-visibility-becomes-a-measurable-discipline-as-geo-platforms-multiply-in-2026)
- [AI receptionist statistics 2026 — Magicline](https://www.magicline.ai/blog/ai-receptionist-statistics-2026)

*Pricing and adoption figures above are drawn from vendor-published and
marketing content and should be treated as directional, not audited.*
