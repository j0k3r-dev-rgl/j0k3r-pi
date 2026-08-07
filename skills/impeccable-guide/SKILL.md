---
name: impeccable-guide
description: "teach agents how to use the impeccable skill correctly for UI/UX work. Use when the impeccable skill is available and a subagent or the orchestrator needs to create, fix, critique, or improve frontend UI; covers the two operational scenarios (project that advanced without impeccable, and project starting fresh with impeccable), prerequisite checks, command selection, execution order, and anti-patterns so the agent produces quality UI instead of improvising."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.1"
registry:
  category: "quality"
  domains: "frontend, ux, ui, design-quality"
  keywords: "ui broken, ux bad, layout roto, no se ve bien, diseño feo, looks wrong, visual bug, responsive broken, too cluttered, too dense, hard to read, confusing ui, ugly, mejorar ui, arreglar diseño, fix design, fix layout, fix ui, mobile broken, modal roto, jerarquía visual, visual hierarchy, cognitive load, carga cognitiva, how to use impeccable, impeccable guide, impeccable commands, mejorar diseño, panel admin, dashboard, frontend quality"
  related: "impeccable"
  priority: 75
---

# Impeccable Guide — How to Use Impeccable

This skill teaches agents the correct way to use the impeccable skill when it is available in the project. Read this before touching frontend code.

## Activation Contract

Use this skill when:

- The impeccable skill is available and you need to create, modify, or fix frontend UI.
- A user reports a visual problem, layout bug, or UX issue and impeccable is installed.
- A user shares a screenshot showing UI that needs improvement.
- You finished implementing UI and need to verify quality.
- You are delegating UI work to a subagent and impeccable is available.

Do NOT use when:

- The impeccable skill is not available in the project. This guide is useless without impeccable.
- The user already invoked a specific `/impeccable` command — impeccable handles itself.
- The work is purely backend, API, or data with no UI surface.

## Hard Rules

- **Ask before assuming (orchestrator only).** Before starting any UI work, the orchestrator asks the user: "Do you want me to use impeccable for this?" Do not assume. Subagents never ask — they receive the decision already made.
- **Never improvise frontend fixes when impeccable is available.** Do not write raw CSS, restructure HTML, or redesign components without going through impeccable commands. Impeccable has playbooks, quality floors, and detectors that prevent regressions. Your improvisation creates them.
- **Always run Setup first.** Before any impeccable work in a session, run `node .pi/skills/impeccable/scripts/context.mjs --target <path>`. This loads PRODUCT.md, DESIGN.md, and surface briefs. Follow its directives.
- **One command at a time.** Execute one impeccable command, verify the result, then proceed to the next. Do not chain multiple commands without checking output.
- **Load the playbook before executing.** Every command has a reference file at `skills/impeccable/reference/<command>.md`. Read it before running the command.
- **Load craft-floor.md before editing UI.** Immediately before writing or editing any UI code, read `skills/impeccable/reference/craft-floor.md`. It carries the quality floor and absolute bans.

## Autonomous vs Interactive Operations

Not everything in impeccable can be done by any agent. Some operations require user interaction (questions, decisions, discovery interviews). Subagents cannot ask the user anything — they must return `BLOCKED` if an interactive operation is needed.

### Interactive — require user answers (orchestrator only)

These commands run a discovery interview, ask product questions, or need user decisions. Only the orchestrator or a direct conversation can execute them:

| Command | Why it needs interaction |
|---|---|
| `init` | Asks product questions: audience, brand, constraints, platform |
| `shape` | Runs a multi-round discovery interview about purpose, people, outcomes |
| `critique` (Ask the User phase) | After scoring, asks the user to prioritize which issues to fix |

### Autonomous — can run without user input

These commands read code, apply rules, and produce output without asking questions. Subagents can run these:

| Command | What it does autonomously |
|---|---|
| `document` | Generates DESIGN.md from existing code analysis |
| `distill` | Strips complexity based on code inspection |
| `layout` | Fixes hierarchy, spacing, structure by analysis |
| `adapt` | Fixes responsiveness based on viewport rules |
| `clarify` | Improves copy and labels based on UX rules |
| `typeset` | Fixes typography based on scale and hierarchy rules |
| `colorize` | Adds strategic color based on palette analysis |
| `bolder` | Amplifies bland designs based on design rules |
| `quieter` | Tones down aggressive designs based on design rules |
| `harden` | Adds error, loading, empty states based on code analysis |
| `onboard` | Designs first-run flows based on user journey analysis |
| `polish` | Final consistency pass based on full surface scan |
| `extract` | Pulls reusable tokens and components from code |
| `audit` | Runs technical quality checks (a11y, perf, responsive) |
| `context.mjs` | Loads project context (PRODUCT.md, DESIGN.md, briefs) |
| `detect.mjs` | Runs the quality detector on source files |
| `craft-floor.md` | Quality floor reference — read before editing |

### Partially autonomous

| Command | Autonomous part | Interactive part |
|---|---|---|
| `critique` | Scoring, heuristic evaluation, detector scan, report | "Ask the User" phase needs user to choose priorities |

