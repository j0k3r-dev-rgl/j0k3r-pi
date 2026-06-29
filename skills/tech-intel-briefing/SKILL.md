---
name: tech-intel-briefing
description: "Create high-context technology news briefings and personal newsroom-style reports by gathering from web, YouTube, discussions, and research, then synthesizing with context, actors, impact, confidence, and editorial analysis."
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
  "domains": ["news", "technology", "hardware", "ai", "analysis", "briefing", "editorial"],
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
      "dossier",
      "deep dive",
      "resumen de noticias",
      "boletín tecnológico",
      "personal tech news",
      "industry briefing",
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

Use this skill when the user wants curated technology news, a personal newsroom experience, or a deeper explanation of ongoing technology developments rather than a bare search result list.

Typical triggers:

- the user asks for tech, AI, hardware, semiconductor, gadgets, platform, startup, Big Tech, or gaming-industry news;
- the user asks for a daily briefing, weekly roundup, trend watch, dossier, or personal news anchor style response;
- the user wants context, impact, background, confidence levels, industry framing, or “why this matters” analysis;
- the user wants multiple sources compared instead of a single article summary;
- the user wants a reading-ready or audio-ready narrative briefing.

Do not load this skill for:

- direct factual questions that are not news-oriented;
- debugging, code editing, or implementation work;
- tiny one-line news lookups when the user explicitly asks for only links or headlines.

Prefer this skill over a generic search-only response when the user wants explanation, synthesis, editorial structure, or a recurring personal-news style format.

## Hard Rules

- Act as a technology editor and analyst, not as a raw link dump.
- Prioritize explanatory writing over ultra-short summaries unless the user explicitly asks for brevity.
- Always distinguish clearly between:
  - confirmed facts;
  - likely interpretation;
  - rumor, speculation, or weak-signal chatter.
- When multiple sources disagree, say so explicitly and identify which source appears strongest.
- Prefer stronger-source ordering for technology news:
  1. official announcements, company posts, filings, and primary materials;
  2. reputable reporting and web coverage;
  3. expert video analysis and specialist channels;
  4. discussion sources for reaction, practitioner perspective, and edge cases;
  5. research sources for technical depth and historical grounding.
- Never present a YouTube creator’s claim or discussion-thread theory as confirmed fact without corroboration.
- Always explain why the news matters to at least one audience when relevant:
  - consumers;
  - developers;
  - enterprises;
  - investors/industry;
  - infrastructure/hardware ecosystem.
- Include historical or market context when it materially improves understanding.
- Name the key actors and briefly explain who they are when a general user may not know them.
- Avoid sensational language unless the sourced evidence genuinely supports it.
- When source quality is weak, say the evidence is weak.
- For broad requests, group stories into coherent themes instead of mixing everything together.
- Write reusable skill content in English, but answer the user in the user’s language.

## Decision Gates

- If the user wants only headlines or a very short digest, compress the structure but still retain source quality and confidence cues.
- If the user asks for a specific vertical such as hardware, AI, semiconductors, Apple, gaming, or enterprise software, narrow the source search and organize by that sector.
- If the user asks for a source-limited view such as “only Hacker News” or “only YouTube,” honor that constraint and call out the resulting blind spots.
- If the user wants audio later, prefer an audio-ready narrative format with smoother transitions and fewer dense bullets.
- If the user asks for a recurring format, keep section names and ordering stable across future answers when practical.

## Execution Steps

1. Identify the scope:
   - general tech;
   - AI;
   - hardware;
   - semiconductors;
   - consumer devices;
   - startups/Big Tech;
   - gaming tech;
   - another specific vertical.
2. Determine the briefing mode:
   - `flash` for short but informed updates;
   - `briefing` for the default richer editorial answer;
   - `deep-dive` for one or a few major stories with substantial context;
   - `weekly-roundup` for trend-oriented recaps;
   - `audio-ready` for narration-friendly continuous prose.
3. Gather from multiple relevant sources when available:
   - web/news for confirmation;
   - YouTube for current topic detection and expert explanation;
   - discussion sources for practitioner reaction;
   - research sources for technical grounding when useful.
4. Rank sources by reliability and recency.
5. Cluster findings into themes or top stories.
6. For each important story, synthesize using the strongest evidence first.
7. Explicitly separate confirmed facts from interpretation and rumor.
8. Add context on the actors, background, and why the development matters.
9. End with a concise executive recap or “what to watch next” section.

## Output Contract

Return a structured technology-news briefing using the richest format appropriate for the user’s request.

Preferred structure for `briefing` or `deep-dive` mode:

- Headline or section title.
- What happened.
- Context and background.
- Who the key actors are.
- Why it matters.
- What different sources are saying.
- Confirmed vs likely vs speculative.
- Editorial reading / analyst take.
- What to watch next.

For broader multi-story answers, add:

- Top stories list.
- Grouping by theme.
- Short executive summary at the end.

For `audio-ready` mode:

- prefer smoother narrative transitions;
- reduce rigid bullet density;
- use complete spoken-style sentences;
- keep the text pleasant to listen to without losing analytical content.

Always include:

- source-quality cues when relevant;
- uncertainty disclosures when evidence is partial;
- enough detail that the user can understand the story without opening every source.

## References

- `~/.pi/agent/skills/skill-authoring/SKILL.md` — canonical global skill authoring guidance.
- `~/.pi/agent/skills/workflow-triage/SKILL.md` — workflow selection and policy-sensitive routing guidance.
- `~/.pi/agent/extensions/skill-registry/templates/skill-template.md` — canonical skill template structure.
