# 安装 Subagents Route

这份文档给人和 agent 都能照做，目标读者是把项目部署到 OpenCode 全局配置里。装完得到三大功能：子代理模型路由、goal 持续目标与自动续跑、TUI 子代理状态板

## 前置要求

- Node.js 22+，已安装 OpenCode
- 全局配置目录 `~/.config/opencode`（Windows 即 `C:\Users\<你>\.config\opencode`，遵循 `XDG_CONFIG_HOME`）
- 你的 `opencode.json` 顶层必须有一条 `"model": "..."` 配置行（4 空格缩进、行尾带逗号，`sync-routes.mjs` 按此匹配插入锚点），没有会直接报错

## 第一步 取得代码（二选一）

方式 A npm 包：在 `~/.config/opencode/opencode.json` 的 `plugins` 数组加入

```json
"@sglwsjxh/subagents-route@latest"
```

OpenCode 启动时自动安装

方式 B 源代码：

```bash
git clone https://github.com/sglwsjxh/subagents-route.git
```

然后 `plugins` 数组加入本地目录路径，如 `"C:/path/to/subagents-route"`

下文用 `<插件目录>` 指代：方式 A 为 OpenCode 的 npm 插件缓存里的 `node_modules/@sglwsjxh/subagents-route`，方式 B 为你 clone 的仓库根

## 第二步 配置模型路由

1. 复制 `<插件目录>/subagents.json.example` 为 `~/.config/opencode/subagents.json`
2. 逐项修改 `model`：只写基础名，从 `opencode models` 的输出里逐字选择，一行一个 `provider/model`，不能带 `#` 后缀。思考强度用单独的可选字段 `effort`，取 `low` / `medium` / `high` / `max` 之一，值必须在该模型目录元数据或 provider 配置声明的 reasoning effort 档位里；模型不支持推理强度就不写 `effort`，用默认强度
3. `concurrency.total` 是同时运行的子代理总数上限，`perAgent` 是单种 agent 同时上限
4. 运行

```bash
node <插件目录>/sync-routes.mjs
```

或在插件目录下

```bash
npm run sync
```

把路由段写进 `opencode.json`

注意 `sync-routes.mjs` 只更新 `opencode.json` 的 `agents` 段，生成内容夹在 `BEGIN subagents-route` 和 `END subagents-route` 注释标记之间，不动其他内容，重复运行安全。带 `effort` 的条目会展开成 OpenCode 官方的 `providerID` + `model` + `variant` 形态，不带的保持 `provider/model` 字符串原样

## 第三步 接入 commands 与 agents

把 `<插件目录>/.opencode` 下的 `commands` 和 `agents` 挂到全局配置

agents 整个目录用链接。Windows PowerShell：

```powershell
New-Item -ItemType Junction -Path ~/.config/opencode/agents -Target <插件目录>\.opencode\agents
```

macOS/Linux：

```bash
ln -s <插件目录>/.opencode/agents ~/.config/opencode/agents
```

commands 只挂 `goal.md` 和 `ulw.md` 两个文件。Windows Junction 不支持文件，用硬链接（硬链接不跨盘符，仓库和全局配置必须在同一分区；若 `~/.config/opencode/commands` 目录不存在，先用 `New-Item -ItemType Directory` 创建）：

```powershell
New-Item -ItemType HardLink -Path ~/.config/opencode/commands/goal.md -Target <插件目录>\.opencode\commands\goal.md
New-Item -ItemType HardLink -Path ~/.config/opencode/commands/ulw.md -Target <插件目录>\.opencode\commands\ulw.md
```

macOS/Linux：

```bash
ln -s <插件目录>/.opencode/commands/goal.md ~/.config/opencode/commands/goal.md
ln -s <插件目录>/.opencode/commands/ulw.md ~/.config/opencode/commands/ulw.md
```

如果全局已经存在同名文件或目录：先逐字节对比内容与仓库版本一致（`certutil -hashfile` 或 `sha256sum`），一致才删原件建链接；不一致先备份再问维护者

链接方式的好处：以后 `git pull` 更新仓库，全局配置自动跟着变，不用再复制。注意 agents 目录 Junction 永远指向仓库里的目录，天然安全；goal.md 和 ulw.md 是硬链接，`git pull` 重写文件时可能把链接断成旧副本，更新后建议核对一次两个命令文件的内容，不一致就重建链接

## 第四步 验证

- [ ] 让配置生效：`/reload` 强制重载（OpenCode V2 会监听配置文件自动重载，重启兜底也行），输入 `/` 能看到 `goal` 和 `ulw` 两个命令
- [ ] 对话里 `goal_set` / `goal_done` 工具存在，设置目标后空闲会被自动续跑（上限 40 轮，状态存 `~/.config/opencode/goals/<sessionID>.json`）
- [ ] 随便派一个子代理，如 explore，不报 模型不存在或已停用
- [ ] TUI 中出现子代理状态板

## 常见故障

- 派子代理报 模型不存在或已停用：`subagents.json` 里 `model` 的基础名不在 `opencode models` 列表里，或 `effort` 值不在该模型声明的 reasoning effort 档位里，按第二步规则改正后重新运行 sync-routes
- `sync-routes.mjs` 报 找不到 `"model"` 行：`opencode.json` 缺顶层 `model` 配置
- `/goal` 不出现：全局 `commands/goal.md` 链接没建好或目标路径失效
- 卸载：删 `plugins` 数组里的条目、删 `subagents.json`、断开链接，`goals` 目录可选清
