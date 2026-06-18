---
name: git-memory-release
description: "record git commits, tags, release notes, and changelog provenance in Pi Memory using commit/changelog memory tools while preserving explicit git-operation approval rules."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Git Memory Release

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["git", "commits", "tags", "release-notes", "changelog", "memory", "provenance"],
  "triggers": {
    "paths": [
      "CHANGELOG.md",
      "RELEASE_NOTES.md",
      "package.json",
      "openspec/changes/**",
      ".pi/memory.json",
      "extensions/memory/src/commit-changelog.ts",
      "extensions/memory/src/tools.ts",
      "extensions/memory/test/**"
    ],
    "keywords": [
      "commit memory",
      "git memory",
      "commit record",
      "changelog memory",
      "memory_commit_record_add",
      "memory_changelog_entry_add",
      "memory_commit_changelog_link",
      "memory_commit_changelog_search",
      "release impact",
      "change_type",
      "release_impact",
      "changelog",
      "release notes",
      "tag release",
      "git tag",
      "commit provenance"
    ]
  },
  "sdd_phases": ["task", "apply", "verify", "archive"],
  "related_skills": [
    "persistent-memory",
    "memory-configuration",
    "workflow-triage"
  ],
  "priority": 85
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

Use this skill when the user asks to create, prepare, audit, or record git commits, git tags, release notes, changelog entries, release impact metadata, or provenance links in Pi Memory. Use it after an implementation is validated and the user wants durable commit/changelog memory, and when updating changelog content from stored commit/changelog records.

Do not use this skill for ordinary memory saves unrelated to git/release provenance; use `persistent-memory` instead. Do not use it to bypass `AGENTS.md` git policy.

## Hard Rules

- Never run `git commit`, `git tag`, `git push`, branch creation, rebase, or other git write operations unless the user explicitly requests that exact git operation in the current conversation.
- Passing tests, finishing an SDD phase, or preparing memory records is not permission to commit, tag, or push.
- Before any user-requested commit/tag, run `git status --short` and inspect enough diff/log context to record accurate metadata.
- Do not store raw full diffs, secrets, private keys, tokens, or sensitive logs in memory records.
- Prefer compact provenance: subject, commit hash, branch, author/date when available, changed file list, diffstat summary, validation summary, and links to related memories or changelog entries.
- Use `memory_commit_record_add` for durable commit records. Include `change_type` and `release_impact` when known.
- Use `change_type: "sync"` with `release_impact: "none"` for cloud/sync/provenance-only commits that should not appear as release-impacting changes.
- Use `memory_changelog_entry_add` for release/changelog bullets. Include `version`, `section`, `bullets`, and `release_tag` when a tag/version exists.
- Use `memory_commit_changelog_link` to connect commit records, changelog entries, PRD/SDD memories, decision memories, or other supporting memories. Prefer `derived_from` from changelog entry to source commit records, and `supports` for evidence/validation memories.
- Use `memory_commit_changelog_search` before creating release notes or changelog updates so existing commit/changelog records are reused instead of duplicated.
- If `.pi/memory.json` does not have `git.enabled=true`, do not silently proceed. Explain that git memory tools are disabled and ask whether to enable the Memory Extension git module.
- Treat `git.sync.cloud`, `git.sync.export`, and `git.sync.import` as configuration/intent flags only. They do not authorize cloud calls, exports, imports, commits, tags, or pushes by themselves.

## Decision Gates

- If the user requests a real git commit/tag/push, confirm the exact operation and scope unless it is already unambiguous.
- If the worktree has unrelated dirty changes, stop and ask whether to commit/stash/discard or continue with a mixed worktree before git write operations.
- If `change_type` or `release_impact` is unclear, infer conservatively from the change and ask when the classification materially affects a release.
- If generating or updating a public changelog, confirm the target version/tag and sections when they are not obvious.
- If memory tools fail because git memory is disabled, use `memory-configuration` before editing `.pi/memory.json`.
- If deciding what should be saved to memory beyond git/release provenance, also apply `persistent-memory`.

## Execution Steps

1. Identify whether the task is only recording memory/changelog provenance or also performing a git operation.
2. Apply the git policy gate: no commit/tag/push without explicit current-conversation permission.
3. Inspect `git status --short`; if needed, inspect `git diff --stat`, `git diff --name-only`, or `git log` for accurate metadata.
4. Verify `.pi/memory.json` enables git memory when using commit/changelog memory tools.
5. Classify the change:
   - `change_type`: `fix`, `feature`, `chore`, `docs`, `refactor`, `test`, `sync`, or `other`.
   - `release_impact`: `major`, `minor`, `patch`, or `none`.
6. After a user-approved commit exists, record it with `memory_commit_record_add` using the real commit hash and compact metadata.
7. When release notes or changelog bullets are prepared, create or update changelog memory with `memory_changelog_entry_add`.
8. Link related records using `memory_commit_changelog_link` so future agents can trace changelog entries back to commits, validations, SDD artifacts, and decisions.
9. Search existing records with `memory_commit_changelog_search` before drafting changelog updates or release summaries.
10. Report what was recorded, what was intentionally not recorded, validations observed, and any remaining git/manual actions.

## Output Contract

Return:

- Skill applied: `git-memory-release`.
- Whether any git write operation was requested and whether it was executed or explicitly not executed.
- Git status/diff/log evidence inspected.
- Commit records created or found, including memory IDs when available.
- Changelog entries created or found, including memory IDs when available.
- Links created between commits/changelog/supporting memories.
- `change_type` and `release_impact` classifications used, with uncertainty called out.
- Validation commands/results referenced.
- Risks, skipped memory, or open decisions.

## References

- `AGENTS.md` — git commit/push policy, dirty worktree rule, TDD, memory checkpoint policy.
- `skills/persistent-memory/SKILL.md` — durable memory save policy.
- `skills/memory-configuration/SKILL.md` — `.pi/memory.json` and `git.enabled` / `git.sync.*` configuration.
- `extensions/memory/src/commit-changelog.ts` — commit/changelog memory helper implementation.
- `extensions/memory/src/tools.ts` — memory commit/changelog tool contracts.
