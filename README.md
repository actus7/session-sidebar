# session-sidebar

A collapsible sidebar for [Claude Code](https://claude.com/claude-code) that keeps the state of your
session in view: rate limits, context usage, MCP servers, plugins and skills, agents, tasks, checks
and changed files. Collapse it and a one-line status bar takes its place above the prompt.

> The interface text is in Brazilian Portuguese for now (`LIMITES`, `Ver mais`, `Recolher`, ...).

## What you get

| Card | Shows |
|---|---|
| **Header** | model, running/idle, folder and git branch |
| **LIMITES** (limits) | 5-hour and weekly limits with reset times, and the **context** fill as one coloured bar. *Ver mais* opens the breakdown by category |
| **MCPs** | each MCP server with its tool count and the context its tool schemas take |
| **PLUGINS E SKILLS** | enabled plugins and skills, ordered by what you used last |
| **AGENTES** | running and finished subagents, and the agent definitions you have configured |
| **TAREFAS** | the todo list with progress |
| **VERIFICAÇÕES** | the last test, type-check, lint and build runs (detected from Bash commands) |
| **ARQUIVOS** | changed files with `+/-` counts, from git (or from Edit/Write outside a repository) |

- Click a card title (`▾` / `▸`) to collapse or expand it.
- A card with a cut-off list ends with **Ver mais** / **Ver menos**.
- **▶ Recolher** hides the sidebar. A status bar with `contexto`, `custo` and `limite` pills (with the
  growth since your last prompt) and a **◀ Sidebar** button appears above the prompt.
- `/sidebar` toggles it from the prompt.
- Everything is live: a `/model` switch, a compaction, a `cd`, a branch change or a settings change
  redraws the sidebar at once, without waiting for the next turn.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install session-sidebar --marketplace actus7/session-sidebar
```

Answer `y` to add the marketplace, then choose a scope. From a shell:

```
claude plugin install session-sidebar --marketplace actus7/session-sidebar
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `actus7/session-sidebar`, then **Add plugin**.

## Requirements

- A Claude Code version with plugin hooks modules (written and tested on `2.1.318`). The API they use
  is new and can change between versions.
- `git` on your `PATH` for the branch and the changed files.
- Terminal or desktop surface. The sidebar opens on its own from about 144 columns; below that, use
  `/sidebar`.

## What it reads and does

- Runs `git rev-parse`, `git status` and `git diff --numstat` in your working folder.
- Reads your Claude Code settings and installed plugins to count plugins, skills and agents.
- Keeps, per session, only what it draws. Across sessions it stores a small count of which skills and
  plugins you used, to sort them.
- Makes **no network requests** and writes no files.

## Develop

```
claude plugin validate .
claude plugin test .
```

The tests draw every card at 44 columns and check that no row overflows.

## License

MIT
