# Keyboard Shortcuts

This document tracks Pi built-in keyboard shortcuts and project extension shortcuts.

Sources checked:

- Pi docs: `@earendil-works/pi-coding-agent/docs/keybindings.md`
- Pi runtime defaults: `dist/core/keybindings.js`
- Pi extension conflict policy: `dist/core/extensions/runner.js`
- Project extension registrations under `extensions/**/index.ts`

There is currently no user override file at `~/.pi/agent/keybindings.json`, so the defaults below are the active baseline.

## Pi built-in shortcuts

### Editor movement

| Action | Default shortcut | Description |
|---|---:|---|
| `tui.editor.cursorUp` | `up` | Move cursor up |
| `tui.editor.cursorDown` | `down` | Move cursor down |
| `tui.editor.cursorLeft` | `left`, `ctrl+b` | Move cursor left |
| `tui.editor.cursorRight` | `right`, `ctrl+f` | Move cursor right |
| `tui.editor.cursorWordLeft` | `alt+left`, `ctrl+left`, `alt+b` | Move cursor word left |
| `tui.editor.cursorWordRight` | `alt+right`, `ctrl+right`, `alt+f` | Move cursor word right |
| `tui.editor.cursorLineStart` | `home`, `ctrl+a` | Move to line start |
| `tui.editor.cursorLineEnd` | `end`, `ctrl+e` | Move to line end |
| `tui.editor.jumpForward` | `ctrl+]` | Jump forward to character |
| `tui.editor.jumpBackward` | `ctrl+alt+]` | Jump backward to character |
| `tui.editor.pageUp` | `pageUp` | Scroll up by page |
| `tui.editor.pageDown` | `pageDown` | Scroll down by page |

### Editor deletion and kill ring

| Action | Default shortcut | Description |
|---|---:|---|
| `tui.editor.deleteCharBackward` | `backspace` | Delete character backward |
| `tui.editor.deleteCharForward` | `delete`, `ctrl+d` | Delete character forward |
| `tui.editor.deleteWordBackward` | `ctrl+w`, `alt+backspace` | Delete word backward |
| `tui.editor.deleteWordForward` | `alt+d`, `alt+delete` | Delete word forward |
| `tui.editor.deleteToLineStart` | `ctrl+u` | Delete to line start |
| `tui.editor.deleteToLineEnd` | `ctrl+k` | Delete to line end |
| `tui.editor.yank` | `ctrl+y` | Paste most recently deleted text |
| `tui.editor.yankPop` | `alt+y` | Cycle through deleted text after yank |
| `tui.editor.undo` | `ctrl+-` | Undo last edit |

### Input and selection

| Action | Default shortcut | Description |
|---|---:|---|
| `tui.input.newLine` | `shift+enter` | Insert new line |
| `tui.input.submit` | `enter` | Submit input |
| `tui.input.tab` | `tab` | Tab / autocomplete |
| `tui.input.copy` | `ctrl+c` | Copy selection |
| `tui.select.up` | `up` | Move selection up |
| `tui.select.down` | `down` | Move selection down |
| `tui.select.pageUp` | `pageUp` | Page up in list |
| `tui.select.pageDown` | `pageDown` | Page down in list |
| `tui.select.confirm` | `enter` | Confirm selection |
| `tui.select.cancel` | `escape`, `ctrl+c` | Cancel selection |

### Application

| Action | Default shortcut | Description |
|---|---:|---|
| `app.interrupt` | `escape` | Cancel / abort |
| `app.clear` | `ctrl+c` | Clear editor |
| `app.exit` | `ctrl+d` | Exit when editor is empty |
| `app.suspend` | `ctrl+z` | Suspend to background on non-Windows platforms |
| `app.editor.external` | `ctrl+g` | Open in external editor |
| `app.clipboard.pasteImage` | `ctrl+v` on Unix, `alt+v` on Windows | Paste image from clipboard |

### Sessions

| Action | Default shortcut | Description |
|---|---:|---|
| `app.session.new` | none | Start a new session |
| `app.session.tree` | none | Open session tree navigator |
| `app.session.fork` | none | Fork current session |
| `app.session.resume` | none | Open session resume picker |
| `app.session.togglePath` | `ctrl+p` | Toggle path display |
| `app.session.toggleSort` | `ctrl+s` | Toggle sort mode |
| `app.session.toggleNamedFilter` | `ctrl+n` | Toggle named-only filter |
| `app.session.rename` | `ctrl+r` | Rename session |
| `app.session.delete` | `ctrl+d` | Delete session |
| `app.session.deleteNoninvasive` | `ctrl+backspace` | Delete session when query is empty |

### Models, thinking, display, and message queue

| Action | Default shortcut | Description |
|---|---:|---|
| `app.model.select` | `ctrl+l` | Open model selector |
| `app.model.cycleForward` | `ctrl+p` | Cycle to next model |
| `app.model.cycleBackward` | `shift+ctrl+p` | Cycle to previous model |
| `app.thinking.cycle` | `shift+tab` | Cycle thinking level |
| `app.thinking.toggle` | `ctrl+t` | Collapse or expand thinking blocks |
| `app.tools.expand` | `ctrl+o` | Collapse or expand tool output |
| `app.message.followUp` | `alt+enter` | Queue follow-up message |
| `app.message.dequeue` | `alt+up` | Restore queued messages to editor |

