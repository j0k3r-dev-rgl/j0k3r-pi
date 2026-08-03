---
name: cognitive-doc-design
description: "design or revise guides, READMEs, RFCs, onboarding, architecture, PR descriptions, and review-facing documentation to reduce cognitive load."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.2"
---

# Cognitive Doc Design

## Registry Contract

Use this block as the machine-readable source for `.pi/skill-registry.json` generation. Keep it valid JSON.

```json
{
  "category": "quality",
  "domains": ["documentation", "cognitive-load", "technical-writing", "review-experience"],
  "triggers": {
    "paths": [
      "README*.md",
      "docs/**/*.md",
      "rfcs/**/*.md",
      "adr/**/*.md",
      ".github/pull_request_template*.md",
      ".github/PULL_REQUEST_TEMPLATE/**/*.md"
    ],
    "keywords": [
      "documentation",
      "technical documentation",
      "README",
      "guide",
      "RFC",
      "ADR",
      "onboarding",
      "architecture document",
      "PR description",
      "review notes",
      "cognitive load",
      "progressive disclosure",
      "make this easier to scan"
    ]
  },
  "sdd_phases": [],
  "related_skills": ["comment-writer"],
  "priority": 60
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

Use this skill when creating or revising documentation that readers must understand quickly, retain, follow, or verify. Typical surfaces include PR descriptions, review notes, contributor guides, maintainer guides, READMEs, RFCs, ADRs, architecture documents, workflows, and onboarding material.

Load it especially when a document feels long, dense, difficult to scan, or forces reviewers to reconstruct intent. Do not load it for code-only changes, private scratch notes, or short conversational comments where `comment-writer` is the more specific skill.

## Hard Rules

- Lead with the decision, action, or outcome. Put supporting context afterward.
- Use progressive disclosure: start with the happy path, then add details, edge cases, and references.
- Chunk related information into short sections and keep flat lists focused.
- Use headings, labels, callouts, and summaries to make location and purpose obvious.
- Prefer recognition over recall through tables, checklists, examples, and templates.
- Design review-facing docs so reviewers can verify intent without reconstructing the complete history.
- Preserve a repository-provided template when it is stronger or more specific than the default structure below.
- Do not add structure that does not help the intended reader complete or review the task.

Default documentation shape:

```markdown
# <Outcome-oriented title>

<One paragraph: what changed, who it helps, and why it matters.>

## Quick path

1. <First action>
2. <Second action>
3. <Verification or expected result>

## Details

| Topic | Decision |
|-------|----------|
| <area> | <concise explanation> |

## Checklist

- [ ] <Reader can confirm this>
- [ ] <Reader can confirm that>

## Next step

<Link or action that continues the workflow.>
```

For PR and review documentation:

- State what to review first.
- State what is intentionally out of scope.
- Link previous and next PRs when work is chained.
- Keep each section focused on one decision or unit of work.
- Use checklists for acceptance criteria and verification.

## Decision Gates

- If the repository provides a documentation or PR template, use it as the primary structure and apply this skill within that constraint.
- If the requested output is a short human-facing reply rather than long-form documentation, also consider or prefer `comment-writer`.
- If the audience, desired action, or source of truth is unclear and materially changes the document, ask before drafting.
- If restructuring would change technical meaning, requirements, or policy rather than presentation alone, preserve the original meaning and request confirmation.

## Execution Steps

1. Identify the audience, desired action, and outcome the document must communicate.
2. Find the decision, result, or quick path and move it to the beginning.
3. Group supporting context into small, clearly labeled sections.
4. Replace memory-heavy prose with a table, checklist, example, or template where useful.
5. For review-facing docs, make scope, review order, acceptance criteria, and exclusions explicit.
6. Remove repetition and structure that does not help the reader act or verify.
7. Validate the final document against any repository template and scan it from the target reader's perspective.

Useful inspection commands when applicable:

```bash
# Check markdown files changed in the current branch
git diff --name-only -- '*.md'

# Inspect PR changed-line count for cognitive load
gh pr view <PR_NUMBER> --json additions,deletions,changedFiles
```

## Output Contract

Return:

- Skill applied: `cognitive-doc-design`.
- Intended audience and outcome.
- Structure or cognitive-load improvements made.
- Repository template followed, or confirmation that none applied.
- Meaning, policy, or scope questions that remain unresolved.
- Validation performed, or why it was not applicable.

## References

- `extensions/skill-registry/templates/skill-template.md` — canonical Pi skill structure and registry contract.
- Repository-provided README, documentation, RFC, ADR, or pull-request templates — primary local formatting constraints when present.