A subagent can run critique up to the report and scoring, but must return `BLOCKED` at the "Ask the User" phase, reporting the scores and findings back to the orchestrator for user decision.

## Two Scenarios

### Scenario A: Project that advanced without using impeccable

The project has UI code already written but impeccable was never set up. There is no PRODUCT.md, no DESIGN.md, and no critique history. The UI may have accumulated problems.

**Recovery sequence:**

```
1. impeccable init              → INTERACTIVE — orchestrator only
2. impeccable document          → autonomous
3. impeccable critique <target> → partially autonomous (scoring yes, Ask the User no)
4. Fix using commands           → autonomous (distill, layout, adapt, etc.)
```

**Subagent boundary:** A subagent assigned UI work that discovers PRODUCT.md is missing must return `BLOCKED` with: "PRODUCT.md is missing. Run `impeccable init` (requires user interaction) before UI work can proceed." It must not attempt `init` itself.

### Scenario B: Project starting fresh with impeccable from the beginning

The project is new or the UI is about to be built. Impeccable should guide from the start.

**Setup sequence:**

```
1. impeccable init              → INTERACTIVE — orchestrator only
2. impeccable shape <feature>   → INTERACTIVE — orchestrator only
3. Build the UI                 → autonomous (with craft-floor.md loaded)
4. impeccable critique <target> → partially autonomous
5. Fix using commands           → autonomous
6. impeccable polish <target>   → autonomous
```

**Subagent boundary:** Steps 1 and 2 must complete before any subagent receives UI work. The orchestrator resolves init and shape with the user, then delegates build + fix steps.

## Subagent Prerequisite Gate

When a subagent receives UI work with `impeccable-guide` assigned, check these prerequisites before doing anything. If any fails, return `BLOCKED` immediately — do not attempt the interactive step.

| Check | If missing | Subagent action |
|---|---|---|
| PRODUCT.md exists | No product context | `BLOCKED` — "Run `impeccable init` (interactive, orchestrator must resolve with user)" |
| DESIGN.md exists and project has code | No visual system | Run `impeccable document` autonomously — this does not need user input |
| context.mjs ran this session | No loaded context | Run `node .pi/skills/impeccable/scripts/context.mjs --target <path>` autonomously |

Once prerequisites are met, the subagent can proceed with autonomous commands (distill, layout, adapt, clarify, etc.) following the execution order below.

## How Impeccable Works

### The Four Modes

Impeccable classifies every surface into one mode. Identify the mode FIRST — it changes how every command behaves:

| Mode | Surface | Design priority |
|---|---|---|
| **Operate** | Admin panels, dashboards, forms, settings, tools | Scanability, consistency, task completion. Brand lives in details, not decoration. |
| **Persuade** | Landing pages, marketing, pricing, campaigns | Earn attention and action. Expression serves conversion. |
| **Read** | Documentation, articles, guides, help | Structure for comprehension. Typography and navigation matter most. |
| **Experience** | Portfolios, galleries, showcases | Let the artifact lead. Interface recedes. |

**Choose the mode from the surface, not the product.** A tool's landing page is Persuade. A fashion house's documentation is Read. An admin panel is always Operate, regardless of the product's brand.

### Command Selection — What Fixes What

When you observe a problem or the critique identifies issues, use this table to find the right command. All commands below are autonomous.

#### Structural Problems (fix first)

| Problem | Signs | Command |
|---|---|---|
| Information overload | Too many fields, badges, metadata visible at once | `distill` |
| Hierarchy collapse | Everything has the same visual weight, no clear focus | `layout` |
| Broken responsiveness | Horizontal scroll, overlapping, truncated on mobile | `adapt` |
| Modal/overlay chaos | Modals pushing content, no internal scroll | `distill` |
| Dense without structure | High density but no grouping or separators | `layout` |

#### Content Problems (fix second)

| Problem | Signs | Command |
|---|---|---|
| Poor labels/copy | Technical jargon, confusing buttons, unclear actions | `clarify` |
| Typography noise | Too many sizes, wrong fonts, inconsistent scale | `typeset` |
| Action confusion | Destructive actions at same level as safe ones | `clarify` |
| Dev/debug leak | IPs, commands, credentials visible in production UI | `distill` |

#### Visual Problems (fix third)

| Problem | Signs | Command |
|---|---|---|
| Bland appearance | Monotone, no personality, everything looks the same | `bolder` |
| Excessive decoration | Gratuitous motion, over-styled, too loud | `quieter` |
| Weak color | Low contrast, poor readability, monotone palette | `colorize` |
| Accessibility failures | Fails WCAG, hard to read on background | `audit` |

#### Production Hardening (fix last)

| Problem | Signs | Command |
|---|---|---|
| Missing states | No loading, no empty state, no error feedback | `harden` |
| No onboarding | Blank first-run, no guidance for new users | `onboard` |
| Inconsistent components | Same action looks different across screens | `polish` |
| Repeated patterns | Code duplication that should be tokens/components | `extract` |

### Execution Order

When multiple problems exist, fix them in this order. Never skip ahead.

