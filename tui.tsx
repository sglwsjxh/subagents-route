import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { For, Show, createEffect, onCleanup } from "solid-js"
import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

type GoalFile = {
  text: string
  started: number
  done: boolean
}

// 与 server 侧共用同一份 goal 文件，这里只读
function readGoal(sessionID: string): GoalFile | undefined {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  const file = join(base, "opencode", "goals", `${sessionID}.json`)
  if (!existsSync(file)) return undefined
  return JSON.parse(readFileSync(file, "utf8")) as GoalFile
}

type StateName = "running" | "retry" | "idle" | "done" | "failed" | "interrupted"

type Live = {
  state?: StateName
  detail?: string
  input?: number
  output?: number
  cache?: number
  started?: number
  ended?: number
}

type Entry = {
  key: string
  title: string
  titleColor: string
  agent: string
  agentColor: string
  model: string
  tokens: string
  started: number
  ended: number
}

type Model = {
  name: string
  model: string
  color: string
}

type Board = {
  tick: number
  now: number
  entries: Entry[]
  models: Model[]
  goalText: string
  goalStarted: number
}

const NAME = 11
const RULE = "─".repeat(24)
// 侧栏真实宽度拿不到（sidebar.content 插槽只给 sessionID），按显示宽度截断保证不折行
const MAXW = 36

const SYMBOL: Record<StateName, string> = {
  running: "●",
  retry: "↻",
  idle: "○",
  done: "✓",
  failed: "✕",
  interrupted: "⊘",
}

// 主题只保证了 text.base 与 text.muted 两个 token，其余状态色用跨明暗主题都可读的固定值
const STATE_COLOR: Partial<Record<StateName, string>> = {
  retry: "#D29922",
  done: "#3FB950",
  failed: "#F85149",
  interrupted: "#A371F7",
}


// 东亚宽字符按两列计：假名、汉字、谚文、全角标点与兼容区
function isWide(char: string) {
  const code = char.codePointAt(0) ?? 0
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  )
}

function cells(value: string) {
  let width = 0
  for (const char of value) width += isWide(char) ? 2 : 1
  return width
}

// 按终端列数截断，中文标题按两列计
function fit(value: string, limit: number) {
  if (cells(value) <= limit) return value
  let out = ""
  let used = 0
  for (const char of value) {
    const wide = isWide(char) ? 2 : 1
    if (used + wide > limit - 1) break
    out += char
    used += wide
  }
  return `${out}…`
}

// 按终端列数折行，goal 这类长文本要完整显示
function wrap(value: string, limit: number) {
  const lines: string[] = []
  let line = ""
  let used = 0
  for (const char of value) {
    const width = isWide(char) ? 2 : 1
    if (used + width > limit) {
      lines.push(line)
      line = ""
      used = 0
    }
    line += char
    used += width
  }
  if (line) lines.push(line)
  return lines
}

function pad(value: string, width: number) {
  const gap = width - cells(value)
  return gap > 0 ? value + " ".repeat(gap) : value
}

function tail(value: string) {
  return value.includes("/") ? value.slice(value.lastIndexOf("/") + 1) : value
}

// K 与 M 分档：M 留一位小数，10K 以上不显小数
function unit(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return String(value)
}

