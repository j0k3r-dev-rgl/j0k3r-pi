---
name: comment-writer
description: "write or revise warm, direct, constructive collaboration messages. Use when drafting pull request feedback, issue replies, code-review comments, GitHub comments, or Slack and Discord messages; preserve the intended tone, context, and requested outcome."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.2"
registry:
  category: "quality"
  domains: "collaboration, code-review, comments, technical-communication"
  paths: ".github/ISSUE_TEMPLATE/**/*.md, .github/pull_request_template*.md, .github/PULL_REQUEST_TEMPLATE/**/*.md"
  keywords: "PR comment, pull request feedback, review comment, request changes, issue reply, GitHub comment, maintainer reply, Slack message, Discord message, collaboration comment, write a comment, reply to this thread"
  related: "cognitive-doc-design"
  priority: 60
---

# Comment Writer

Field conventions:

- `category`: short grouping such as `base`, `transversal`, `workflow`, `quality`, `security`, or `runtime`.
- `domains`: stable domain tags used for routing.
- `paths`: glob-like project paths that should activate this skill.
- `keywords`: user/request/code keywords that should activate this skill.
- `phases`: phases where this skill is usually useful: `explore`, `proposal`, `spec`, `design`, `task`, `apply`, `verify`, `archive`.
- `related`: skills that should be considered when this skill is active.
- `priority`: routing priority from 0 to 100. Higher means consider earlier when multiple skills match.

## Activation Contract

Use this skill whenever the requested output is a short collaboration comment another person will read, including GitHub PR or issue comments, review feedback, requested changes, maintainer replies, and Slack, Discord, or asynchronous project updates.

Use it after gathering enough technical evidence to make the comment accurate. Do not load it as a substitute for reviewing code, diagnosing an issue, or verifying a claim. For long-form guides, RFCs, architecture documents, or detailed PR descriptions, prefer `cognitive-doc-design`.

## Hard Rules

- Start with the actionable point instead of recapping the entire PR or discussion.
- Sound like a thoughtful teammate: warm, direct, specific, and non-corporate.
- Prefer one to three short paragraphs or a tight bullet list.
- Explain the technical reason when requesting a change, but omit background that does not help the recipient act.
- Focus on the highest-value issue instead of piling on minor preferences.
- Give a concrete next action when the recipient needs to change or clarify something.
- Match the target context language by default: Spanish thread to Spanish comment, English thread to English comment, and mixed context to the target message language.
- Follow an explicitly requested language or tone. For Spanish, default to neutral professional language unless the context clearly calls for a regional tone.
- Do not use em dashes. Use commas, periods, or parentheses instead.
- Do not invent technical findings, consensus, approvals, or repository policy.

Default formula:

```text
<Direct observation or request>

<Why it matters, only if needed>

<Concrete next action>
```

Examples:

### Request a change

```markdown
Good approach overall. I'd split this into a separate commit because it mixes validation logic with UI wiring.

That keeps the reviewer's focus narrower and makes rollback cleaner if the integration fails.
```

### Approve with a note

```markdown
Approved. The scope is clear and the change is well-contained.

For the next PR, add links to the previous and following PRs so the chain stays navigable.
```

### Ask for a split

```markdown
This PR exceeds the 400-line budget, so we need to split it or justify `size:exception`.

Suggested order: foundation + tests first, then integration, then docs. That gives each review a clear start and end.
```

## Decision Gates

- If the underlying technical facts are missing or uncertain, inspect the relevant evidence or ask for it before drafting the comment.
- If the message announces approval, rejection, policy, or a team decision that the user has not confirmed, ask before asserting it.
- If the output is long-form documentation rather than a short collaboration message, also consider or prefer `cognitive-doc-design`.
- If the target language, audience, or desired tone cannot be inferred and materially affects the message, ask one concise question.

## Execution Steps

1. Identify the recipient, context, desired outcome, language, and tone.
2. Extract the single highest-value observation, request, or update.
3. State it directly and add the technical reason only when useful.
4. Add a concrete next action when action is required.
5. Remove unnecessary recap, generic praise, repetition, and low-value preferences.
6. Check warmth, factual accuracy, brevity, language match, and the no-em-dash rule.

Useful inspection command when applicable:

```bash
# Inspect a PR before writing review feedback
gh pr view <PR_NUMBER> --json title,body,additions,deletions,changedFiles
```

## Output Contract

Return:

- Skill applied: `comment-writer` when a process note is useful.
- The ready-to-send comment in the target context language.
- Any factual assumption or missing evidence that prevents a confident message.
- Alternative wording only when the user asks for options or tone variants.

## References

- `extensions/skill-registry/templates/skill-template.md` — canonical Pi skill structure and registry metadata.
- The target PR, issue, review, or conversation thread — source of truth for facts, language, and tone.
