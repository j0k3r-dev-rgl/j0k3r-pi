# Aggregate Design Canvas

Inspired by ddd-crew's Aggregate Design Canvas; not a requirement to introduce aggregates into CRUD code.

## Root and identity

<root entity, identity and lifecycle>

## Invariants

1. <rule requiring consistency; focused test>.

## Commands and facts

| Command | Preconditions | State change | Event, if needed |
|---|---|---|---|
| <intent> | <rule> | <change> | <past-tense fact> |

## Consistency boundary

- Atomic changes: <what must succeed together>.
- External references: <identities/values>.
- Cross-boundary consistency: <explicit approved trade-off>.

## Verification and open decisions

- [ ] Changed invariants are tested.
- [ ] Invalid transitions are rejected.
- [ ] Integration consequences are explicit.
- <unresolved question and owner>.
