import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type Goal = {
  text: string
  source?: string
  started: number
  turns: number
  done: boolean
  // 最近一次发出续跑的时间，用来避免插件重载后与旧链重复发送
  sentAt?: number
}

function goalDir() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(base, "opencode", "goals")
}

function goalPath(sessionID: string) {
  return join(goalDir(), `${sessionID}.json`)
}

// 文件不存在是正常状态，解析失败直接抛，不做兜底
export function readGoal(sessionID: string): Goal | undefined {
  const file = goalPath(sessionID)
  if (!existsSync(file)) return undefined
  return JSON.parse(readFileSync(file, "utf8")) as Goal
}

export function writeGoal(sessionID: string, goal: Goal) {
  mkdirSync(goalDir(), { recursive: true })
  writeFileSync(goalPath(sessionID), JSON.stringify(goal, null, 2), "utf8")
}

export function removeGoal(sessionID: string) {
  rmSync(goalPath(sessionID), { force: true })
}

// 列出所有带目标的会话，插件重启后用来把没做完的 goal 重新接上
export function listGoals(): string[] {
  const dir = goalDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
}

// 会话忙判定：time.idle 缺失（从未空闲过）或 updated 晚于 idle（有新活动未收口）视为在跑
export function isBusy(session: { time?: { idle?: number; updated?: number } }): boolean {
  const idle = session?.time?.idle ?? 0
  return idle === 0 || (session?.time?.updated ?? 0) > idle
}