```
1. distill   → Remove complexity, strip to essence
2. layout    → Fix hierarchy, spacing, structure
3. adapt     → Fix responsiveness
4. clarify   → Fix copy and labels
5. typeset   → Fix typography
6. colorize / bolder / quieter → Fix visual tone
7. harden    → Add missing states
8. polish    → Final consistency pass
```

**Why this order:** Structural fixes change the surface fundamentally. Visual fixes depend on stable structure. Polishing broken structure wastes effort because the structure will change.

### The Operate Mode Rules

For admin panels, dashboards, and tools (the most common agent-built surface):

- **One font family** is usually enough. No display fonts in UI labels, buttons, or data.
- **Fixed rem scale**, not fluid. Use 1.125–1.2 ratio between steps.
- **Semantic color vocabulary**: standardize hover, focus, active, disabled, selected, loading, error, warning, success, info states.
- **Every interactive component** needs: default, hover, focus, active, disabled, loading, error states.
- **150–250ms transitions**. Motion for state changes, not decoration.
- **No modal as first thought.** Exhaust inline and progressive alternatives first.
- **Consistent affordances.** Same button shape. Same form controls. Same icon style across the entire surface.
- **Line length** 65–75ch for prose. Data tables at 120ch+ are fine.

### The Craft Floor — Absolute Bans

These are things impeccable will never accept. Do not produce them:

- Nested cards (cards inside cards).
- Kicker/eyebrow text above headings. The heading carries its own weight.
- Section numbers (01 / 02 / 03) unless the sequence itself is information.
- Gradient text. Emphasis comes from weight or size.
- Glass/blur as decoration.
- Colored `border-left` or `border-right` above 1px on cards or alerts.
- Hard offset shadows outside genuinely neobrutalist worlds.
- Unicode glyphs or emoji as icons. Icons are drawn from a real library or authored SVG.
- Monospace as costume for "technical" when it is not code or data.

## Anti-Patterns — Common Agent Mistakes

1. **Writing raw CSS to "fix" a visual problem** instead of using an impeccable command.
2. **Skipping critique** and going straight to edits without a baseline.
3. **Running `bolder` or `colorize` before `distill` and `layout`.** Visual flair on broken structure makes it worse.
4. **Improvising component structure** instead of running `distill`.
5. **Ignoring the mode.** Applying Persuade techniques to an Operate surface.
6. **Editing UI without loading craft-floor.md.**
7. **Running multiple commands without verifying between them.**
8. **Not running the detector after edits.** Run `node .pi/skills/impeccable/scripts/detect.mjs --json <target>`.
9. **Subagent attempting `init` or `shape`.** These are interactive — return `BLOCKED` instead.
10. **Subagent attempting to ask the user questions.** Subagents cannot interact with users. Return `BLOCKED` with the specific question for the orchestrator to resolve.

## Decision Gates

- If the user says no to using impeccable (orchestrator context), respect the decision.
- If you are unsure which command to use, run `impeccable critique <target>` first (scoring phase only for subagents).
- If the same surface has been critiqued and iterated more than three times without improvement, stop and report.
- If `context.mjs` reports `CONTEXT_STALE`, inform the orchestrator/user. Run `impeccable doctor` only if asked.

## Execution Steps

### As orchestrator

1. Confirm impeccable skill is available.
2. Ask the user if they want to use impeccable for this UI work.
3. Determine the scenario: A (advanced without impeccable) or B (starting fresh).
4. Resolve interactive prerequisites with the user (init, shape).
5. Delegate autonomous work (build, fix, polish) to subagents with `impeccable-guide` assigned.

### As subagent

1. Check prerequisites (Subagent Prerequisite Gate above).
2. If PRODUCT.md is missing → return `BLOCKED` immediately.
3. If DESIGN.md is missing and code exists → run `impeccable document` autonomously.
4. Run `context.mjs` for the session.
5. Identify the mode (Operate/Persuade/Read/Experience).
6. Match problems to commands using the selection table.
7. Order commands by execution order (structural → content → visual → hardening).
8. For each command: read its reference file → load craft-floor.md → execute → verify result.
9. After all commands: run the detector to catch regressions.
10. Record impeccable usage in apply.md per task/item.

## Output Contract

Return:

- Skill applied: `impeccable-guide`.
- Scenario determined: A (recovery) or B (fresh start).
- Mode identified for the target surface.
- Prerequisites verified or `BLOCKED` with specific missing interactive step.
- Commands executed in correct order with verification between each.
- Detector ran after final edits.
- Any open issues, blockers, or user decisions needed.

## References

- `skills/impeccable/SKILL.md` — canonical impeccable skill with full command reference and setup.
- `skills/impeccable/reference/operate.md` — Operate mode depth for product UI.
- `skills/impeccable/reference/craft-floor.md` — quality floor and absolute bans.
- `skills/impeccable/reference/critique.md` — UX review with heuristic scoring.
- `skills/impeccable/reference/distill.md` — stripping complexity.
- `skills/impeccable/reference/shape.md` — planning UX/UI before code.
- `skills/impeccable/reference/routing.md` — context-aware command routing.
