# git-diff-panel

Pi TUI extension that opens a themed split overlay for reviewing local Git changes, with full Git Worktrees support.

## Usage

- Command: `/git-diff [worktree]`
- Shortcut: `alt+g`

## UI

- Worktree bar: appears when multiple worktrees exist, showing tabs for each worktree (`clean` or `+add/-del`) plus an `ALL` worktrees tab.
- Left pane: changed files rendered as a folder tree (or grouped by worktree in `ALL` mode).
- Right pane: diff for the selected file (automatically resolves correct worktree path).
- Summary: active worktree / branch, additions/deletions, changed-file count.

## Keys

- `w`: cycle to next worktree tab (`worktree 1 -> worktree 2 -> ... -> ALL`).
- `W`: cycle to previous worktree tab.
- `j` / `down`: move down in tree, or scroll 1 line down in diff.
- `k` / `up`: move up in tree, or scroll 1 line up in diff.
- `ctrl+j`: scroll 15 lines down in diff (nvim style).
- `ctrl+k`: scroll 15 lines up in diff (nvim style).
- `h` / `left`: focus tree, or collapse selected folder/worktree while tree is focused.
- `l` / `right`: focus diff, or expand selected folder/worktree while tree is focused.
- `enter` / `space`: toggle folder/worktree expand/collapse, or focus diff on file.
- `tab`: toggle focus.
- `g`: top.
- `G`: bottom.
- `r`: refresh (re-scans all worktrees and changes).
- `q` / `escape`: close.
- Mouse wheel: scroll tree when hovering over the left panel, or scroll diff when hovering over the right panel.
- Mouse left click: switch focus between tree and diff panes, toggle folders/worktrees, or click worktree tabs.

## Notes

The extension shells out to local `git` only. It does not use `gh` and does not send output to the model. The overlay is TUI-only and requires an active Pi interactive session.
