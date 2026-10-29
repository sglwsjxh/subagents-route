<h1 align="center">Subagents Route · OpenCode Subagent Routing and Status Board</h1>

<p align="center">
  <a href="README.md">简体中文</a>
  |
  <a href="README-en.md">English</a>
</p>

## Features

- Subagent model routing: `~/.config/opencode/subagents.json` is the single source of truth for each subagent's name, model and description plus overall concurrency limits; the plugin reconciles the routes into the agents section of opencode.json at startup and on `/reload`, never writing while files are being edited, with `npm run sync` for a manual force and `npm run clean` to remove the generated block
- Plan to build: after the plan is written, `plan_build` switches the session to the build agent and injects plan-execution instructions; choosing "switch to build" hands over automatically
- TUI status board: live view of every subagent's model, state and token usage
- Ships with 7 subagent definitions and 1 command: plan, explore, librarian, oracle, writer, critic and looker, plus ulw

## Install

Copy the line below and hand it to the agents working with you to deploy

```text
Deploy this project following the instructions in docs/install.md
```

The Chinese deploy line reads 根据 docs/install.md 的内容帮我部署这个项目, and manual steps are in docs/install.md

## Usage

Goals: use the built-in OpenCode `/goal` (v2.2.1+) with pause / resume / clear and reviewer confirmation; this plugin no longer ships a goal command or resume machinery

Routing: edit `~/.config/opencode/subagents.json`, save, then run `/reload`; the plugin reconciles the routes into the agents section of opencode.json, and startup reconciles as well. `npm run sync` forces a manual reconcile, `npm run clean` removes the generated block (the next `/reload` or startup writes it back, so remove the plugin entry first for a permanent cleanup)

### Configuration

Minimal subagents.json example:

```json
{
  "subagents": [
    {
      "name": "plan",
      "model": "modelscope/ZhipuAI/GLM-5.3-Flash",
      "effort": "max",
      "description": "Planning agent for multi-file changes with dependencies, outputs an executable plan"
    },
    {
      "name": "explore",
      "model": "opencode/deepseek-v4.1-flash-free",
      "description": "Local code search agent for where X is implemented or who calls Z, read-only"
    }
  ],
  "concurrency": {
    "total": 24,
    "perAgent": 4
  }
}
```

| Field | Meaning |
| --- | --- |
| name | Subagent name, matching its entry in the agents section |
| model | Base model reference as `provider/model`, no # suffix |
| effort | Optional reasoning effort, `low` / `medium` / `high` / `max`, only values the model declares support for |
| description | Role note for the subagent; the live source is the same field in `.opencode/agents/<name>.md`, kept here for reference |
| concurrency.total | Upper bound on subagents running at the same time |
| concurrency.perAgent | Upper bound on instances of one subagent type |

> ⚠️ For model, copy base names verbatim from `opencode models`; a nonexistent model or an effort value outside what the model supports makes the subagent fail to start with 模型不存在或已停用

## License

MIT License
