# 安装 Subagents Route

这份文档给人和 agent 都能照做，目标读者是把项目部署到 OpenCode 全局配置里。装完得到三大功能：子代理模型路由、plan 转 build 移交、TUI 子代理状态板

## 前置要求

- Node.js 23.6+（CLI 直接加载 TS 模块），已安装 OpenCode
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
4. 路由对账时机：插件在 OpenCode 启动与执行 `/reload` 时把 `subagents.json` 的路由对账写进 `opencode.json`。编辑 `subagents.json` 期间不落盘，避免保存动作引发配置级联重载；改完在 TUI 执行 `/reload`（或重启）生效。需要手动强制对账时运行

```bash
node <插件目录>/sync-routes.mjs
```

或在插件目录下 `npm run sync`。对账只在内容有差异时落盘，重复运行安全

想移除生成段用 `npm run clean`（等同 `node sync-routes.mjs --clean`）。删后下次 `/reload` 或启动会对账写回；彻底移除需先从 `plugins` 数组删掉插件条目再执行 clean

注意生成内容夹在 `BEGIN subagents-route` 和 `END subagents-route` 注释标记之间，不动其他内容，行尾跟随目标文件。带 `effort` 的条目会展开成 OpenCode 官方的 `providerID` + `model` + `variant` 形态，不带的保持 `provider/model` 字符串原样

## 第三步 接入 commands 与 agents

把 `<插件目录>/.opencode` 下 `agents` 和 `commands` 的每个 `.md` 文件逐个软链接到全局配置目录，不要整目录挂载。软链接记录的是目标路径，`git pull` 重写文件后链接仍有效；硬链接会在那一刻断成旧副本，所以不用

Windows 建软链接需要开启系统「开发者模式」，否则用管理员 PowerShell 执行。注意开发者模式只对开启后新启动的进程生效：刚开完就报 Administrator privilege required 的话，重启终端或 OpenCode 再试即可免提权。agents 部分：

```powershell
$src = "<插件目录>\.opencode\agents"; $dst = "$env:USERPROFILE\.config\opencode\agents"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Get-ChildItem "$src\*.md" | ForEach-Object { New-Item -ItemType SymbolicLink -Path "$dst\$($_.Name)" -Target $_.FullName }
```

commands 只挂 `ulw.md`（目录不存在时先 `New-Item -ItemType Directory` 创建 `~/.config/opencode/commands`）：

```powershell
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.config\opencode\commands\ulw.md" -Target "<插件目录>\.opencode\commands\ulw.md"
```

macOS/Linux 的 `ln -s` 本来就是软链接，行为一致：

```bash
mkdir -p ~/.config/opencode/agents ~/.config/opencode/commands
ln -s <插件目录>/.opencode/agents/*.md ~/.config/opencode/agents/
ln -s <插件目录>/.opencode/commands/ulw.md ~/.config/opencode/commands/
```

如果全局已经存在同名文件或目录：先逐字节对比内容与仓库版本一致（`certutil -hashfile` 或 `sha256sum`），一致才删原件建链接；不一致先备份再问维护者

语义等同 Windows 快捷方式：真实文件全在插件目录里，全局配置目录只是指针，删了原文所有链接一起失效。逐文件链接的好处：想停用某个 agent 直接删对应链接即可，不动其他；仓库更新后全局配置自动跟着变。仓库目录整体挪走或改名会让所有链接失效，恢复方式是按本节命令重跑一遍

## 第四步 验证

- [ ] 让配置生效：`/reload` 强制重载（OpenCode V2 会监听配置文件自动重载，重启兜底也行），输入 `/` 能看到 `ulw` 命令；持续目标用官方 `/goal`（OpenCode v2.2.1+ 内置）
- [ ] 逐文件软链接建好：`Get-ChildItem ~/.config/opencode/agents | Select-Object Name,LinkType` 每个文件 LinkType 显示 SymbolicLink
- [ ] 对话里 `plan_build` 工具存在，给出计划文件路径后能把会话切到 build agent
- [ ] 随便派一个子代理，如 explore，不报 模型不存在或已停用
- [ ] 改 `subagents.json` 任一 model 保存后执行 `/reload`，生成段与状态板花名册更新为新路由
- [ ] TUI 中出现子代理状态板

## 常见故障

- 派子代理报 模型不存在或已停用：`subagents.json` 里 `model` 的基础名不在 `opencode models` 列表里，或 `effort` 值不在该模型声明的 reasoning effort 档位里，按第二步规则改正后保存即自动生效（或手动 `npm run sync`）
- `sync-routes.mjs` 报 找不到 `"model"` 行：`opencode.json` 缺顶层 `model` 配置
- 删了生成段又在 /reload 后回来：插件对账的预期行为；要彻底移除按第二步说明，先删 `plugins` 条目再 `npm run clean`
- `/goal` 行为异常：官方命令与插件无关，检查 OpenCode 版本是否 v2.2.1+，或全局 `commands/` 下是否残留同名自制 goal.md 遮蔽了内置命令
- 卸载：删 `plugins` 数组里的条目，跑 `npm run clean` 移除生成段，删 `subagents.json`，断开链接；旧的 `goals` 目录可选清
