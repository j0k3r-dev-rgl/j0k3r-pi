# websearch extension

Read-only Pi extension for bounded community research across Stack Overflow, GitHub Issues, Dev.to, and Hacker News.

## Tool inventory
- `search_stack_overflow`
- `stack_overflow_question_get`
- `stack_overflow_answers_get`
- `stack_overflow_comments_get`
- `search_github_issues`
- `github_issue_get`
- `search_devto_articles`
- `devto_comments_get`
- `search_hackernews`
- `hackernews_story_get`

## Environment
- `STACK_EXCHANGE_KEY` optional for higher Stack Exchange quota
- `GITHUB_TOKEN` optional, env-only, public-read GitHub quota helper

Credentials stay in environment variables only. Tools never accept secrets as inputs and redact secret-like values from returned surfaces.

## Provider notes
- GitHub uses the official `octokit` SDK for read-only public issue search/detail.
- Dev.to uses the public Forem API via native `fetch` with a tag-first MVP for article search.
- Hacker News uses the Algolia HN Search API via native `fetch` for story search and story detail.

## Safety and bounds
- Read-only only; no posting, editing, voting, moderation, or other mutation.
- Output is bounded for search results, bodies, comments, and nested comment depth.
- Secret-like strings are redacted as `[REDACTED_SECRET]` across `content`, `details`, and structured errors.
- Provider errors are returned as structured recoverable failures when possible.
- Community content is untrusted display content only.

## Validation
- `cd extensions/websearch && npm run typecheck`
- `cd extensions/websearch && npm run test`
- `cd extensions/websearch && npm audit --omit=dev --json`
