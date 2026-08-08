# System overview — implementation plan

Phased delivery for promoting **Flow (help)** → **System overview** with hover copy, Live/Partial/Dummy badges, and live analysis signals.

**Scope:** `@trust-core/control-centre` only. No Trust API contract changes.

**Delivery rule:** Each phase ends with a hard gate — `typecheck` + `vitest` must pass before the next phase starts. Prefer pure model helpers with unit tests before wiring UI. Do not mutate system state from the canvas.

---

## Goals

### Product goals

| ID | Goal | Why it matters |
|----|------|----------------|
| G1 | Turn Flow from a Dummy help diagram into a **System overview & analysis** surface | Operators understand Trust Core topology and where Control Centre is wired |
| G2 | Every topology node exposes **process + feature** description on hover/focus and in the inspector | Removes guesswork; diagram becomes documentation that stays next to the UI |
| G3 | Every node (and the page) shows **Live / Partial / Dummy** reflecting **UI implementation**, not backend existence | Matches existing WiringBadge language; prevents false “fully shipped” signals |
| G4 | Overview becomes a **hub**: signals and deep links into Connections, Health, History, Portability, Access, Datasets | One place to analyse state, then jump to the action surface |
| G5 | Semantic layer stays explicitly **Dummy / deferred** until product ships | Honest roadmap; no fake live AI surface |

### Engineering goals

| ID | Goal | Why it matters |
|----|------|----------------|
| E1 | Model-first (`flow-model`, `flow-signals`) with unit tests before App wiring | Reviewable copy/badge matrix; fewer UI thrash cycles |
| E2 | Extract `FlowView` out of `App.tsx` | Keeps App maintainable; isolates overview regressions |
| E3 | Reuse `WiringBadge` + `wiring-status` catalog (`flow.node.*`) | One tooltip/count pipeline; Platform status stays consistent |
| E4 | No Trust API / protocol changes; no canvas mutations | Safe Control Centre–only delivery |
| E5 | Ship in 2–3 PRs with phase gates | Reviewable diffs; easy rollback |

### Non-goals (explicit)

- Not a second Platform status “implemented / outstanding” catalog
- Not a Connections replacement for setup/registration
- Not a react-flow / new diagram library rewrite
- Not promoting Semantic to Partial/Live without a real product surface

---

## Benchmarks to achieve

Pass/fail measures. A phase is not done until its benchmarks pass.

### Feature-complete benchmarks (end state)

| ID | Benchmark | Target | How verified |
|----|-----------|--------|--------------|
| B-F1 | Nav + page title renamed | Label **System overview**; section id still `flow` | `App.test.tsx` role queries |
| B-F2 | Topology coverage | **10** nodes, same layout family as today | `flow-model.test.ts` count + visual smoke |
| B-F3 | Badge matrix | **4 Live** · **5 Partial** · **1 Dummy** (Semantic) | `flow-model.test.ts` filter by `wiringLevel` |
| B-F4 | Hover / focus copy | **100%** of nodes have non-empty process description (≥ 80 chars recommended) | Unit assert + keyboard smoke |
| B-F5 | Feature lists | **100%** of nodes have ≥ **1** inspector feature bullet | `flow-model.test.ts` |
| B-F6 | Legend present | Live / Partial / Dummy explained under heading | `FlowView.test.tsx` |
| B-F7 | Inspector structure | Subheads: What this does · Features · Live signal · Open in Control Centre | `FlowView.test.tsx` |
| B-F8 | Workspace signals | **4** tiles: Datasets, Applications, Verification, Backup | `FlowView.test.tsx` + fixture counts |
| B-F9 | Page wiring level | `section.flow` ≥ **Partial** after Phase B; **Live** only if C.5 criteria met | `wiring-status.ts` + badge assertion |
| B-F10 | Deep links | Inspector open-action reaches mapped section for every non-dummy deep link | `FlowView` / `App` navigation tests |
| B-F11 | Honesty | Semantic badge remains **Dummy**; no API calls from node click | Code review + test that Semantic signal is deferred copy |
| B-F12 | Quality gate | `typecheck`, `test`, `build` all exit **0** for control-centre | CI / local commands |

### Quality & coverage benchmarks

