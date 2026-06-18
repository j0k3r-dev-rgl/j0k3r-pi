---
name: git-memory-release
description: "record git commit, release tag, and changelog provenance in Pi Memory only when Memory git is enabled, using commit/changelog/release memory tools."
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
  "domains": ["git-memory", "commit-memory", "release-memory", "changelog-memory", "provenance"],
  "triggers": {
    "paths": [
      ".pi/memory.json",
      "extensions/memory/src/commit-changelog.ts",
      "extensions/memory/src/tools.ts",
      "extensions/memory/test/**"
    ],
    "keywords": [
      "commit memory",
      "record this commit in memory",
      "record commit in memory",
      "git memory",
      "commit record",
      "changelog memory",
      "memory_commit_record_add",
      "memory_changelog_entry_add",
      "memory_commit_changelog_link",
      "memory_commit_changelog_search",
      "memory_release_candidates_search",
      "memory_release_record_add",
      "release candidates",
      "release record",
      "release impact memory",
      "change_type",
      "release_impact",
      "commit provenance memory",
      "release provenance memory",
      "tag memory"
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

Use this skill only when the user asks to record or query git commit, release tag, changelog, or release provenance in Pi Memory, or when the base Git workflow has verified `.pi/memory.json` contains `git.enabled=true` and wants optional Memory provenance. Use it after an implementation is validated and the user wants durable commit/changelog/release memory.

Do not use this skill for ordinary Git commits/tags/changelog work when Memory git is disabled or not requested; use `git-operations-release` instead. Do not use it for ordinary memory saves unrelated to git/release provenance; use `persistent-memory` instead. Do not use it to bypass `AGENTS.md` git policy.

## Hard Rules

- Never run `git commit`, `git tag`, `git push`, branch creation, rebase, or other git write operations unless the user explicitly requests that exact git operation in the current conversation.
- Passing tests, finishing an SDD phase, or preparing memory records is not permission to commit, tag, or push.
- Before any user-requested commit/tag, run `git status --short` and inspect enough diff/log context to record accurate metadata.
- Do not store raw full diffs, secrets, private keys, tokens, or sensitive logs in memory records.
- Prefer compact provenance: subject, commit hash, branch, author/date when available, changed file list, diffstat summary, validation summary, and links to related memories or changelog entries.
- Use `memory_commit_record_add` for durable commit records. Include `change_type` and `release_impact` when known.
- Use `change_type: "sync"` with `release_impact: "none"` for cloud/sync/provenance-only commits that should not appear as release-impacting changes.
- Use `memory_changelog_entry_add` for changelog source data only when useful. Include `version`, `section`, `bullets`, and `release_tag` when a tag/version exists, but do not treat this as the final changelog writer.
- `source_commit_ids` on `memory_changelog_entry_add` is metadata only. It must not be treated as a release/tag link and must not create `memory_links` automatically.
- Use `memory_release_candidates_search` when preparing a tag/release to retrieve release-impacting commit records that are not yet linked to a release/tag record. This tool is read-only and does not generate changelog text.
- Use `memory_release_record_add` after a tag/release decision to store the release/tag record and explicitly create `derived_from` links to the selected commits. This tool stores provenance only; it must not generate or edit `CHANGELOG.md`.
- Use `memory_commit_changelog_link` to connect commit records, changelog entries, PRD/SDD memories, decision memories, or other supporting memories only when the relationship is explicit and useful. Prefer `derived_from` from release/tag or changelog records to source commit records, and `supports` for evidence/validation memories.
- Use `memory_commit_changelog_search` before creating release notes or changelog updates so existing commit/changelog/release records are reused instead of duplicated.
- If `.pi/memory.json` does not have `git.enabled=true`, do not use Memory git tools. Explain that git memory tools are disabled and continue the base Git workflow with `git-operations-release` unless the user wants to enable the Memory Extension git module.
- Treat `git.sync.cloud`, `git.sync.export`, and `git.sync.import` as configuration flags only. `git.sync.export/import` control whether configured memory export/import includes git memory records; they do not authorize Git commits, tags, pushes, cloud calls, or automatic changelog generation by themselves.

## Decision Gates

- If the user requests a real git commit/tag/push, confirm the exact operation and scope unless it is already unambiguous.
- If the worktree has unrelated dirty changes, stop and ask whether to commit/stash/discard or continue with a mixed worktree before git write operations.
- If `change_type` or `release_impact` is unclear, infer conservatively from the change and ask when the classification materially affects a release.
- If generating or updating a public changelog, confirm the target version/tag and sections when they are not obvious. The agent writes or edits the changelog using memory context; memory tools only store/query provenance.
- If the user is not making a release/tag yet, record commits independently and do not create changelog-to-commit or release-to-commit links. Accumulate unlinked release-impacting commits for a later release/tag aggregation.
- If memory tools fail because git memory is disabled, stop Memory provenance work and use `memory-configuration` before editing `.pi/memory.json` only when the user explicitly wants to enable it.
- If deciding what should be saved to memory beyond git/release provenance, also apply `persistent-memory`.

## Execution Steps

1. Identify whether this is Memory provenance work. If it is ordinary Git commit/tag/changelog work, switch to `git-operations-release`.
2. Apply the git policy gate: no commit/tag/push without explicit current-conversation permission.
3. Inspect `git status --short`; if needed, inspect `git diff --stat`, `git diff --name-only`, or `git log` for accurate metadata.
4. Verify `.pi/memory.json` has `git.enabled=true` before using commit/changelog/release memory tools; otherwise skip Memory provenance.
5. Classify the change:
   - `change_type`: `fix`, `feature`, `chore`, `docs`, `refactor`, `test`, `sync`, or `other`.
   - `release_impact`: `major`, `minor`, `patch`, or `none`.
6. After a user-approved commit exists, record it with `memory_commit_record_add` using the real commit hash and compact metadata.
7. When preparing a tag/release, call `memory_release_candidates_search` to retrieve release-impacting commit records that are not already linked to a release/tag record.
8. The agent uses those records to reason about and manually draft/update `CHANGELOG.md` or release notes; tools must not auto-generate or auto-edit changelog content.
9. After the user approves the tag/release grouping, call `memory_release_record_add` to store the release/tag record and create explicit `derived_from` links to the selected commits.
10. When changelog source bullets are useful as memory, create or update changelog memory with `memory_changelog_entry_add`; treat any `source_commit_ids` as metadata until a release/tag aggregation is explicitly approved.
11. Link other supporting records only when the relationship is explicit and useful for future provenance.
12. Search existing records with `memory_commit_changelog_search` before drafting changelog updates or release summaries.
13. Report what was recorded, what was intentionally not recorded, validations observed, and any remaining git/manual actions.

## Output Contract

Return:

- Skill applied: `git-memory-release`.
- Whether any git write operation was requested and whether it was executed or explicitly not executed.
- Git status/diff/log evidence inspected.
- Commit records created or found, including memory IDs when available.
- Release candidate commits found, including which were selected or skipped.
- Release/tag records created or found, including memory IDs when available.
- Changelog entries created or found, including memory IDs when available.
- Links created between commits/release/changelog/supporting memories.
- `change_type` and `release_impact` classifications used, with uncertainty called out.
- Validation commands/results referenced.
- Risks, skipped memory, or open decisions.

## References

- `AGENTS.md` — git commit/push policy, dirty worktree rule, TDD, memory checkpoint policy.
- `skills/persistent-memory/SKILL.md` — durable memory save policy.
- `skills/memory-configuration/SKILL.md` — `.pi/memory.json` and `git.enabled` / `git.sync.*` configuration.
- `extensions/memory/src/commit-changelog.ts` — commit/changelog memory helper implementation.
- `extensions/memory/src/tools.ts` — memory commit/changelog tool contracts.
