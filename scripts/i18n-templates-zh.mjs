#!/usr/bin/env node
// Generates lib/template-catalog-zh.ts: the built-in templates in Simplified
// Chinese, from the English catalogue (lib/template-catalog-en.ts).
//
//   node --import tsx scripts/i18n-templates-zh.mjs            translate what is missing
//   node --import tsx scripts/i18n-templates-zh.mjs --force    retranslate everything
//
// The same public Microsoft translator endpoint as i18n-translate-zh.mjs
// (no key). HTML stays intact: only text nodes are translated. Progress is
// kept in .i18n-templates-zh-progress.json so reruns are stable.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { templateCatalogEn } from "../lib/template-catalog-en";

const root = new URL("..", import.meta.url).pathname;
const progressPath = `${root}.i18n-templates-zh-progress.json`;
const outPath = `${root}lib/template-catalog-zh.ts`;
const force = process.argv.includes("--force");
const done = existsSync(progressPath)
  ? JSON.parse(readFileSync(progressPath, "utf8"))
  : {};

// Terms fixed by hand so the templates speak the same language as the
// interface (locales/zh.json).
const SEED = {
  Task: "任务", Tasks: "任务", Status: "状态", "Not started": "未开始",
  "In progress": "进行中", Done: "完成", "In review": "待审核", Blocked: "受阻",
  Priority: "优先级", High: "高", Medium: "中", Low: "低", Urgent: "紧急",
  Start: "开始", Due: "截止日期", Assignee: "负责人", Owner: "负责人",
  "Effort (h)": "工作量（小时）", Effort: "工作量", Progress: "进度",
  "All tasks": "全部任务", Board: "看板", Timeline: "时间线", Calendar: "日历",
  Table: "表格", Gallery: "图库", List: "列表", Form: "表单", Feed: "动态",
  Sprint: "迭代", Area: "领域", Areas: "领域", Quarter: "季度", Impact: "影响",
  Design: "设计", Product: "产品", Engineering: "工程", Marketing: "市场",
  Sales: "销售", Finance: "财务", Operations: "运营", "Human resources": "人力资源",
  Legal: "法务", "Customer success": "客户成功", Support: "支持",
  Notes: "笔记", Note: "笔记", Summary: "摘要", Decisions: "决定",
  "Action items": "行动项", "Open questions": "待解决的问题", Agenda: "议程",
  Attendees: "与会者", Date: "日期", Time: "时间", Location: "地点",
  "Meeting notes": "会议记录", "Daily journal": "每日日记", Journal: "日记",
  Mood: "心情", Habits: "习惯", Habit: "习惯", Gratitude: "感恩",
  Highlights: "亮点", Challenges: "挑战", Budget: "预算", Actual: "实际",
  Price: "价格", Amount: "金额", Category: "类别", Vendor: "供应商",
  Invoice: "发票", Invoices: "发票", Expenses: "支出", Expense: "支出",
  Income: "收入", Paid: "已支付", Currency: "币种", Quantity: "数量",
  "Reading list": "阅读清单", Title: "标题", Author: "作者", Rating: "评分",
  "Finished on": "完成于", Wishlist: "心愿单", Link: "链接",
  Contacts: "联系人", Company: "公司", "E-mail": "电子邮件", Phone: "电话",
  "Last contact": "最近联系", "Next step": "下一步", Stage: "阶段",
  Lead: "潜在客户", Customer: "客户", Deal: "商机", Value: "金额",
  "Expected close": "预计成交", Source: "来源", Inventory: "库存",
  Item: "物品", Items: "物品", "In stock": "库存中", Reorder: "补货",
  Supplier: "供应商", "Unit price": "单价", Recipes: "菜谱", Recipe: "菜谱",
  Ingredients: "食材", Steps: "步骤", Servings: "份量", Minutes: "分钟",
  "Job applications": "求职申请", Position: "职位", Company: "公司",
  Applied: "已投递", Interview: "面试", Offer: "录用", Salary: "薪资",
  Workouts: "锻炼", Workout: "锻炼", Distance: "距离", Duration: "时长",
  Calories: "卡路里", Weight: "体重", Reps: "次数", Sets: "组数",
  Travel: "旅行", Destination: "目的地", "Check-in": "入住", "Check-out": "退房",
  Hotel: "酒店", Flight: "航班", "Content calendar": "内容日历",
  Channel: "渠道", Draft: "草稿", Published: "已发布", Idea: "想法",
  Ideas: "想法", OKRs: "OKR", Objective: "目标", Key: "关键结果",
  Goals: "目标", Goal: "目标", Projects: "项目", Project: "项目",
  Issues: "事务", Issue: "事务", Bugs: "缺陷", Bug: "缺陷", Severity: "严重性",
  Feedback: "反馈", Survey: "调查", Surveys: "调查", Question: "问题",
  Events: "活动", Event: "活动", Guests: "参与者", RSVP: "回复",
  Books: "书", Book: "书", Movies: "电影", Movie: "电影", Games: "游戏",
  Game: "游戏", Plants: "植物", Watering: "浇水", Light: "光照",
  Type: "类型", Name: "名称", Description: "描述", Count: "数量",
  Points: "点数", Plan: "计划", Actual: "实际", Week: "周", Month: "月",
  Day: "天", Monday: "周一", Tuesday: "周二", Wednesday: "周三",
  Thursday: "周四", Friday: "周五", Saturday: "周六", Sunday: "周日",
  "To do": "待办", "Doing": "进行中", Review: "审阅", Shipped: "已上线",
  Backlog: "待办列表", "User story map": "用户故事地图",
  "Meeting": "会议", "Meeting note": "会议笔记", "Meeting log": "会议日志",
  "Applications": "求职申请",
};