| ID | Benchmark | Target | How verified |
|----|-----------|--------|--------------|
| B-Q1 | New pure modules covered | `flow-model` + `flow-signals` unit tests exist and pass | Vitest file presence + green |
| B-Q2 | UI regression coverage | Dedicated `FlowView.test.tsx` plus updated `App.test.tsx` | Vitest |
| B-Q3 | Existing suite unbroken | No skipped/deleted unrelated App tests to “make green” | PR review |
| B-Q4 | A11y smoke | All 10 nodes reachable by keyboard; description exposed via `aria-describedby` or accessible name | Manual checklist |
| B-Q5 | Responsive smoke | At ≤ 768px width, inspector stacks below canvas without horizontal clip of node labels | Manual |
| B-Q6 | Fixture parity | Dataset / backup signals on overview match values already shown on Home/Health for same `fixtureGateway` | Side-by-side manual + assert known fixture numbers |
| B-Q7 | Platform status integrity | Adding `flow.node.*` entries does not break `platformStatusCounts()` semantics; Partial/Dummy totals remain explainable | Spot-check Platform status after A/B |

### Phase exit benchmarks

| Phase | Must achieve | Numeric / boolean targets |
|-------|--------------|---------------------------|
| **0** | Contracts locked; baseline healthy | Baseline commands exit 0; badge approach decided (`flow.node.*`) |
| **A** | Static overview usable as analysis/docs UI | B-F1–F7 (signals may be placeholder); B-Q1 (`flow-model` only); B-Q2/Q3; `section.flow` still **Dummy** |
| **B** | Live analysis from existing gateway props | B-F8; B-F9 Partial; B-Q1 (`flow-signals`); B-Q6; inspector Live signal non-empty for all nodes except Semantic deferred copy |
| **C** | Overview is a navigation hub | B-F10; B-Q4; optional Live on `section.flow` only if C.5 true; B-F12 |

### Success scorecard (ship checklist)

Mark each **Done** only with evidence (test name or screenshot note).

| Goal | Linked benchmarks | Done? |
|------|-------------------|-------|
| G1 System overview & analysis | B-F1, B-F6, B-F7, B-F8 | ☑ |
| G2 Process/feature descriptions | B-F4, B-F5, B-Q4 | ☑ |
| G3 Honest Live/Partial/Dummy | B-F3, B-F9, B-F11, B-Q7 | ☑ (`section.flow` = Partial) |
| G4 Hub (signals + deep links) | B-F8, B-F10 | ☑ (section-level deep links) |
| G5 Semantic deferred | B-F3, B-F11 | ☑ |
| E1–E5 Engineering | B-Q1–Q3, B-F12, PR 1–3 landed | ☑ (single implementation; review fixes applied) |

**Release bar:** All product goals G1–G5 checked; B-F12 green; Phase B complete at minimum (Partial). Phase C required for “hub” claim (G4).

---

## Testing protocol (every phase)

### Automated

```bash
pnpm --filter @trust-core/control-centre typecheck
pnpm --filter @trust-core/control-centre test
pnpm --filter @trust-core/control-centre build   # before merge
```

**Patterns (match repo):**

- Vitest + jsdom + Testing Library
- `fixtureGateway` for App integration tests
- Pure helpers tested without React (like `readiness.test.ts`)
- Update `App.test.tsx` whenever nav/heading copy changes
- Prefer role/name queries over class selectors

### Manual / a11y smoke

- Fixture mode: open System overview
- Hover + keyboard focus each of 10 nodes
- Confirm badge colours: green / amber / muted
- Select Semantic → Dummy + deferred copy
- Phase B+: signals match Home/Health fixture numbers
- Phase C: deep links land on correct sections
- Narrow viewport: inspector stacks under canvas

### Definition of done (whole feature)

- Nav label **System overview**; section id remains `flow`
- Every node shows Live / Partial / Dummy reflecting UI wiring
- Hover/focus exposes explicit process description
- Inspector lists features; Semantic stays Dummy
- `section.flow` is at least Partial with workspace signals from gateway props
- No duplicate of Platform status catalog lists
- All control-centre vitest tests green

---

## Phase 0 — Prep & contracts

**Phase goal:** Lock copy, badge approach, and section-id stability so Phase A does not thrash APIs.

**Phase benchmarks:** Baseline `typecheck` / `test` / `build` exit 0 · badge approach = `flow.node.*` + `WiringBadge` · section id remains `flow`.

**Risk:** low · **Gate:** baseline green

| ID | Sub-task |
|----|----------|
| 0.1 | Freeze copy from proposal: nav “System overview”, h1 same, subtitle, legend captions, node hover/feature lists |
| 0.2 | Decide badge API: add `flow.node.*` entries in `wiring-status.ts` and reuse `WiringBadge` (preferred) |
| 0.3 | Keep section id `flow` in App state/nav for stability; only change visible labels |
| 0.4 | Baseline green: `pnpm --filter @trust-core/control-centre test && typecheck && build` |

