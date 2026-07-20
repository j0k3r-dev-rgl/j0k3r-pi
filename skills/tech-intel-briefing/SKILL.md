---
name: tech-intel-briefing
description: "Spanish-first orchestration for technology news briefings: gather only the missing brief details, delegate deep research and Markdown artifact creation to the news-researcher subagent, and convert the resulting report.md to audio when requested."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Tech Intel Briefing

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "base",
  "domains": ["news", "technology", "hardware", "ai", "analysis", "briefing", "audio", "subagent-orchestration"],
  "triggers": {
    "paths": [
      "~/.pi/agent/skills/tech-intel-briefing/SKILL.md",
      "skills/tech-intel-briefing/SKILL.md"
    ],
    "keywords": [
      "tech news",
      "technology news",
      "hardware news",
      "ai news",
      "noticiero",
      "noticiero personal",
      "briefing tech",
      "briefing tecnológico",
      "news briefing",
      "weekly roundup",
      "news roundup",
      "deep dive",
      "resumen de noticias",
      "boletín tecnológico",
      "industry briefing",
      "audio-ready news",
      "guion de noticias",
      "guion narrado",
      "noticias para audio",
      "convertir a audio",
      "qué está pasando en tech",
      "que esta pasando en tech",
      "qué hay de nuevo en hardware",
      "que hay de nuevo en hardware",
      "hazme un resumen semanal",
      "hazme un briefing",
      "explícame esta noticia",
      "explicame esta noticia"
    ]
  },
  "sdd_phases": ["explore"],
  "related_skills": [],
  "priority": 72
}
```

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `triggers.paths`: glob-like project paths that should activate this skill.
- `triggers.keywords`: user/request/code keywords that should activate this skill.
- `sdd_phases`: phases where this skill is usually useful: `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, `archive`.
- `related_skills`: skills that should be considered when this skill is active.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.

## Activation Contract

Use this skill when the user wants a Spanish-first technology news workflow that feels like a personal newsroom: adaptive intake, deep delegated research, Markdown artifacts, and optional audio generation from the final report.

Typical triggers:

- the user wants current technology, AI, hardware, semiconductor, platform, startup, Big Tech, or gaming-industry news;
- the user wants a briefing, roundup, dossier, deep explanation, or editorial synthesis instead of a raw link list;
- the user wants a narration-ready report or asks to convert the report to audio;
- the user wants the work saved under `/home/j0k3r/news/...` so multiple investigations can run concurrently.

Do not load this skill for:

- direct factual questions that are not news-oriented;
- debugging, code editing, or general implementation work;
- tiny one-line lookups when the user explicitly wants only links or headlines.

Prefer this skill over ad hoc web research when the user wants a repeatable delegated news workflow with saved artifacts and optional audio.

## Hard Rules

- Communicate with the user in Spanish first unless the user asks otherwise.
- Ask only the adaptive clarifying questions still needed to turn a vague request into a strong research brief.
- Do not use a rigid questionnaire.
- Do not ask for information the user already provided.
- Once the brief is sufficient, the orchestrator owns path assignment and delegation.
- Create or assign `/home/j0k3r/news/<topic-slug>-YYYY-MM-DD/`, adding a time or suffix only when the date directory collides.
- Launch `news-researcher` with `mode: "task"` so the orchestrator receives the completed result and can continue the workflow in the same turn.
- Do not use `background` mode for this workflow: automatic completion notification does not guarantee deterministic report validation and audio conversion.
- Keep this skill lightweight: the subagent owns detailed research methodology, source-evaluation rules, `report.md`, and `sources.md` authoring.
- Do not duplicate the subagent’s detailed editorial or source-handling rules here.
- The delegated subagent must receive the exact output directory, the requested text/audio intent, and enough brief context to work without more user questioning.
- The orchestrator must not ask the subagent to create audio.
- After task-mode completion, verify that `report.md` and `sources.md` exist before continuing.
- When audio was requested, convert the exact `report.md` to `report.mp3` in the same directory during the same orchestrator turn.
- Use these explicit `markdown_to_audio` settings unless the user requested overrides: `engine: "auto"`, `language: "es"`, `speed: 1`, `sentenceSilence: 0.3`, `noiseScale: 0.667`, `noiseW: 0.8`, `voiceQuality: "auto"`, and `mp3BitrateKbps: 64`.
- Do not rewrite, summarize, or post-process the report during audio conversion.
- After conversion, verify that `report.mp3` exists and report an explicit failure if synthesis did not complete; never announce an audio artifact that was not created.
- Preserve a clear ownership split:
  - orchestrator: intake, delegation, output directory, completion handling, audio;
  - `news-researcher`: research, synthesis, `report.md`, and `sources.md`.
