// CLI 入口：默认对账写入，--clean 移除生成段。逻辑在 routes.ts，与插件 setup 共用一份
import { cleanRoutes, readRoutes, syncRoutes } from "./routes.ts"

if (process.argv.includes("--clean")) {
  console.log(cleanRoutes() ? "已从 opencode.json 移除路由生成段" : "opencode.json 没有生成段，无需清理")
} else {
  const routes = readRoutes()
  const changed = syncRoutes()
  console.log(changed ? `已写入 ${routes.length} 条模型路由` : `opencode.json 与 ${routes.length} 条路由一致，无变化`)
  for (const route of routes) {
    const { providerID, id, variant } = route.model
    console.log(`  ${route.name.padEnd(11)} ${providerID}/${id}${variant ? `#${variant}` : ""}`)
  }
}
