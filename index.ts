import { Plugin } from "@opencode/plugin"
import { syncRoutes } from "./routes.ts"

export default Plugin.define({
  id: "subagents-route",
  async setup(ctx) {
    // 仅在启动与 /reload（插件 setup 重跑）时对账 opencode.json 生成段；编辑 subagents.json 不落盘，避免每次保存引发配置级联重载。
    // 有差异才写盘，写盘触发的再次对账比对相等即停，无循环
    try {
      if (syncRoutes()) console.log("[subagents-route] 路由对账：生成段已更新")
    } catch (error) {
      console.error("[subagents-route] 路由对账失败:", error)
    }

    await ctx.tool.transform((editor) => {
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
  },
})
