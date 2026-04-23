# Scope: Local-LLM Texas CAD Scraper

**Status:** Draft scope, not yet approved for build
**Target infra:** Mac Studio (M2/M3 Ultra, 256 GB unified memory)
**Goal:** Expand PropFight data ingestion from one county (Parker / PCAD) to Texas-wide coverage, using a local LLM to absorb the per-county HTML variance that currently blocks a one-shot deterministic scraper.

---

## 1. Problem framing

PropFight's comparable-based protest argument only works if we have fresh, accurate parcel data. Today we have three scrapers (`scraper/pcad_scraper.py`, `pcad_scraper_v2.py`, `pcad_gemini_scraper.py`), all pointed at a single vendor portal (Southwest Data Solutions, Parker County). Texas has 254 appraisal districts on ~6 different portal platforms plus bespoke sites, so hand-writing 254 parsers is not the right move. A local LLM gives us an adaptive extractor without per-property API cost or data-egress concerns.

The open question this scope answers: **where does the LLM actually earn its keep, vs. where should we stay deterministic?**

## 2. Target landscape — Texas CADs

Rough platform breakdown (to be verified in Phase 0 survey):

| Platform | Example counties | Notes |
|---|---|---|
| True Automation (Trueprodigy / True Prodigy) | Harris (HCAD), Dallas (DCAD), Tarrant (TAD), Collin, Denton | Biggest by parcel count; most standardized |
| Pritchard & Abbott | Many rural/mid-size | Older HTML, consistent across counties |
| BIS Consultants | Several mid-size | Similar HTML shape per deployment |
| Southwest Data Solutions | Parker (current), a handful of others | Already solved |
| Harris Govern / Tyler | Some mid-size | |
| Bespoke | Travis (TCAD), Bexar (BCAD), a few others | Each needs its own adapter |

**Implication:** writing one adapter per *platform* (~6–8) plus an LLM-driven fallback covers the long tail. Parcel coverage is extremely Pareto — the top ~20 counties are >70% of TX parcels.

Before choosing platforms, also check every CAD for:
- Bulk data downloads (many publish yearly CSV/flatfile exports — free, no scraping)
- Open-records / PIA request path (Texas Gov. Code 552) — slow but bulk
- Published APIs (rare but exist)

**Legal note:** Each CAD has its own ToS. Scraping published public records is generally defensible in Texas, but rate limiting, honoring robots.txt, and avoiding auth-gated areas is non-negotiable. Prefer bulk downloads wherever available.

## 3. Where the LLM fits (and doesn't)

The Gemini scraper today uses the LLM on *every* page. That's expensive and slow at scale. Recommended pattern instead:

1. **LLM as schema/rule generator (offline, rare).** Feed it 5–10 sample pages from a new CAD; it emits a deterministic parser spec (CSS selectors + field regexes) plus a JSON schema. A human reviews, it ships as a Python module. Run it maybe once per CAD per year.
2. **Deterministic parsers at runtime (hot path).** Fast, cheap, reproducible, auditable. This is 99% of calls.
3. **LLM as fallback on parse failure.** If a deterministic parser's validator rejects output (missing required field, format drift after a site update), route that single page to the local LLM for one-off extraction + alert for rule refresh.
4. **LLM for semantic normalization (batch).** Address canonicalization, owner-name dedup, legal-description parsing, subdivision clustering. These benefit from LM reasoning and run as nightly batch.

**Rough throughput math to justify this:**
- Mac Studio M2 Ultra on Llama 3.3 70B Q4 via MLX: ~15–25 tok/s
- Typical property extraction ≈ 400–600 output tokens → ~25–40 s/property
- Single-instance ceiling ≈ 2k–3k properties/day
- Texas has ~12M taxable parcels → LLM-per-page is a non-starter for full refresh; rule-based + LLM fallback is feasible.

## 4. Local LLM stack on Mac Studio 256 GB

**Recommended model (primary):** Llama 3.3 70B Instruct, Q5_K_M or Q6_K (MLX format). Fits comfortably in unified memory with room for long contexts. Strong structured-output behavior.

**Alternatives worth benchmarking:**
- Qwen 2.5 72B Instruct — strong HTML/JSON tasks
- Qwen 2.5 Coder 32B — faster, surprisingly good at structured extraction; may be sufficient
- Mistral Large 2411 (123B) Q4 — borderline fits, slower
- Llama 3.1 405B Q3 — technically fits, too slow for production

**Serving:**
- **First choice: MLX LM server** — Apple-native, highest tok/s on Apple Silicon, OpenAI-compatible endpoint.
- **Fallback: llama.cpp server** — broader model support, slightly lower throughput.
- **Avoid Ollama for production** — easy to start with, but concurrency and batch support lag the alternatives. Fine for dev.

Expose as an OpenAI-compatible HTTP endpoint on the LAN; the Python scraper (can run on any machine) hits it via `openai` or raw `requests`. Constrained JSON decoding (grammar-based via llama.cpp, or JSON-mode via MLX) is a hard requirement — we should never hand-parse free-form LLM output.

**Concurrency:** MLX/llama.cpp on Apple Silicon are effectively single-stream for large models. Plan for 1 inference at a time per model instance, with a request queue. If we need parallelism, run a smaller model (Qwen 32B) alongside the 70B for fallback-class work.

## 5. Architecture