**Recommended badge decision:** Add `flow.node.*` entries to `wiring-status.ts` and render `WiringBadge` on each node — one tooltip pipeline, Platform status counts stay truthful.

---

## Phase A — Content, badges, inspector (static analysis UI)

**Phase goal:** Deliver G1–G3/G5 in static form — renamed overview, badges, hover/inspector copy — without new gateway calls (advances E1–E3).

**Phase benchmarks:** B-F1–F7 · B-Q1 (`flow-model`) · B-Q2/Q3 · badge matrix 4/5/1 · `section.flow` remains **Dummy**.

**Risk:** medium (App.tsx extract) · **PR 1** · Ship without new gateway calls. Keep `section.flow` as **Dummy** until Phase B.

| ID | Sub-task |
|----|----------|
| A.1 | Add `flow-model.ts`: FlowNodeId, nodes[], hover, features[], wiringLevel, deepLink Section, signalKey |
| A.2 | Unit test `flow-model.test.ts`: 10 nodes, unique ids, badge matrix (4 live / 5 partial / 1 dummy), every node has hover + ≥1 feature |
| A.3 | Register wiring entries `flow.node.apps` … `flow.node.backup` (+ keep `section.flow`); update labels/details |
| A.4 | Extract `FlowView.tsx`; remove inline flow from `App.tsx` |
| A.5 | UI: legend strip, per-node WiringBadge + left accent by level, aria-describedby hover/focus copy |
| A.6 | UI: Process inspector — What this does / Features / Live signal placeholder / Open in CC |
| A.7 | `styles.css`: `.flow-legend`, `.flow-node.live\|partial\|dummy`, `.flow-inspector`; mobile stack |
| A.8 | Rename nav + PageHeading; refresh `section.flow` detail copy (level stays dummy until B) |
| A.9 | Update `App.test.tsx`; add `FlowView.test.tsx` for legend, badges, inspector, accessible name |
| A.10 | **Exit gate:** typecheck + vitest green; manual fixture smoke |

### Phase A test matrix

| Test file | Asserts | When |
|-----------|---------|------|
| `flow-model.test.ts` | Node count, ids, badge counts, required fields | A.2 before UI |
| `FlowView.test.tsx` | Legend, 10 badges, default Trust API selected, inspector headings | A.9 |
| `App.test.tsx` | Nav “System overview”, heading “System overview”, Trust API node | A.9 |

**Anti-patterns:** Do not promote `section.flow` to Partial yet. Do not fetch applications inside FlowView. Do not rewrite SVG to react-flow.

---

## Phase B — Live workspace signals

**Phase goal:** Make overview **analysis** (G1) with real workspace signals from existing gateway props; promote page wiring to Partial (G3, E4).

**Phase benchmarks:** B-F8 · B-F9 Partial · B-Q1 (`flow-signals`) · B-Q6 fixture parity · Live signal line for all nodes except Semantic deferred copy.

**Risk:** medium · **PR 2** · Promotes `section.flow` → **Partial**

| ID | Sub-task |
|----|----------|
| B.1 | Add `deriveFlowSignals(snapshot, operational, mode, appCount?)` in `flow-signals.ts` |
| B.2 | Unit test `flow-signals.test.ts`: fixture counts, backup `not_configured`, null operational fallbacks |
| B.3 | Wire FlowView props from App: snapshot, operational, mode (mirror HealthView) |
| B.4 | Workspace signals strip: Datasets / Applications / Verification / Backup (+ fixture caption) |
| B.5 | Inspector Live signal line per selected node |
| B.6 | Promote `section.flow` level dummy → partial; refresh wiring detail |
| B.7 | Tests: Partial badge on overview; FlowView shows dataset count from fixtureGateway |
| B.8 | **Exit gate:** vitest + typecheck; Platform status partial count correct |

### Signal mapping

| Signal key | Source | Display example |
|------------|--------|-----------------|
| datasets | `snapshot.datasets.length` | N datasets |
| applications | appCount prop or “—” | N registered apps |
| verification | integrity / `latestVerification` | Verified 100% / last run … |
| backup | `operational?.backup.status` | not_configured / healthy |
| gateway | `mode` | fixture \| live |

---

## Phase C — Navigation & polish

