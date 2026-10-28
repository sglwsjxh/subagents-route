// 模型路由唯一真相源：读 subagents.json，对账写 opencode.json 的 agents 生成段
import { readFileSync, statSync, writeFileSync } from "node:fs"
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

// effort 映射为 variant 字段；description、concurrency 等多余字段忽略，老部署文件不炸
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
    if (item?.effort) ref.variant = String(item.effort)
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
const ANCHOR = /(    "model":\s*"[^"]*",\r?\n)/

// config 编码形态：无 effort 保持 provider/model 字符串，带 effort 展开 providerID + model + variant
function modelRefJson(route: Route) {
  const { providerID, id, variant } = route.model
  if (!variant) return JSON.stringify(`${providerID}/${id}`)
  return JSON.stringify({ providerID, model: id, variant })
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
  if (!hasBlock && !ANCHOR.test(text)) throw new Error('opencode.json 里找不到 "model" 行，无法插入 agents 段')
  const next = hasBlock ? text.replace(MARKER, () => block) : text.replace(ANCHOR, `$1${block}`)
  if (next === text) return false
  writeFileSync(file, next, "utf8")
  return true
}

// 移除生成段，供卸载场景使用；插件仍启用时下次重载会把段写回来
export function cleanRoutes(): boolean {
  const file = configFile()
  const text = readFileSync(file, "utf8")
  if (!MARKER.test(text)) return false
  writeFileSync(file, text.replace(MARKER, ""), "utf8")
  return true
}