```
┌──────────────────┐     ┌────────────────────┐     ┌─────────────────┐
│ CAD site (HCAD,  │     │ Scraper worker     │     │ Postgres (Neon) │
│ DCAD, TAD, ...)  │◀───▶│ (Python, per-CAD   │────▶│ properties,     │
└──────────────────┘     │ platform adapter)  │     │ values, sales,  │
                         └─────────┬──────────┘     │ exemptions      │
                                   │                └─────────────────┘
                                   │ parse fails / new CAD
                                   ▼
                         ┌────────────────────┐
                         │ Local LLM gateway  │
                         │ (MLX, Mac Studio)  │
                         │ OpenAI-compatible  │
                         └────────────────────┘
```

**New components:**
- `scraper/adapters/<platform>.py` — one per platform (trueautomation, pritchard_abbott, bis, swds, …), implementing a common `PropertyAdapter` interface: `search(address) -> [ids]`, `fetch(id) -> html`, `parse(html) -> PropertyRecord`.
- `scraper/llm_client.py` — thin wrapper over the MLX endpoint with JSON-schema-constrained calls and retry/backoff.
- `scraper/rule_generator.py` — offline tool, given sample pages + golden extractions, uses LLM to draft a parser spec (for human review).
- `scraper/validators.py` — JSON-schema + business-rule checks (e.g. total_appraised ≈ land + improvement, sqft > 0). Failure routes to LLM fallback.
- `scraper/queue.py` — simple work queue (SQLite or Redis) for scheduling; status/last-scraped per parcel.

**Schema extensions needed** (schema.sql):
- `properties.cad` already exists (default `'PARKERCAD'`) — good, just start populating with HCAD / DCAD / TAD / etc.
- Add `cad_registry` table: `cad_code, county_name, platform, base_url, adapter_name, last_full_refresh_at, notes`.
- Add `scrape_jobs` table: `job_id, cad, property_id, status, attempts, last_error, scraped_at`.
- Consider `properties.source_platform` for debugging drift.

## 6. Phased plan

**Phase 0 — Survey & decisions (1–2 days, no code).**
Catalog the top 25 counties by parcel count: platform, bulk-download availability, ToS, URL patterns, rate limits. Deliverable: `cad_registry.csv`. This might change the plan — if HCAD/DCAD/TAD all publish flatfiles, the LLM scraper is less urgent than a flatfile ingestor.

**Phase 1 — Mac Studio LLM gateway (2–3 days).**
Stand up MLX with Llama 3.3 70B, OpenAI-compatible endpoint, JSON-schema constrained output. Benchmark tok/s, latency per property, stability over a 24h soak. Add `llm_client.py` + a one-shot CLI: `python -m scraper.llm_extract <html_file>`.

**Phase 2 — Adapter framework + first new CAD (3–5 days).**
Extract current PCAD logic behind the `PropertyAdapter` interface. Add one new platform — recommend Pritchard & Abbott (rural counties, simpler HTML, good test bed). Ship validators + LLM fallback path.

**Phase 3 — Rule generator + True Automation (1 week).**
Build the offline rule generator. Use it to draft the True Automation adapter; human-review, ship. This unlocks HCAD / DCAD / TAD — the big three by parcel count. Expect bespoke overrides per county even within the platform.

**Phase 4 — Bulk ingestion paths (parallel, ~3 days).**
For CADs that publish flatfiles, skip scraping entirely: write CSV ingestors. Faster, more reliable, no ToS risk.

**Phase 5 — Scale-out + scheduling (ongoing).**
Nightly re-scrape of watched properties, weekly sweep of active user counties. Observability (scrape success rate per CAD, LLM fallback rate, schema-validation failures).

## 7. Risks & open questions

- **Throughput ceiling.** A single Mac Studio won't refresh 12M parcels on any useful cadence. Need an explicit scope: are we scraping *only parcels users search for*, or pre-populating top counties? Current UX assumes pre-populated DB. Discuss before Phase 2.
- **LLM drift / hallucination.** Even with JSON-schema constraint, LLMs invent values. Validators must be strict (totals reconcile, year bounded, sqft > 0). LLM-fallback extractions should be flagged in the DB (`extraction_source = 'llm'`) so we can audit.
- **ToS / blocking.** Some CADs aggressively rate-limit or block scrapers. Need per-CAD rate budgets + honest User-Agent. If blocked, pivot to PIA requests.
- **Address / property-ID identity across counties.** Current PK is `property_id` which is per-CAD scoped. Need composite `(cad, property_id)` as the real key, or switch to a UUID with `(cad, property_id)` unique. Affects every API route — worth a mini-migration plan.
- **Comparable analysis assumptions.** `lib/protest-analysis.ts` assumes a single `subdivision` string and a 2.5% effective tax rate — both vary across TX. Out of scope for the scraper but blocks multi-county rollout.
- **Cost of running the Mac Studio 24/7 vs. Gemini / Claude API.** At current Gemini pricing, the break-even vs. a $5k Mac Studio is on the order of millions of pages; if volumes stay modest, the local LLM is a preference (privacy, predictability) more than a cost win. Worth revisiting with real numbers.

## 8. Rough effort estimate

| Phase | Effort | Gates |
|---|---|---|
| 0 — Survey | 1–2 days | produces registry, may change plan |
| 1 — LLM gateway | 2–3 days | benchmarks meet target (>10 tok/s, >99% uptime) |
| 2 — Adapter framework + P&A | 3–5 days | one new CAD live, <2% LLM fallback rate |
| 3 — Rule generator + True Automation | ~1 week | HCAD + DCAD + TAD live |
| 4 — Flatfile ingestion | ~3 days parallel | |
| 5 — Scheduling / observability | ongoing | |

**MVP to "Texas-wide-ish" (top 10 counties): ~3 weeks of focused work.**

## 9. Next step

Before any code: run Phase 0 and decide on the identity/PK question (Section 7). Both are cheap and both can invalidate big chunks of the build plan.
