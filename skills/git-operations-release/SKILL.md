---
name: git-operations-release
description: "perform and guide git commits, tags, release preparation, and changelog updates without requiring Pi Memory, while optionally using git-memory-release only when memory git is enabled."
license: Apache-2.0
metadata:
  author: j0k3r
  version: "1.0"
---

# Git Operations Release

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "workflow",
  "domains": ["git", "commits", "tags", "release-notes", "changelog", "versioning"],
  "triggers": {
    "paths": [
      "CHANGELOG.md",
      "RELEASE_NOTES.md",
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "openspec/changes/**"
    ],
    "keywords": [
      "git commit",
      "commit changes",
      "commit everything",
      "create commit",
      "prepare commit",
      "git tag",
      "tag release",
      "create tag",
      "release tag",
      "prepare release",
      "release notes",
      "update changelog",
      "changelog",
      "version bump",
      "release version"
    ]
  },
  "sdd_phases": ["task", "apply", "verify", "archive"],
  "related_skills": [
    "git-memory-release",
    "workflow-triage",
    "persistent-memory"
  ],
  "priority": 90
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

Use this skill when the user asks to commit, tag, prepare a release, update a changelog, create release notes, inspect git status for release readiness, or decide what should go into a git commit/tag. This is the default git/release skill and must work even when Pi Memory git tools are disabled.

Use `git-memory-release` only as an optional companion after verifying `.pi/memory.json` has `git.enabled=true` or after the user explicitly asks to record git/release provenance in Memory. If git memory is disabled, continue the Git workflow normally without Memory tools.

## Hard Rules

- Never run `git commit`, `git tag`, `git push`, branch creation, rebase, or other git write operations unless the user explicitly requests that exact operation in the current conversation.
- Passing tests, finishing implementation, or completing SDD verification is not permission to commit, tag, or push.
- Before a user-requested commit or tag, run `git status --short`.
- If the worktree has unrelated dirty changes, ask whether to include, exclude, stash, discard, or continue with mixed scope before git write operations.
- Do not include secrets, tokens, private keys, or sensitive logs in commit messages, changelogs, release notes, or command output summaries.
- Commit messages should be concise and conventional when possible, for example `feat(scope): summary`, `fix(scope): summary`, `docs(scope): summary`, `chore(scope): summary`.
- Tags/releases should be explicit: confirm the tag name/version when it is not obvious.
- The agent writes changelog/release note content using inspected code, git history, validation results, and optional memory context. Git tools do not generate changelog content automatically.
- Do not require Memory for normal Git operations. Memory is an enhancement, not a prerequisite.

## Decision Gates

- If the user says “commit everything”, confirm inclusion of unrelated dirty changes only when unrelated scope is visible or risky.
- If the user asks for a tag/release and the version/tag is missing, ask for the tag/version or infer only when project conventions make it unambiguous.
- If a changelog update is requested but target version/section is unclear, ask a concise question.
- Before using Memory git tools, inspect `.pi/memory.json` or use current context to verify `git.enabled=true`. If disabled, mention that Memory provenance is skipped unless the user wants to enable it.
- If a release/tag should include only selected commits, inspect `git log` or use `memory_release_candidates_search` only when Memory git is enabled.

## Execution Steps

1. Identify the requested Git/release action: commit, tag, push, changelog update, release notes, or read-only review.
2. Apply the Git permission gate: no git write operation without explicit current-conversation permission.
3. Run `git status --short` before commit/tag operations and inspect enough diff/log context for an accurate message or release summary.
4. Run or reference relevant validation before commit/tag when available.
5. For commits, stage exactly the approved scope and create a concise message.
6. For changelog/release notes, draft or edit the file directly using inspected changes and validation context; do not rely on a tool to auto-generate final text.
7. For tags/releases, confirm tag/version and selected commits before creating the tag.
8. Optional Memory integration:
   - If `.pi/memory.json` has `git.enabled=true`, load/apply `git-memory-release`.
   - After a commit, optionally record the current HEAD with `memory_record_current_commit` using rich context for future release notes.
   - Use `memory_commit_record_add` only when recording an explicit non-HEAD commit or when all commit metadata is already supplied.
   - Before a tag/release, optionally query `memory_release_candidates_search` and `memory_release_notes_preview` to gather release context.
   - The agent still drafts/edits changelog content manually; Memory preview is context only.
   - After an approved tag/release grouping, optionally record it with `memory_release_record_add`.
   - If git memory is disabled, skip these steps and state that Memory provenance was not recorded.
9. Report actions taken, commit/tag hashes or names, validation, skipped Memory integration, and remaining manual steps.

## Output Contract

Return:

- Skill applied: `git-operations-release`.
- Requested Git operation and whether it was executed or intentionally not executed.
- Git status/diff/log evidence inspected.
- Commit message, commit hash, tag name, or changelog path updated when applicable.
- Validation commands/results used.
- Whether `git-memory-release` was applied, skipped because `git.enabled` is false, or not needed.
- Risks, unrelated dirty changes, or open decisions.

## References

- `AGENTS.md` — git commit/push policy and dirty worktree rule.
- `skills/git-memory-release/SKILL.md` — optional Memory provenance workflow for commits/tags/releases.
- `skills/persistent-memory/SKILL.md` — durable memory policy when non-git project memories are relevant.
