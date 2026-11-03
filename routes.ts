// 模型路由唯一真相源：读 subagents.json，对账写 opencode.json 的 agents 生成段
import { readFileSync, statSync, writeFileSync, renameSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type ModelRef = { providerID: string; id: string; variant?: string }
export type Route = { name: string; model: ModelRef }

function configDir() {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
}

export function routesFile() {
  return join(configDir(), "opencode", "subagents.json")
}

export function configFile() {
  return join(configDir(), "opencode", "opencode.json")
}

// effort 映射为 variant 字段；description、concurrency 等多余字段忽略，老部署文件不炸。
// concurrency 不是插件强制：对账只做模型路由，并发上限由 ulw 等工作流提示词自行遵守
const EFFORTS = new Set(["low", "medium", "high", "max"])

function parseRoutes(text: string): Route[] {
  const parsed = JSON.parse(text)
  const list: any[] = Array.isArray(parsed?.subagents) ? parsed.subagents : []
  if (list.length === 0) throw new Error("subagents.json 里没有 subagents")
  return list.map((item) => {
    const name = String(item?.name ?? "")
    const model = String(item?.model ?? "")
    if (!name) throw new Error("路由条目缺少 name")
    if (model.includes("#")) throw new Error(`[${name}] model 不能带 # 后缀，思考强度写在 effort 字段`)
    const slash = model.indexOf("/")
    if (slash <= 0 || slash === model.length - 1) throw new Error(`[${name}] model 必须是 provider/model 形式`)
    const ref: ModelRef = { providerID: model.slice(0, slash), id: model.slice(slash + 1) }
    if (item?.effort) {
      const effort = String(item.effort)
      // 档位是否被该模型支持要到派发时才知道，这里拦拼写错误，非标准值提示但不阻塞
      if (!EFFORTS.has(effort))
        console.warn(`[subagents-route] [${name}] effort "${effort}" 不在 low/medium/high/max 里，请确认该模型确实声明了此 variant`)
      ref.variant = effort
    }
    return { name, model: ref }
  })
}

let cache: { mtime: number; routes: Route[] } | null = null

// mtime 没变直接吃缓存；文件缺失或解析失败抛错，由调用方兜底
export function readRoutes(): Route[] {
  const file = routesFile()
  const mtime = statSync(file).mtimeMs
  if (cache && cache.mtime === mtime) return cache.routes
  const routes = parseRoutes(readFileSync(file, "utf8"))
  cache = { mtime, routes }
  return routes
}

const MARKER = /[ \t]*\/\/ BEGIN subagents-route[\s\S]*?\/\/ END subagents-route(?:\r?\n)?/
// 行首锚定 + m/g 标志：m.index 就是行首，topLevelAt 从行首数深度才准确；\s* 只吃行内空白
const ANCHOR = /^    "model":\s*"[^"]*",\r?\n/gm

// 从头扫到 index，统计字符串外的大括号深度；深度为 1 说明还没离开顶层对象，锚点行确实在顶层
function topLevelAt(text: string, index: number): boolean {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = 0; i < index; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === "\\") escape = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === "{" || ch === "[") depth++
    else if (ch === "}" || ch === "]") depth--
  }
  return depth === 1
}

// config 编码形态：无 effort 保持 provider/model 字符串，带 effort 展开 providerID + model + variant
function modelRefJson(route: Route) {
  const { providerID, id, variant } = route.model
  if (!variant) return JSON.stringify(`${providerID}/${id}`)
  return JSON.stringify({ providerID, model: id, variant })
}

// 原子写：先写同目录临时文件再 rename。崩溃或并发时不会留下半个 opencode.json
function atomicWrite(file: string, content: string) {
  const tmp = file + ".tmp"
  writeFileSync(tmp, content, "utf8")
  try {
    renameSync(tmp, file)
  } catch (error) {
    unlinkSync(tmp)
    throw error
  }
}

// 行尾跟随目标文件：比对不写盘的前提是生成结果字节级稳定，混行尾会造成永远"有差异"的写循环
function renderBlock(routes: Route[], eol: string) {
  const lines = [
    "    // BEGIN subagents-route 由 sync-routes.mjs 从 subagents.json 生成，勿手改",
    '    "agents": {',
    ...routes.map(
      (route, index) =>
        `        ${JSON.stringify(route.name)}: { "model": ${modelRefJson(route)} }${index < routes.length - 1 ? "," : ""}`,
    ),
    "    },",
    "    // END subagents-route",
  ]
  return lines.join(eol) + eol
}

// 对账写 opencode.json 生成段；内容无差异不落盘，返回是否发生变化。
// 不落盘是防重载循环的关键：写盘 → 配置重载 → setup 再对账 → 相等 → 停
export function syncRoutes(): boolean {
  const file = configFile()
  const text = readFileSync(file, "utf8")
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const block = renderBlock(readRoutes(), eol)
  const hasBlock = MARKER.test(text)
  // 行首锚定逐个候选：topLevelAt 从行首数深度，取第一个通过校验的行首锚点，嵌套 model 行不会误插
  let anchor: { start: number; end: number } | null = null
  if (!hasBlock) {
    let m: RegExpExecArray | null
    while ((m = ANCHOR.exec(text))) {
      if (topLevelAt(text, m.index)) {
        anchor = { start: m.index, end: m.index + m[0].length }
        break
      }
    }
    if (!anchor) throw new Error('opencode.json 里找不到顶层的 "model" 行，无法插入 agents 段')
  }
  // 切片拼接而非 replace：block 里的 $ 字符（如模型 ID 含 $&）不会被当替换模式展开。
  // block 插在锚点行之后，锚点行（顶层 model 配置）本身保留
  const next = hasBlock
    ? text.replace(MARKER, () => block)
    : text.slice(0, anchor!.end) + block + text.slice(anchor!.end)
  if (next === text) return false
  atomicWrite(file, next)
  return true
}

// 移除生成段，供卸载场景使用；插件仍启用时下次重载会把段写回来
export function cleanRoutes(): boolean {
  const file = configFile()
  const text = readFileSync(file, "utf8")
  if (!MARKER.test(text)) return false
  atomicWrite(file, text.replace(MARKER, ""))
  return true
}
