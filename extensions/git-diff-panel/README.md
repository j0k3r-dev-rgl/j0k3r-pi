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

- `j` / `down`: move down in the tree or diff.
- `k` / `up`: move up in the tree or diff.
- `h` / `left`: focus tree, or collapse selected folder while tree is focused.
- `l` / `right`: focus diff, or expand selected folder while tree is focused.
- `tab`: toggle focus.
- `ctrl+d` / `pageDown`: page down in diff.
- `ctrl+u` / `pageUp`: page up in diff.
- `g`: top.
- `G`: bottom.
- `r`: refresh.
- `q` / `escape`: close.

## Notes

The extension shells out to local `git` only. It does not use `gh` and does not send output to the model. The overlay is TUI-only and requires an active Pi interactive session.
