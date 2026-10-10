# Native user questions for Pi

An independent global Pi extension adapting gentle-shell's `ask_user_question` experience: a native dock-swap questionnaire with tabs, single/multiple selection, option previews, and an always-available **Type something.** response. It does not install gentle-shell, its persona, its workflows, or a `grill-me` skill.

## Use it

1. Keep this directory under `~/.pi/agent/extensions/ask-user-question/`. Pi discovers its `index.ts` automatically; no `settings.json` entry is needed.
2. Run `/reload` or restart Pi.
3. Ask Pi to clarify a necessary decision using `ask_user_question`. The questionnaire replaces the input dock temporarily while leaving the transcript visible.

The tool contributes prompt guidelines for **one focused question when a material decision is open**, then waiting for the answer. Independent questions can be grouped only when the governing workflow permits it. Facts the agent can inspect are not user decisions. These are model instructions, not a deterministic guarantee of when the model will call the tool; existing authorization and circuit-breaker rules remain authoritative.

For an isolated trial, run `pi --no-extensions -e ./index.ts` from this directory. Do not load a second provider of `ask_user_question`, including gentle-shell or `@juicesharp/rpiv-ask-user-question`, in the same session: Pi rejects duplicate tool names.

## Tool contract

`ask_user_question` is model-only and sequential: scripts cannot invoke it through codemode and question calls cannot overlap other tool calls in the same batch.

```json
{
  "questions": [{
    "question": "Which scope should we implement?",
    "header": "Scope",
    "options": [
      { "label": "Minimal", "description": "Recommended: the smallest useful change", "preview": "Keep the current workflow and implement only the requested behavior." },
      { "label": "Broader", "description": "Discuss additional requirements first" }
    ],
    "multiSelect": false
  }]
}
```

| Field | Contract |
|---|---|
| `questions` | 1–4 questions; duplicate question text is rejected |
| `question` | Full question text |
| `header` | Short tab label, at most 16 characters |
| `options` | 2–4 ordered choices |
| `label` | At most 60 characters; labels must be unique within a question |
| `description` | Explanation shown below the choice |
| `preview` | Optional text preview: side-by-side at ≥80 columns, inline below that width |
| `multiSelect` | Optional boolean; defaults to single selection |

The view appends **Type something.** itself; do not author an option named `Other` or `Type something.`. Input schemas reject unknown properties. Questions and authored options can be localized by the model; fixed interaction labels remain upstream English. Previews are wrapped text, not a full Markdown renderer.

Success returns the complete answer transcript in `content` and typed answer rows in `details.answers`, including custom text, multi-select choices, and selected single-option previews. Cancellation returns `details.cancelled: true`, discards partial answers, and explicitly tells the model to stop dependent work. It does **not** authorize an operation.

Invalid input and unavailable modes throw native Pi tool errors. This version requires `ctx.mode === "tui"`; RPC/JSON/print do not open dialogs or guess answers. It deliberately does not copy gentle-shell's private RPC-host environment contract. When UI is unavailable or a complete question exceeds the limits, guidelines direct the model to ask in chat and wait.

## Controls and rendering

| Key | Action |
|---|---|
| Up / Down | Move between options and the custom-response row |
| Space | Toggle a multi-select option |
| Enter | Confirm a selection, open the custom editor, or submit text |
| Tab / Shift+Tab | Switch questions, preserving cursor, toggles, and drafts |
| Escape | Leave the custom editor first; from choices, cancel the questionnaire |

Selection and input actions honor injected Pi keybindings; Space and Shift+Tab follow the upstream fixed controls. Mouse clicks work through native container dispatch in fullscreen mode; keyboard interaction is available in both regular and fullscreen modes. The wrapper propagates focus for the custom input's IME cursor.

Only the active question body is displayed, avoiding stacked question bodies. Long descriptions/previews still increase its height; this does not promise a height limit for arbitrary text. Every rendered line is width-safe, including extremely narrow Unicode viewports. A grapheme wider than the viewport can be visually clipped without changing result data.

Tool rows use Pi's standard shell and expansion state. The collapsed result shows answer count and the configured `app.tools.expand` hint; expanding shows **all returned model-facing text**, including previews. Partial, cancellation, error, and empty states are explicit. Rendering never changes the result or silently truncates answer data; no persistence/pagination layer is needed for this bounded, user-authored interaction.

## Independence, lifecycle and privacy

- Runtime imports use only Pi-provided `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox`, declared as host peers.
- Local pinned development dependencies provide this directory's own tests and typecheck. No sibling extension, global dependency path, custom resolver, or fallback is used.
- No configuration, credentials, provider calls, background timers, watchers, files, or persistent state are created by tool execution.
- Each interaction owns its UI and abort listener. Completion/disposal removes the listener; an aborted operation closes the dock and propagates `AbortError` rather than accepting an answer.
- Answers enter the ordinary Pi conversation/tool result. Do not enter credentials or secrets into this questionnaire.
- Compatible host baseline: Pi 1.1.0 (validated). Unknown host versions must be tested before claiming compatibility.

## Development and validation

From this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
```

Tests cover upstream schema/validation and view behavior, tabs/drafts, single/multiple/custom answers, mouse dispatch, focus, narrow widths, cancellation/abort cleanup, complete expanded rendering, dependency ownership, and loading through the real Pi extension loader.

Manual checks after `/reload`:

- [ ] Single question; complete it and expand the returned answer.
- [ ] Multiple questions; switch tabs and return to a saved custom draft.
- [ ] Multi-select with Space and a custom response.
- [ ] Preview above and below 80 columns; resize during interaction.
- [ ] Escape from editor versus Escape from choices; confirm cancellation does not continue blocked work.
- [ ] Regular/fullscreen keyboard interaction; fullscreen mouse clicks.

Automated checks do not prove visual parity, terminal-specific behavior, or autonomous model adherence. These live TUI checks remain a user-session validation step.

## Source and license

Adapted from [Gentleman-Programming/gentle-shell](https://github.com/Gentleman-Programming/gentle-shell/tree/de52658de7d366523585db992dffebf024368744), pinned commit `de52658de7d366523585db992dffebf024368744`:

- `lib/questionnaire/schema.ts`, `validate.ts`, and `questionnaire-view.ts`.
- `lib/native-fullscreen-interaction.ts` (simplified native wrapper with focus/disposal).
- `extensions/ask-user-question.ts` (tool/output concepts, not private runtime coupling).
- `tests/questionnaire-schema.test.ts` and `tests/questionnaire-view.test.ts`.
- `assets/orchestrator.md`: an open product/design decision triggers one focused question and waiting.

The upstream MIT license and copyright notice are retained in [LICENSE](LICENSE). Local adaptation separates registration/core/rendering, adds necessary-decision guidance, abort cleanup, width guards and native collapsed/expanded output, and omits gentle-shell events/RPC-host coupling. This is an independent adaptation, not an official gentle-shell package or endorsement.
