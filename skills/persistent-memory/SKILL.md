---
name: persistent-memory
description: Operate the Pi Memory Extension as the agent persistent brain. Use when persistent context or memory policy is needed, while avoiding redundant recalls when startup context, loaded skill content, or conversation context is already sufficient.
---

# Persistent Memory

## Registry Contract

```json
{
  "category": "workflow",
  "domains": ["memory", "project-context", "session-summary", "persistent-brain"],
  "triggers": {
    "paths": [
      ".pi/memory.json",
      ".pi/extensions/memory/**",
      ".pi/skills/persistent-memory/SKILL.md"
    ],
    "keywords": [
      "memory",
      "remember",
      "recall",
      "project profile",
      "session summary",
      "persistent context",
      "durable decision"
    ]
  },
  "sdd_phases": ["explore", "proposal", "spec", "design", "task", "apply", "verify", "archive"],
  "related_skills": ["sdd-workflow"],
  "priority": 80
}
```

Use this skill to operate the Pi Memory Extension deliberately: recall context when useful, save only durable knowledge, keep the project brain clean, and avoid storing sensitive or low-value details.

## Core rules

- Treat memory as a curated brain, not a transcript dump.
- Search/recall deliberately when persistent context is missing, stale, ambiguous, or decision-critical; skip memory for obvious tiny tasks and avoid redundant recalls when context is already loaded.
- Save less, but save better.
- Never store secrets, tokens, passwords, private keys, private personal data, or raw logs.
- Prefer current project memory plus general preferences and global rules.
- Do not use other projects unless the user explicitly asks or cwd is home.
- `memory_search` returns compact candidates; use `memory_get` only for selected full records.
- Archive or supersede obsolete memory; do not delete normal memories.
- Current user instruction beats active memory. If the user contradicts memory, follow the user and ask whether to update, archive, or supersede the old memory.
- Durable memories should be written in lowercase english; audited prompts may stay in their original language.

## When to load this skill

Load this skill when detailed memory policy is needed and the policy is not already available in the current conversation. Good triggers:

- The task is substantial, ambiguous, multi-step, risky, or affects more than one file and memory policy may matter.
- You need persistent project context that is not already present in startup brain context or the conversation.
- You need to decide whether something should be saved to memory.
- You need to update or inspect `project_profile`.
- You need to migrate, consolidate, import, export, or audit memory.
- The user asks about remembered context, previous decisions, project state, or todos.
- You are ending substantial work and need to decide what, if anything, to save.

Do not load this skill for:

- greetings;
- simple questions unrelated to project memory;
- obvious typo fixes with no durable context needed;
- one-off temporary reasoning.

## Recall policy

Do not call recall mechanically. First ask: do startup brain context, loaded skill content, and the current conversation already contain the needed memory? If yes, do not call recall again.

Use the narrowest recall moment only when it would add missing or fresher persistent context:

- start of a substantial task with insufficient context: `memory_recall(context="before_task", query="...")`
- before editing only when architecture/conventions/constraints are unknown or stale: `memory_recall(context="before_edit", query="...")`
- before tests/build/lint only when commands or validation conventions are unknown: `memory_recall(context="before_test", query="...")`
- before a user-requested commit only when commit/check policy or open todos are uncertain: `memory_recall(context="before_commit", query="...")`; this recall context is not permission to commit
- review/risk check when prior decisions, bugs, or constraints may affect judgment: `memory_recall(context="review", query="...")`
- session end when deciding whether to save durable outcomes: `memory_recall(context="session_end", query="...")`

Aliases accepted by the tool: `task`, `edit`, `test`, `commit`, `end`. The `commit` alias means memory context for a commit the user explicitly requested; it must not trigger a commit by itself.

If compact recall returns candidate IDs that seem important, call `memory_get` only for those IDs. Avoid repeated recall calls for the same task phase unless the objective changes or earlier context is clearly insufficient.

## Save policy

Save memory only when it is durable, actionable, atomic, recoverable, current, and non-sensitive.

Memory budget:

- For a normal task, save at most 1-3 durable memories.
- If there are many small facts, prefer one session summary or a compact `project_profile` update.
- Do not save every intermediate step.

