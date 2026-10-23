// 从 subagents.json 生成 opencode.json 的 agents 段，保持单一真相源
import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
const routesFile = join(configDir, "opencode", "subagents.json")
const configFile = join(configDir, "opencode", "opencode.json")

const { subagents } = JSON.parse(readFileSync(routesFile, "utf8"))
if (!Array.isArray(subagents) || subagents.length === 0) throw new Error("subagents.json 里没有 subagents")

// effort 是可选字段，思考强度不进模型名，映射到官方 model variant 展开形态
function modelRef(route) {
  if (route.model.includes("#")) throw new Error(`[${route.name}] model 不能带 # 后缀，思考强度写在 effort 字段`)
  const slash = route.model.indexOf("/")
  if (slash <= 0 || slash === route.model.length - 1) throw new Error(`[${route.name}] model 必须是 provider/model 形式`)
  if (!route.effort) return JSON.stringify(route.model)
  const providerID = route.model.slice(0, slash)
  const model = route.model.slice(slash + 1)
  return JSON.stringify({ providerID, model, variant: route.effort })
}

const lines = [
  "    // BEGIN subagents-route 由 sync-routes.mjs 从 subagents.json 生成，勿手改",
  '    "agents": {',
  ...subagents.map(
    (route, index) =>
      `        ${JSON.stringify(route.name)}: { "model": ${modelRef(route)} }${index < subagents.length - 1 ? "," : ""}`,
  ),
  "    },",
  "    // END subagents-route",
].join("\n")

let text = readFileSync(configFile, "utf8")
const marker = /[ \t]*\/\/ BEGIN subagents-route[\s\S]*?\/\/ END subagents-route\n?/
const anchor = /(    "model":\s*"[^"]*",\r?\n)/

if (marker.test(text)) {
  text = text.replace(marker, `${lines}\n`)
} else {
  if (!anchor.test(text)) throw new Error('opencode.json 里找不到 "model" 行，无法插入 agents 段')
  text = text.replace(anchor, `$1${lines}\n`)
}

writeFileSync(configFile, text, "utf8")
console.log(`已写入 ${subagents.length} 条模型路由`)
for (const route of subagents) console.log(`  ${route.name.padEnd(11)} ${route.model}`)