- Write reusable skill content in English, but answer the user in the user’s language.

## Decision Gates

- If the request is too vague to research well, ask only the minimum clarifying questions needed to define scope, timeframe, audience, and output intent.
- If the user asks for only text, stop after the delegated Markdown artifacts are ready.
- If the user asks for audio, treat research, narration-ready Markdown, and audio conversion as one synchronous workflow with sequential steps.
- If the user wants both a readable report and audio, use the same narration-first `report.md` as the source of truth for conversion.
- If `news-researcher` fails or either Markdown artifact is missing, stop before audio generation and report the missing artifact or subagent error.
- If `markdown_to_audio` fails, preserve the Markdown artifacts and report the synthesis failure without claiming that `report.mp3` exists.
- If the requested topic is broad, shape the brief around themes or verticals rather than forcing a rigid questionnaire.
- If a same-topic same-date directory already exists, add a collision suffix or time component before delegating.

## Execution Steps

1. Interpret the request in Spanish-first newsroom terms.
2. Ask only the missing adaptive clarifying questions required to create a strong research brief.
3. Decide whether the user wants:
   - a report only;
   - a report plus audio;
   - a recurring or themed briefing.
4. When scope is sufficient, create or assign `/home/j0k3r/news/<topic-slug>-YYYY-MM-DD/`, adding a time or suffix only on collision.
5. Launch `news-researcher` with `mode: "task"` and provide:
   - the exact output directory;
   - the Spanish-first brief;
   - whether the final deliverable includes audio;
   - any timeframe, audience, topic, and source constraints from the user.
6. Wait synchronously for the task result; do not launch this workflow in background mode.
7. After completion, verify that `report.md` and `sources.md` exist in the assigned directory. Stop and report the failure if either is absent.
8. If the user requested audio, call `markdown_to_audio` on that exact `report.md` with `outputPath` set to the same directory’s `report.mp3` and explicit defaults: `engine: "auto"`, `language: "es"`, `speed: 1`, `sentenceSilence: 0.3`, `noiseScale: 0.667`, `noiseW: 0.8`, `voiceQuality: "auto"`, and `mp3BitrateKbps: 64`.
9. Wait for synthesis and MP3 conversion to finish, then verify that `report.mp3` exists. If generation fails, report the error and preserve the Markdown artifacts.
10. Return only paths for artifacts that were actually verified, plus a concise Spanish summary of what is ready.

## Output Contract

Return a Spanish-first orchestration result that includes:

- the agreed topic or scope;
- the assigned output directory;
- that `news-researcher` ran synchronously in task mode;
- the completed and verified artifacts:
  - `report.md`;
  - `sources.md`;
  - `report.mp3` when requested and generated;
- when applicable, an explicit synthesis error if audio was requested but could not be generated;
- any minimal next action for the user.

When the user asked for audio, make clear that the audio comes from the exact generated `report.md` without rewriting it.

## References

- `~/.pi/agent/skills/skill-authoring/SKILL.md` — canonical global skill authoring guidance.
- `~/.pi/agent/skills/workflow-triage/SKILL.md` — workflow selection and policy-sensitive routing guidance.
- `~/.pi/agent/extensions/skill-registry/templates/skill-template.md` — canonical skill template structure.
