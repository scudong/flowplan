# Flowplan 中文版（本地汉化 + 自托管）

基于 [yannicschuller/flowplan](https://github.com/yannicschuller/flowplan) v0.8.4（AGPL-3.0），
补充**简体中文界面**并在本机自托管运行。

> 上游只内置德语、英语、法语三种界面语言；本项目在其多语言机制（`locales/*.json`）上新增 `zh`，
> 不改动业务逻辑。

## 做了什么

| 改动 | 文件 |
|---|---|
| 新增简体中文语言目录（8600 条界面文案，已译 8597 条，剩余 3 条是示例网址，保留原文） | `locales/zh.json` |
| 语言列表注册（名称「简体中文」🇨🇳，BCP-47 `zh-CN`） | `lib/i18n.ts`、`lib/i18n-catalogs-server.ts` |
| 无匹配浏览器语言时默认中文（上游为英文） | `lib/i18n.ts`（`pickLocale`）、`app/global-error.tsx` |
| 中文字体栈（PingFang SC / 微软雅黑 / 思源黑体，衬线用宋体） | `app/globals.css` |
| AI 写作 / 摘要 / 白板支持中文（含中文摘要小标题、语言识别） | `lib/ai/prompts.ts`、`lib/ai/device-prompts.ts`、`lib/ai/summarize.ts`、`lib/ai/whiteboard.ts` |
| 同源校验放宽（`checkOrigin`）：Origin 与请求的 Host 头同源即放行（上游只认 `APP_URL`，绑定 0.0.0.0 时 `req.url` 的主机名不真实，且换地址就 403）；本机回环名（localhost / 127.0.0.1 / ::1，同协议同端口）视为等价。`APP_URL` 与外来源仍然拒绝 | `lib/auth.ts` |
| 中文 OCR（扫描件 / 图片文字识别，默认 chi_sim + eng） | `lib/ocr.ts`、`next.config.ts`、依赖 `@tesseract.js-data/chi_sim` |
| 内置模板库中文化（26 个页面/数据库模板：名称、描述、字段、选项、视图、示例数据、公式引用） | `lib/template-catalog-zh.ts`（由 `scripts/i18n-templates-zh.mjs` 生成，勿手改） |
| 翻译脚本（可重复执行，断点续传） | `scripts/i18n-translate-zh.mjs` |
| 语言数量事实表同步 | `facts.json`（`npm run facts` 生成） |

上游的文案维护机制（`npm run i18n`）仍然可用：英文文案是键，
`locales/zh.json` 是「英文 → 中文」的映射；缺失的条目自动回退英文。

## 本地部署

环境：Node.js ≥ 22.13（实测 26.11）。

```bash
npm install
cp .env.example .env.local        # 至少设置 APP_URL
npm run build
npm start                         # http://127.0.0.1:3000（同一网段可访问）
```

开发模式（热更新）：

```bash
npm run dev                       # http://127.0.0.1:3000
```

数据（SQLite、上传文件、密钥）默认在 `./data`，由 `FLOWPLAN_DATA_DIR` 指定。
备份 `data/` 目录即备份全部内容。

### 第一次使用

1. 打开 http://127.0.0.1:3000
2. 「创建第一个账户」→ 该账户自动成为管理员
3. 界面语言：右上角语言菜单或「设置 → 外观 → 语言」选「简体中文」；
   浏览器语言为 `zh-*` 时自动中文

### 可选配置（`.env.local`）

```ini
APP_URL=http://localhost:3000     # 改成局域网/公网地址时，登录跳转与 Passkey 依赖它
FLOWPLAN_LOCAL_LOGIN=true         # 邮箱 + 密码登录；第一个账户为管理员
FLOWPLAN_AI=on                    # 启用 AI 写作/摘要（需自备模型地址与密钥）
FLOWPLAN_OCR_LANGS=chi_sim,eng    # OCR 语言，第一个为主语言
```

完整变量见 `.env.example` 与 [docs.flowplan.org/configuration](https://docs.flowplan.org/configuration)。

## 维护翻译

```bash
npm run i18n                 # 同步代码里的英文文案到各语言目录
npm run i18n -- --check      # 只报告缺失（缺的条目回退英文）
node scripts/i18n-translate-zh.mjs          # 只翻缺失的条目（断点续传）
node scripts/i18n-translate-zh.mjs --force  # 全部重翻
```

翻译脚本使用微软公开翻译接口（无需密钥），`CONCURRENCY` 控制并发，默认 8。
占位符 `{0}`、`{1}` 会校验；HTML 模板只翻文本节点，标签原样保留。

## 许可

AGPL-3.0-only，与上游一致。`locales/zh.json` 同样以 AGPL-3.0-only 发布。
