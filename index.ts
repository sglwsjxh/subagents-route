import { Plugin } from "@opencode/plugin"
import { isBusy, listGoals, readGoal, removeGoal, writeGoal } from "./goal.ts"
import { syncRoutes } from "./routes.ts"

// 续跑上限：防止目标判断写错时无限烧配额
const MAX_TURNS = 40
const RESUME_GAP = 2000
// wait 提前返回时的兜底，防止同一轮连发
const RESUME_DEBOUNCE = 10000

// 注入文本与 AGENTS.md 同级：会话指令通道，放在系统提示词最后一段
function goalInstruction(text: string, source?: string) {
  return [
    "本次会话有一个持续目标，地位同 AGENTS.md，未完成前一直有效。",
    "",
    `目标：${text}`,
    source ? `来源：${source}` : "",
    "",
    "执行规则：",
    "- 每轮先核对目标当前完成到哪一步，已完成的部分不要重做",
    "- 未完成就继续推进，不要停下来汇报进度",
    "- 全部完成时调用 goal_done 结束，否则会话空闲后会被自动要求继续",
  ]
    .filter((line) => line !== "")
    .join("\n")
}

export default Plugin.define({
  id: "subagents-route",
  async setup(ctx) {
    // 每个会话一条续跑链
    const loops = new Set<string>()

    // 仅在启动与 /reload（插件 setup 重跑）时对账 opencode.json 生成段；编辑 subagents.json 不落盘，避免每次保存引发配置级联重载。
    // 有差异才写盘，写盘触发的再次对账比对相等即停，无循环
    try {
      if (syncRoutes()) console.log("[subagents-route] 路由对账：生成段已更新")
    } catch (error) {
      console.error("[subagents-route] 路由对账失败:", error)
    }

    // 主会话与全部子会话都空闲才续跑，子代理还在跑时不插话；wait 对空闲会话立即返回（实测语义）
    const waitForChildren = async (sessionID: string) => {
      for (;;) {
        const listed: any = await ctx.session.list({ parentID: sessionID, limit: 64 })
        const rows: any[] = listed?.data ?? listed ?? []
        const busy = rows.filter((s) => s.id !== sessionID && isBusy(s))
        if (busy.length === 0) return
        // 孩子可能在等待中被删除或中断，单个 wait 失败不影响，重列时拿最新忙集合
        for (const child of busy) await ctx.session.wait({ sessionID: child.id }).catch(() => {})
      }
    }

    const startResumeLoop = (sessionID: string) => {
      if (loops.has(sessionID)) return
      loops.add(sessionID)
      void (async () => {
        let lastSentAt = 0
        for (;;) {
          // 阻塞到会话空闲。session.idle 事件不进插件事件流，只能用 session.wait 等
          await ctx.session.wait({ sessionID })

          // 主会话空闲后还要等所有子代理会话空闲，避免 subagent 跑在结果回收前插话
          await waitForChildren(sessionID)

          // 刚发过就等下一轮 wait，避免同一轮连发
          if (Date.now() - lastSentAt < RESUME_DEBOUNCE) {
            await new Promise((resolve) => setTimeout(resolve, RESUME_GAP))
            continue
          }

          const goal = readGoal(sessionID)
          if (!goal || goal.done) break
          if (goal.turns >= MAX_TURNS) break

          await new Promise((resolve) => setTimeout(resolve, RESUME_GAP))

          const latest = readGoal(sessionID)
          if (!latest || latest.done) break
          if (latest.turns >= MAX_TURNS) break
          // 文件里记着上次发送时间，插件重载后旧链还在时靠这个兜住
          if (latest.sentAt && Date.now() - latest.sentAt < RESUME_DEBOUNCE) {
            await new Promise((resolve) => setTimeout(resolve, RESUME_GAP))
            continue
          }

          lastSentAt = Date.now()
          writeGoal(sessionID, { ...latest, turns: latest.turns + 1, sentAt: lastSentAt })
          // synthetic 进上下文但不显示在对话流里，resume: true 照样触发新一轮
          await ctx.session.synthetic({
            sessionID,
            text: [
              "目标还没完成，继续。",
              "",
              `目标：${latest.text}`,
              latest.source ? `来源：${latest.source}` : "",
              "",
              `这是第 ${latest.turns + 1}/${MAX_TURNS} 轮续跑。先核对当前进度，已完成的不重做，未完成的接着做。`,
              "全部达成后调用 goal_done，否则还会被要求继续。",
            ]
              .filter((line) => line !== "")
              .join("\n"),
            resume: true,
          })
          // 等新 turn 在服务端记账，否则下一个 wait 会立刻返回并再发一轮
          await new Promise((resolve) => setTimeout(resolve, RESUME_GAP))
        }
        loops.delete(sessionID)
      })().catch((error) => {
        loops.delete(sessionID)
        console.error("[subagents-route] 续跑链结束:", error)
      })
    }

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "goal_set",
        description:
          "把一个持续目标固定到当前会话。之后每轮都会把目标注入系统提示词，并在会话空闲时自动要求继续，直到调用 goal_done。目标要写成一两句话，包含明确的完成标准。",
        input: {
          type: "object",
          properties: {
            goal: { type: "string", description: "目标，一句话到两句话，含完成标准" },
            source: { type: "string", description: "目标来源，比如 ./plans/login.md 或用户原话" },
          },
          required: ["goal"],
          additionalProperties: false,
        },
        async execute(input: { goal: string; source?: string }, tool) {
          const sessionID = tool.sessionID
          writeGoal(sessionID, { text: input.goal, source: input.source, started: Date.now(), turns: 0, done: false })
          // 插件上下文够不到 session.instructions，用 synthetic 消息把目标写进上下文；
          // resume: false 避免在工具执行中再起一轮
          await ctx.session.synthetic({
            sessionID,
            text: goalInstruction(input.goal, input.source),
            description: "goal",
            resume: false,
          })
          startResumeLoop(sessionID)
          return { content: `goal 已固定：${input.goal}` }
        },
      })

      editor.add({
        name: "goal_done",
        description: "标记当前会话的目标已经完成，停止自动续跑并移除注入的目标。只有在确认目标全部达成时才调用。",
        input: { type: "object", properties: {}, additionalProperties: false },
        async execute(_input: unknown, tool) {
          removeGoal(tool.sessionID)
          return { content: "goal 已结束，自动续跑停止" }
        },
      })

      editor.add({
        name: "plan_build",
        description:
          "计划落盘并经用户确认后切到 build 执行。把当前会话切到 build agent，注入按计划执行的指令，本轮结束后由 build 接手。只在用户明确选择切换时调用，调用后本轮直接收尾，不要再输出计划内容。",
        input: {
          type: "object",
          properties: {
            plan: { type: "string", description: "计划文件路径，比如 plans/login-refactor.md" },
          },
          required: ["plan"],
          additionalProperties: false,
        },
        async execute(input: { plan: string }, tool) {
          const sessionID = tool.sessionID
          // 先切 agent 再注入指令，resume 触发的下一轮就由 build 跑
          await ctx.session.switchAgent({ sessionID, agent: "build" })
          await ctx.session.synthetic({
            sessionID,
            text: [
              "计划已确认，从现在起由 build 接手执行。",
              "",
              `计划文件：${input.plan}`,
              "",
              "执行规则：",
              "- 先读计划文件，按任务依赖表和并行分组推进",
              "- 每个任务完成后按计划里的验收标准检查",
              "- 计划全部完成时向用户汇报结果",
            ].join("\n"),
            description: "plan_build",
            resume: true,
          })
          return { content: `已切换到 build，${input.plan} 的执行指令已注入，本轮收尾即可` }
        },
      })
    })

    // 插件重启后，把还没完成的 goal 重新接上续跑
    for (const sessionID of listGoals()) {
      const goal = readGoal(sessionID)
      if (goal && !goal.done) startResumeLoop(sessionID)
    }
  },
})
