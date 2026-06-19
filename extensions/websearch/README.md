# websearch extension

Read-only Pi extension for Stack Overflow research tools.

## tools
- `search_stack_overflow`
- `stack_overflow_question_get`
- `stack_overflow_answers_get`

## environment
Stack Exchange:
- `STACK_EXCHANGE_KEY` optional

The tools work without `STACK_EXCHANGE_KEY`, but using a key increases quota.

## validation
- `npm run typecheck`
- `npm run test`
- `npm audit --omit=dev --json`