### Tree navigation

| Action | Default shortcut | Description |
|---|---:|---|
| `app.tree.foldOrUp` | `ctrl+left`, `alt+left` | Fold current branch segment, or jump to previous segment start |
| `app.tree.unfoldOrDown` | `ctrl+right`, `alt+right` | Unfold current branch segment, or jump to next segment or branch end |
| `app.tree.editLabel` | `shift+l` | Edit selected tree node label |
| `app.tree.toggleLabelTimestamp` | `shift+t` | Toggle label timestamps in the tree |
| `app.tree.filter.default` | `ctrl+d` | Set tree filter to default view |
| `app.tree.filter.noTools` | `ctrl+t` | Toggle tree filter that hides tool results |
| `app.tree.filter.userOnly` | `ctrl+u` | Toggle tree filter that shows only user messages |
| `app.tree.filter.labeledOnly` | `ctrl+l` | Toggle tree filter that shows only labeled entries |
| `app.tree.filter.all` | `ctrl+a` | Toggle tree filter that shows all entries |
| `app.tree.filter.cycleForward` | `ctrl+o` | Cycle tree filter forward |
| `app.tree.filter.cycleBackward` | `shift+ctrl+o` | Cycle tree filter backward |

### Scoped models selector

| Action | Default shortcut | Description |
|---|---:|---|
| `app.models.save` | `ctrl+s` | Save current model selection to settings |
| `app.models.enableAll` | `ctrl+a` | Enable all models, or all matching current search |
| `app.models.clearAll` | `ctrl+x` | Clear all models |
| `app.models.toggleProvider` | `ctrl+p` | Toggle all models for current provider |
| `app.models.reorderUp` | `alt+up` | Move selected model up in cycle order |
| `app.models.reorderDown` | `alt+down` | Move selected model down in cycle order |

## Extension conflict policy

Pi blocks extension shortcuts that conflict with a reserved editor-global shortcut.

Reserved for extension conflict checks:

| Shortcut | Reserved action |
|---|---|
| `escape` | `app.interrupt` |
| `ctrl+c` | `app.clear`, `tui.input.copy`, `tui.select.cancel` |
| `ctrl+d` | `app.exit` |
| `ctrl+z` | `app.suspend` |
| `shift+tab` | `app.thinking.cycle` |
| `ctrl+p` | `app.model.cycleForward` |
| `shift+ctrl+p` | `app.model.cycleBackward` |
| `ctrl+l` | `app.model.select` |
| `ctrl+o` | `app.tools.expand` |
| `ctrl+t` | `app.thinking.toggle` |
| `ctrl+g` | `app.editor.external` |
| `alt+enter` | `app.message.followUp` |
| `enter` | `tui.input.submit`, `tui.select.confirm` |
| `ctrl+k` | `tui.editor.deleteToLineEnd` |

Picker-specific bindings are not reserved by Pi's extension conflict check. For example, `ctrl+x` is used by the scoped models selector (`app.models.clearAll`) but is not reserved globally.

## Project extension shortcuts

| Extension | Shortcut | Command / action | Status |
|---|---:|---|---|
| `agent-todo` | `ctrl+space` | Toggle the above-chat todo widget expanded/collapsed | Active |
| `sidebar` | `ctrl+.` | Toggle Pi Sidebar overlay | Active |
| `subagents` | `/subagents` | Open the subagent history panel | Active command |
| `subagents` | `ctrl+,` | Open the subagent history panel | Active |
| `subagents` | `ctrl+h` | Send the running Claude-mode subagent task to background | Active default; configurable via `subagents.json` |
| `subagents` | `ctrl+o` | Expand/collapse rendered tool output inside the subagent history panel | Panel-local; uses Pi `app.tools.expand` binding |

## Control-key candidates for subagents

For a global extension shortcut, avoid reserved shortcuts above. Also avoid terminal-sensitive keys such as `ctrl+s`/`ctrl+q` when possible because they can interact with terminal flow control.

Chosen shortcuts:

| Candidate | Reason |
|---|---|
| `ctrl+,` | Not used by Pi built-ins, not reserved by Pi's extension conflict check, and not used by current project extensions. |
| `ctrl+h` | Default Claude-mode background handoff shortcut for `subagents`; configurable via `background_handoff_shortcut` in `subagents.json`. |

The earlier shortcut-probe output showed `ctrl+j` is already occupied by Pi `tui.input.newLine`, so it should not be treated as free for a global extension shortcut.

Other non-reserved control keys exist but overlap with normal editor editing/navigation behavior (`ctrl+a`, `ctrl+b`, `ctrl+e`, `ctrl+f`, `ctrl+n`, `ctrl+r`, `ctrl+u`, `ctrl+w`, `ctrl+x`, `ctrl+y`, etc.), so they are less appropriate for a global extension shortcut.
