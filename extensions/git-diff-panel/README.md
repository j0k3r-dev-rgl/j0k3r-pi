# git-diff-panel

Pi TUI extension that opens a themed split overlay for reviewing local Git changes.

## Usage

- Command: `/git-diff`
- Shortcut: `alt+g`

## UI

- Left pane: changed files rendered as a folder tree.
- Right pane: diff for the selected file.
- Summary: cwd, branch, additions/deletions, changed-file count.

## Keys

- `j` / `down`: move down in tree, or scroll 1 line down in diff.
- `k` / `up`: move up in tree, or scroll 1 line up in diff.
- `ctrl+j`: scroll 15 lines down in diff (nvim style).
- `ctrl+k`: scroll 15 lines up in diff (nvim style).
- `h` / `left`: focus tree, or collapse selected folder while tree is focused.
- `l` / `right`: focus diff, or expand selected folder while tree is focused.
- `enter` / `space`: toggle folder expand/collapse, or focus diff on file.
- `tab`: toggle focus.
- `g`: top.
- `G`: bottom.
- `r`: refresh.
- `q` / `escape`: close.
- Mouse wheel: scroll tree when hovering over the left panel, or scroll diff when hovering over the right panel.
- Mouse left click: switch focus between tree and diff panes, or toggle folders/select files in tree.

## Notes

The extension shells out to local `git` only. It does not use `gh` and does not send output to the model. The overlay is TUI-only and requires an active Pi interactive session.