// 运行时长：不足 1m 出 32s，1m 以上出 1m25s，1h 以上出 1h5m
function span(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h${minutes}m`
  if (minutes > 0) return `${minutes}m${seconds}s`
  return `${seconds}s`
}

function rosterFile() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(base, "opencode", "subagents.json")
}

let rosterCache: { mtime: number; items: Model[] } | null = null

function readRoster(colorOf: (name: string) => string): Model[] {
  const file = rosterFile()
  const mtime = statSync(file).mtimeMs
  if (!rosterCache || rosterCache.mtime !== mtime) {
    const parsed = JSON.parse(readFileSync(file, "utf8"))
    const list: any[] = parsed.subagents
    rosterCache = {
      mtime,
      items: list
        .filter((item) => item?.name && item?.model)
        .map((item) => ({ name: String(item.name), model: tail(String(item.model)), color: "" })),
    }
  }
  // 颜色不进缓存：agent color 可能晚于首次渲染才到位，缓存命中也要重算
  return rosterCache.items.map((item) => ({ ...item, color: colorOf(item.name) }))
}

export default Plugin.define({
  id: "subagents-board",
  setup(context) {
    const theme = context.theme
    const [board, update] = context.storage.memory<Board>("agent-board", {
      initial: { tick: 0, now: Date.now(), entries: [], models: [], goalText: "", goalStarted: 0 },
    })

    // 事件累加的实时数据放普通 Map：渲染读 store，刷新逻辑读这里，避免 Solid 追踪自激
    const live = new Map<string, Live>()

    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    let pending = false

    const mark = (sessionID: string | undefined, patch: Live) => {
      if (!sessionID) return
      live.set(sessionID, { ...live.get(sessionID), ...patch })
    }

    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        update((draft) => {
          draft.tick += 1
        })
      }, 150)
    }

    const stoppers = [
      context.data.on("session.status", (event) => {
        const status = event.data?.status
        const id = event.data?.sessionID
        if (status?.type === "busy") mark(id, { state: "running" })
        else if (status?.type === "retry") {
          mark(id, { state: "retry", detail: `x${(status.attempt ?? 0) + 1}` })
        } else mark(id, { state: "idle" })
        schedule()
      }),
      context.data.on("session.usage.updated", (event) => {
        const tokens = event.data?.tokens
        mark(event.data?.sessionID, {
          input: tokens?.input,
          output: tokens?.output,
          cache: tokens?.cache?.read,
        })
        schedule()
      }),
      context.data.on("session.execution.started", (event) => {
        mark(event.data?.sessionID, { state: "running", detail: "", started: Date.now() })
        schedule()
      }),
      context.data.on("session.execution.succeeded", (event) => {
        mark(event.data?.sessionID, { state: "done", detail: "", ended: Date.now() })
        schedule()
      }),
      context.data.on("session.execution.failed", (event) => {
        mark(event.data?.sessionID, { state: "failed", detail: "", ended: Date.now() })
        schedule()
      }),
      context.data.on("session.execution.interrupted", (event) => {
        mark(event.data?.sessionID, { state: "interrupted", detail: "", ended: Date.now() })
        schedule()
      }),
      context.data.on("session.idle", (event) => {
        const id = event.data?.sessionID
        if (id && !live.get(id)?.state) mark(id, { state: "idle" })
        schedule()
      }),
      context.data.on("session.created", schedule),
      context.data.on("session.deleted", schedule),
      context.data.on("session.renamed", schedule),
      context.data.on("session.moved", schedule),
    ]

    // 每秒推进时间基准，渲染直接用它算时长，不再依赖 refresh
    const heartbeat = setInterval(() => {
      update((draft) => {
        draft.now = Date.now()
      })
    }, 1000)

    async function refresh(sessionID: string) {
      const root = context.data.session.root(sessionID)

      const ids = new Set<string>()
      for (const id of context.data.session.family(root)) if (id !== root) ids.add(id)

      // 缓存里可能没有子代理会话，用 parentID 直接问服务端补一层；主控会话不计入统计
      const found = (await context.client.session.list({ parentID: root, limit: 64 })).data
      for (const session of found) if (session.id !== root) ids.add(session.id)

      const sessions: any[] = []
      for (const id of ids) {
        let session = context.data.session.get(id)
        if (!session) {
          await context.data.session.sync(id)
          session = context.data.session.get(id)
        }
        if (session && session.id !== root) sessions.push(session)
      }
      // 从新到旧，新派生的子代理排在面板顶部
      sessions.sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))

      const location = context.location ?? context.data.location.default()
      // TUI 客户端缓存里的 agent 列表可能还没有 color，直接问服务端要
      const agents = await context.client.agent
        .list({ location: { directory: location.directory } })
        .then((listed) => listed.data ?? [])
        .catch((error) => {
          console.error("[subagents-board] agent 列表获取失败:", error)
          return context.data.location.agent.list(location) ?? []
        })
      const known = new Map<string, any>()
      for (const agent of agents) if (agent?.id) known.set(agent.id, agent)

      const entries: Entry[] = []
      for (const session of sessions) {
        const data = live.get(session.id) ?? {}
        const state =
          data.state ??
          (context.data.session.status(session.id) === "running"
            ? "running"
            : session.outcome === "failed"
              ? "failed"
              : session.outcome === "interrupted"
                ? "interrupted"
                : session.outcome === "succeeded"
                  ? "done"
                  : "idle")

        const agentName = (session.agent ?? "session") as string
        const agent = known.get(agentName)
        const title = (session.title || agentName) as string
        const modelRaw = String(session.model?.id ?? agent?.model?.id ?? "")
        const input = data.input ?? session.tokens?.input ?? 0
        const output = data.output ?? session.tokens?.output ?? 0
        const cache = data.cache ?? session.tokens?.cache?.read ?? 0
        const started = data.started ?? session.time?.created ?? Date.now()
        // ended 为 0 表示还在跑，渲染时用 board.now 现算，避免每秒跑一次 refresh
        const ended =
          state === "running" || state === "retry"
            ? 0
            : data.ended ?? session.time?.idle ?? session.time?.updated ?? Date.now()

        entries.push({
          key: session.id,
          title: fit(` ${SYMBOL[state]} ${title}`, MAXW),
          titleColor:
            state === "running"
              ? theme.text.base
              : STATE_COLOR[state] ?? (state === "idle" ? theme.text.muted : (agent?.color ?? theme.text.base)),
          agent: `   ${pad(agentName, NAME)}`,
          agentColor: agent?.color ?? theme.text.base,
          model: fit(tail(modelRaw), MAXW - NAME - 5),
          tokens: fit(
            `${unit(input)} (${unit(cache)}) in ${unit(output)} out${data.detail ? `  ${data.detail}` : ""}`,
            MAXW - 11,
          ),
          started,
          ended,
        })
      }

      const goal = readGoal(root)

      update((draft) => {
        draft.entries = entries
        draft.models = readRoster((name) => known.get(name)?.color ?? theme.text.muted).map((item) => ({
          ...item,
          model: fit(item.model, MAXW - 2),
        }))
        draft.goalText = goal && !goal.done ? goal.text : ""
        draft.goalStarted = goal?.started ?? 0
      })
    }

    async function run(sessionID: string) {
      if (inFlight) {
        pending = true
        return
      }
      inFlight = true
      try {
        await refresh(sessionID)
      } finally {
        inFlight = false
        if (pending) {
          pending = false
          schedule()
        }
      }
    }

    context.ui.slot({
      append: "sidebar.content",
      render: (input) => <AgentBoard sessionID={input.sessionID} />,
    })

    function AgentBoard(props: { sessionID: string }) {
      createEffect(() => {
        const tick = board.tick
        const id = props.sessionID
        if (!id) return
        void run(id)
      })

      onCleanup(() => {
        if (timer) clearTimeout(timer)
      })

      return (
        <box>
          <Show when={board.goalText}>
            <text fg={theme.text.base}>{`Goal (${span(board.now - board.goalStarted)})`}</text>
            <For each={wrap(board.goalText, MAXW)}>
              {(line) => <text fg={theme.text.muted}>{line}</text>}
            </For>
            <text>{" "}</text>
          </Show>
          <text fg={theme.text.base}>{"SubAgents"}</text>
          <Show when={board.entries.length > 0}>
            <text fg={theme.text.muted}>{RULE}</text>
            <For each={board.entries}>
              {(entry) => (
                <box>
                  <text fg={entry.titleColor}>{entry.title}</text>
                  <text>
                    <span fg={entry.agentColor}>{entry.agent}</span>
                    <span fg={theme.text.muted}>{`  ${entry.model}`}</span>
                  </text>
                  <text fg={theme.text.muted}>{`   ${entry.tokens}  ${span((entry.ended || board.now) - entry.started)}`}</text>
                  <text>{" "}</text>
                </box>
              )}
            </For>
          </Show>
          <text fg={theme.text.muted}>{RULE}</text>
          <For each={board.models}>
            {(model) => (
              <box>
                <text fg={model.color}>{model.name}</text>
                <text fg={theme.text.muted}>{`  ${model.model}`}</text>
              </box>
            )}
          </For>
        </box>
      )
    }

    return () => {
      clearInterval(heartbeat)
      for (const stop of stoppers) stop()
      if (timer) clearTimeout(timer)
    }
  },
})