**Phase goal:** Complete G4 (hub) — inspector and signal tiles navigate into real Control Centre sections; optionally promote `section.flow` to Live.

**Phase benchmarks:** B-F10 deep links · B-Q4 keyboard · B-F12 full quality gate · Live only if C.5 true (else remain Partial).

**Risk:** low · **PR 3** · Live promote is conditional

| ID | Sub-task |
|----|----------|
| C.1 | Pass `navigate` into FlowView; inspector “Open in Control Centre” → `setSection(deepLink)` |
| C.2 | Workspace signal tiles are buttons → Datasets / Connections / Health |
| C.3 | Test navigation: click Open → correct section headings |
| C.4 | Optional: edge aria-labels / title verbs — only if no layout churn |
| C.5 | Promote `section.flow` → live only if every non-semantic node exposes a live signal; else remain partial |
| C.6 | **Exit gate:** full control-centre suite + keyboard tab through nodes |

**When to mark Live:** Non-deferred nodes (all except Semantic) show real signals and deep links work. If applications count is still “—” without a list fetch, stay Partial.

---

## File plan

| Path | Phase | Action |
|------|-------|--------|
| `src/flow-model.ts` | A | Create |
| `src/flow-signals.ts` | B | Create |
| `src/FlowView.tsx` | A | Create (extract from App) |
| `src/wiring-status.ts` | A/B | Edit — `flow.node.*` + `section.flow` |
| `src/App.tsx` | A/B/C | Edit — nav, props, navigate |
| `src/styles.css` | A/B | Edit — legend, accents, inspector, signals |
| `tests/flow-model.test.ts` | A | Create |
| `tests/flow-signals.test.ts` | B | Create |
| `tests/FlowView.test.tsx` | A/B/C | Create / extend |
| `tests/App.test.tsx` | A/B/C | Update |

---

## PR strategy

| PR | Contents |
|----|----------|
| **PR 1** | Phase A — UI extract + static badges (largest visual delta) |
| **PR 2** | Phase B — data wiring + Partial promote |
| **PR 3** | Phase C — navigation polish (can squash into PR 2 if needed) |

---

## Suggested execution order

1. Phase 0.4 baseline tests → suite green  
2. A.1–A.2 `flow-model` + unit tests  
3. A.3 wiring entries → typecheck  
4. A.4–A.7 extract UI + styles → manual canvas OK  
5. A.8–A.10 rename + tests → **PR 1 ready**  
6. B.1–B.2 signals helper + tests  
7. B.3–B.8 wire props + Partial → **PR 2 ready**  
8. C.1–C.6 deep links + optional Live → **PR 3 ready**  

**Start here:** Phase 0.4 (baseline), then A.1 `flow-model.ts` with A.2 tests before touching `App.tsx`.

---

## Apps & Tenants honesty (Step 0) + durable bindings (G1)

Cross-link: [ADR-016](../adr/ADR-016-application-tenants-storage-bindings.md).

### Honesty rules

| Mode | Apps & Tenants | Home attention strip |
|------|----------------|----------------------|
| **Fixture** | Synthetic Foundation tenants/rollup; fixture banner; attention alert OK | `foundationStorageRollup()` when unhealthy |
| **Live** | Live honesty banner; **no** fixture attention; applications from gateway list | Neutral “binding rollup unavailable” notice (G3 not wired) |

### System overview mapping

- **Applications** node/tile → deep link **Apps & Tenants** (`section.apps`, Partial).
- **Canonical objects** → platform **Storage** + note that app/tenant BYOB data-plane remains Partial.

### Platform Status IDs

**Implemented:** `adr-016-api`, `adr-016-schema`, `adr-016-postgres-repo`

**Outstanding:** `cc-apps-gateway`, `cc-apps-live-strip`, `sts-assumerole-hardening`, `byob-data-plane`

### Benchmarks (Step 0 / G1)

| ID | Pass bar |
|----|----------|
| S0-B5 | Fixture Apps shows Foundation attention when unhealthy |
| S0-B6 | Live Apps shows live honesty banner; zero fixture attention alerts |
| S0-B8 | Live Home shows unavailable notice (not silent) |
| S0-B11 | System overview Applications reaches Apps & Tenants |
| G1-B3 | Bindings survive reconnect (Postgres) |
| G1-B6 | Rollup/effective omit ExternalId |
| G1-B12 | `section.apps` remains Partial (not Live) |

Remaining after this work: G2 STS, G3 live CC rollup fetch, G4 ingest/worker resolver.