// ---- the public translator -------------------------------------------------
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let session = null;
let pending = null;
async function token() {
  if (session && Date.now() < session.expires - 60_000) return session;
  if (pending) return pending;
  pending = (async () => {
    const html = await (
      await fetch("https://cn.bing.com/translator", {
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
      })
    ).text();
    const ig = html.match(/IG:"([A-Fa-f0-9]+)"/)?.[1];
    const abuse = html.match(/params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)",(\d+)\]/);
    if (!ig || !abuse) throw new Error("could not read the translator token");
    session = { ig, key: abuse[1], token: abuse[2], expires: Date.now() + Number(abuse[3]) };
    return session;
  })().finally(() => (pending = null));
  return pending;
}
let iid = 0;
async function translate(text) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const s = await token();
      const body = new URLSearchParams({ fromLang: "en", to: "zh-Hans", text });
      body.append("token", s.token);
      body.append("key", s.key);
      const res = await fetch(
        `https://cn.bing.com/ttranslatev3?isVertical=1&&IG=${s.ig}&IID=translator.5028.${++iid}`,
        { method: "POST", headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" }, body },
      );
      if (res.status === 429 || res.status === 401 || res.status === 403) {
        session = null;
        await sleep(1500 * (attempt + 1));
        continue;
      }
      const json = await res.json();
      const value = json?.[0]?.translations?.[0]?.text;
      if (typeof value !== "string" || !value) throw new Error(JSON.stringify(json).slice(0, 120));
      return value;
    } catch {
      session = null;
      await sleep(800 * (attempt + 1));
    }
  }
  return null;
}

// ---- HTML-aware translation: text nodes only -------------------------------
const TAG = /<\/?[a-zA-Z][^>]*>/g;
async function translateHtml(html) {
  const parts = [];
  let last = 0;
  for (const m of html.matchAll(TAG)) {
    if (m.index > last) parts.push({ text: html.slice(last, m.index), tag: false });
    parts.push({ text: m[0], tag: true });
    last = m.index + m[0].length;
  }
  if (last < html.length) parts.push({ text: html.slice(last), tag: false });
  for (const part of parts) {
    if (part.tag || !/\p{L}/u.test(part.text)) continue;
    if (!force && done[part.text]) { part.text = done[part.text]; continue; }
    const value = SEED[part.text] ?? (await translate(part.text));
    if (!value) return null;
    done[part.text] = value;
    part.text = value;
  }
  return parts.map((p) => p.text).join("");
}