Good automatic candidates:

- confirmed project decisions, workflow rules, policies, or constraints that will affect future agents;
- verified project commands, with command, cwd, result, and verification date;
- durable bugs or todos that remain open;
- reusable learnings from implementation or tests;
- meaningful progress after substantial work;
- session summaries;
- conservative `project_profile` updates.

Ask before saving:

- architectural decisions;
- global or general user preferences;
- large `project_profile` rewrites;
- anything that contradicts existing memory;
- policy changes that affect future agents, including workflow rules about when agents may investigate, implement, commit, or persist artifacts.

Confidence:

- Use `confidence=1.0` only for explicit user preferences, confirmed decisions, or facts observed in code/tests.
- Use lower confidence for agent inferences until confirmed.
- If confidence is low or the implication is important, ask before saving.

Contradictions:

- If a new memory would contradict an active memory, do not overwrite silently.
- Show or mention both versions briefly.
- Ask the user which one is current.
- If confirmed, mark the old memory as `superseded` or archive it with a reason.

Commands:

- Save project commands only after they were executed successfully or explicitly confirmed by the user.
- Include the command, cwd, result/exit code when known, and last verified date.
- Do not save guessed commands as verified commands.

Do not save:

- secrets or credentials;
- raw tool outputs or long logs;
- transient thoughts like “currently checking x”;
- speculative conclusions presented as facts;
- duplicates with different wording;
- trivial progress with no future value.

## Scope policy

- `project`: project decisions, architecture, commands, bugs, todos, progress, project profile.
- `general`: personal user preferences across projects.
- `global`: shared/system/team-level rules.

When saving project memory, let the tool resolve project identity. Never provide `project_id` or `project_name` manually.

## Project profile policy

`project_profile` is the living executive summary of the project. Keep it short, current, and useful.

It should contain:

- stack;
- architecture summary;
- commands;
- conventions;
- active decisions;
- risks;
- current work;
- important directories.

Rules:

- Prefer updating existing profile over creating duplicates.
- Avoid append-only growth forever; if it gets noisy or too long, rewrite/consolidate instead of adding more blocks.
- Ask for confirmation before large semantic rewrites.
- Treat the profile as a dashboard, not a history log.
- Use `memory_project_profile` to inspect or maintain it.

## Consolidation policy

Consolidation is powerful but risky.

Default behavior:

1. Run dry-run first: `memory_consolidate(dry_run=true)`.
2. Inspect candidate groups.
3. Apply only when the memories are truly duplicate or safely mergeable.
4. Do not consolidate contradictory memories.
5. Prefer links/supersedes over deletion.

Use similarity mode cautiously:

```json
{"similarity": true, "dry_run": true}
```

## Migration policy

Use migration when project memories may be split across aliases from folder, git remote, git root, or `.pi/memory.json`.

1. Run dry-run first: `memory_migrate_project(dry_run=true)` or `/memory-migrate-project`.
2. Verify the canonical project name and project id.
3. Apply only if canonical identity is correct: `/memory-migrate-project --apply`.

Use the same dry-run-first rule for imports with possible conflicts: inspect the dry-run/conflict report before merge/apply.

## Session-end policy

At the end of meaningful discussion or substantial work, run a decision checkpoint and summarize. This is a conversational/memory checkpoint, not a Git commit:

- what changed;
- confirmed decisions made;
- workflow/policy rules established;
- progress;
- validations;
- open todos;
- accepted risks;
- reusable learnings.

Before closing a substantial session or after the user confirms an important direction, check whether there is:

- a confirmed decision worth saving separately;
- a durable workflow rule or project policy;
- a reusable learning;
- an open todo;
- a command that was verified;
- a `project_profile` change.

Important decisions/learnings/todos should be saved as separate durable memories when appropriate, but do not save everything automatically. If a memory would change future agent behavior, save it only after the user confirms that policy decision.

## Response style

When using memory, be transparent but concise:

- mention that memory was recalled when it affects the answer;
- do not dump memory contents unless useful;
- state what was saved or not saved and why;
- if unsure whether to save, ask the user.
- When an answer relies on important memory, briefly say “according to project memory...” or equivalent; do not overdo this for every small detail.
