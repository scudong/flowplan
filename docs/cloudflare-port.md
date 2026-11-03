# flowplan → Cloudflare 全托管移植（进行中）

目标：flowplan 完全跑在 Cloudflare 免费档，不依赖本机。零绑卡。

## 已验证的事实（2026-11-03，cloud/spike.ts 实测）

| 项 | 结果 |
|---|---|
| workerd DO SQLite（`ctx.storage.sql`） | ✅ 同步 API，免费档可用 |
| FTS5 + trigram tokenizer + MATCH | ✅ |
| 触发器（含 WHEN 子查询）、级联删除、BLOB、AUTOINCREMENT、json_object、unixepoch() | ✅ |
| `PRAGMA table_info` 经 exec 可用；`rowsWritten`、`changes()`、`last_insert_rowid()` 可用 | ✅ |
| 参数绑定（int/real/null/text/BLOB-in） | ✅；**BLOB 读回是 ArrayBuffer，shim 转 Uint8Array** |
| `BEGIN/COMMIT` 语句 | ❌ 被拒 → 用 `state.storage.transactionSync(fn)`（回滚语义已实测 ✅） |
| `sql.prepare()`（DO API 没有） | shim 里实现 |
| `node:sqlite` 模块在 workerd | ❌ Illegal constructor（不依赖它） |
| [OpenNext Cloudflare 官方支持 Next 16](https://opennextjs.org/cloudflare) | ✅；注意 adapter 不识别 `proxy.ts`（CSP/自定义域名功能丢失，可接受） |

## 架构

```
Worker（OpenNext：静态资源走 ASSETS，免费无限）
  └─ 所有动态请求 → DO "App"（单实例，单写者=SQLite 模型）
       ├─ Next handler 在 DO 内跑（sync SQL 只能在 DO 里）
       ├─ lib/db-cloud.ts：DatabaseSync 门面（exec 拆分多语句/触发器、
       │   prepare.get/all/run/iterate、BLOB 转换、transactionSync）
       ├─ lib/db.ts：db()/transaction() 已加 cloud 分支（FLOWPLAN_CLOUD_DB）
       └─ 后续：上传→R2，SSE 协作→DO 广播，定时→DO alarms
```

## 已完成

- `lib/db-cloud.ts`：门面 + SQL 拆分器（引号/注释/BEGIN…END 感知）✅ 冒烟测试过
- `lib/db.ts`：cloud 分支（globalDb.flowplanCloudDb / flowplanCloudTx）✅
- `cloud/spike.ts` + `cloud/wrangler.jsonc`：验证脚本（`npx wrangler dev` 后 GET /spike、/shim）
- 分支 `cloudflare-port`

## 进展

- ✅ OpenNext 构建通过（open-next.config.ts：无增量缓存）；wrangler.jsonc 在仓库根（main=cloud/app-worker.ts）
- ✅ **Next handler 在 DO 内跑通**：`/api/health` 返回 flowplan 自己的 JSON。关键坑：DO fetch 不注入 env（从构造函数第二参拿）；ctx 用 `state.waitUntil` 自造
- ✅ cloud 分支补跑基础建表（原先「no such table: templates」）
- ✅ ~~跨 DO I/O 错误~~（重建后消失）
- ✅ **端到端验收（wrangler dev 本地）**：建账户 `/api/auth/register` 200 → 登录 200+会话 Cookie → 带会话首页 200（中文标题）。DB 写路径（INSERT+事务+会话）全通
- 🔄 剩余错误都是 fs 层：`operation not permitted`（后台 fs 调用）、/api/health 503（uploads 目录检查）——待 fs→R2/禁用
- 🔄 tsconfig exclude 了 cloud/（避免 .open-next 循环依赖）；wrangler types 未接

## 待办（按序）

1. **Next-in-DO**：OpenNext 构建产物（.open-next/worker.js）在 DO fetch 里调起；
   worker 侧只转发动态请求。未知点：OpenNext handler 对 env/ctx 的假设。
2. **fs 层**（30 文件 120 处）：上传→R2（storage.ts 已有 S3 镜像层可借力）；
   密钥→DO/KV；先关掉 OCR、space git-export、SMTP/邮件收发、Litestream。
3. **SSE 协作**（/api/documents/live、/api/share/[token]/live）：改 DO 广播。
4. **后台任务**（background-jobs.ts）→ DO alarms。
5. 部署 wrangler deploy + pages.dev 镜像（大陆可达），验收：建户、编辑、协作、模板、中文。

## 风险

- DO 免费档 CPU/时长上限没实测（本地 dev 不触发）；SSR 大页面可能超。
- transaction() 嵌套：transactionSync 不可嵌套，需确认 app 无嵌套用法。
- OpenNext + DO 组合是社区少见路径，可能要给 OpenNext 提 patch。