const keep = (s) => /^@[+-]?\d+$/.test(s) || /^Q[1-4]$/.test(s) || /^[0-9.,%]+$/.test(s) || s.length <= 1;
async function value(source) {
  if (keep(source)) return source;
  if (!force && done[source]) return done[source];
  if (SEED[source]) return (done[source] = SEED[source]);
  const value = await translate(source);
  if (!value) return null;
  done[source] = value;
  return value;
}

// ---- walk the catalogue ----------------------------------------------------
let failures = 0;
async function translateTemplate(t) {
  const out = { ...t };
  out.name = await value(t.name);
  out.description = await value(t.description);
  if (out.name === null || out.description === null) return null;
  if (t.fields) {
    out.fields = [];
    const nameByEnglish = new Map();
    for (const f of t.fields) {
      const field = { ...f, name: await value(f.name) };
      if (field.name === null) return null;
      nameByEnglish.set(f.name, field.name);
      if (f.options) {
        field.options = [];
        for (const o of f.options) {
          const translated = await value(o);
          if (translated === null) return null;
          field.options.push(translated);
        }
      }
      out.fields.push(field);
    }
    // Formulas reference fields by their displayed name: rewrite every
    // prop("English name") to the translated one.
    for (const field of out.fields) {
      if (typeof field.formula !== "string") continue;
      field.formula = field.formula.replaceAll(/prop\("([^"]+)"\)/g, (_, name) =>
        `prop("${nameByEnglish.get(name) ?? name}")`,
      );
    }
  }
  if (t.views) {
    out.views = [];
    for (const v of t.views) {
      const name = await value(v.name);
      if (name === null) return null;
      out.views.push({ ...v, name });
    }
  }
  if (t.html) {
    out.html = await translateHtml(t.html);
    if (out.html === null) return null;
  }
  if (t.rows) {
    out.rows = [];
    for (const row of t.rows) {
      const cells = {};
      for (const [k, v] of Object.entries(row.cells)) {
        if (typeof v === "string") {
          const translated = await value(v);
          if (translated === null) return null;
          cells[k] = translated;
        } else if (Array.isArray(v)) {
          const list = [];
          for (const item of v) {
            const translated = await value(item);
            if (translated === null) return null;
            list.push(translated);
          }
          cells[k] = list;
        } else cells[k] = v;
      }
      const out_row = { cells };
      if (row.content !== undefined) {
        out_row.content = await translateHtml(row.content);
        if (out_row.content === null) return null;
      }
      out.rows.push(out_row);
    }
  }
  return out;
}

const entries = Object.entries(templateCatalogEn);
const zhEntries = [];
let index = 0;
for (const [key, t] of entries) {
  const translated = await translateTemplate(t);
  if (!translated) {
    console.error(`✗ ${key}: a string failed to translate`);
    failures++;
    zhEntries.push([key, t]); // English fallback, visible and fixable
  } else {
    zhEntries.push([key, translated]);
  }
  index++;
  process.stdout.write(`\r${index}/${entries.length} templates · ${Object.keys(done).length} strings   `);
  writeFileSync(progressPath, `${JSON.stringify(done, null, 2)}\n`);
}
writeFileSync(progressPath, `${JSON.stringify(done, null, 2)}\n`);

const body = Object.fromEntries(zhEntries);
const file = `// Generated by scripts/i18n-templates-zh.mjs from lib/template-catalog-en.ts —
// regenerate it, do not hand-edit. The built-in templates in Simplified
// Chinese (same keys, ids and structure as the German and English catalogues).
import type { CatalogTemplate, TemplateKey } from "./template-catalog";

export const templateCatalogZh: Record<TemplateKey, CatalogTemplate> = ${JSON.stringify(body, null, 2)};
`;
writeFileSync(outPath, file);
console.log(`\n${outPath} written · ${failures} template(s) with untranslated strings`);
