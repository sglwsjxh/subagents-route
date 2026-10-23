<h1 align="center">Subagents Route · OpenCode 子代理路由、goal 续跑与状态板</h1>

<p align="center">
  <a href="README.md">简体中文</a>
  |
  <a href="README-en.md">English</a>
</p>

## 功能

- 子代理模型路由：`~/.config/opencode/subagents.json` 是唯一真相源，定义每个子代理的 name、model、description，外加整体并发上限，跑 `node sync-routes.mjs` 把路由幂等写进 opencode.json 的 agents 段
- goal 续跑：`goal_set` 把目标固定到会话，主会话与全部子代理都空闲且目标未完成时注入隐形提示续跑，`goal_done` 结束，上限 40 轮
- TUI 状态板：实时显示每个子代理的模型、状态、token 用量和当前 goal
- 自带 7 个子代理定义和 2 个命令：plan、explore、librarian、oracle、writer、critic、looker，加上 goal 和 ulw

## 安装

复制下面一行内容，交给帮你干活的 agents 部署

```text
根据 docs/install.md 的内容帮我部署这个项目
```

手动安装步骤见 docs/install.md

## 使用

goal：`/goal` 后面接目标，主会话和所有子代理都空闲且目标未完成时注入隐形提示续跑，目标全部达成就 `goal_done` 收口，自动续跑最多 40 轮

子代理路由：改完 `~/.config/opencode/subagents.json` 跑 `npm run sync`，路由同步进 opencode.json 的 agents 段

### 配置说明

subagents.json 最小示例：

```json
{
  "subagents": [
    {
      "name": "plan",
      "model": "modelscope/ZhipuAI/GLM-5.3-Flash",
      "effort": "max",
      "description": "规划专员，改动跨多文件、有先后依赖时派它，产出可执行计划"
    },
    {
      "name": "explore",
      "model": "opencode/deepseek-v4.1-flash-free",
      "description": "本地代码检索专员，问 X 在哪实现、谁调用了 Z 时派它，只读"
    }
  ],
  "concurrency": {
    "total": 24,
    "perAgent": 4
  }
}
```

| 字段 | 说明 |
| --- | --- |
| name | 子代理名称，对应 opencode.json agents 段里的条目 |
| model | 子代理使用的模型，只写 `provider/model` 基础名，不带 # 后缀 |
| effort | 可选，思考强度，`low` / `medium` / `high` / `max`，只能填该模型声明支持的档位 |
| description | 子代理角色说明，实际生效来源是 `.opencode/agents/<name>.md` 的同名字段，这里保留作参照 |
| concurrency.total | 同一时刻在跑的子代理总数上限 |
| concurrency.perAgent | 同一种子代理的并发上限 |

> ⚠️ model 只能逐字选 `opencode models` 列出的基础名；基础名不存在或 effort 值不在模型支持的档位里，子代理启动会报 模型不存在或已停用

## 许可证

MIT License
