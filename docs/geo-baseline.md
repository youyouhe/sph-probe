# sph-probe GEO/SEO 基线诊断（2026-09-22）

工具：[HeiGe-GEO-SEO](https://github.com/) v1.11.3（`geo_cli.py score / diagnose / agentready / cescore`），
对象：`sph.smartbid.site` 首页（本地 `node scripts/sph-dev-server.mjs` 输出的 index.html）。
背景：第一轮 agent-ready 已落地 robots.txt / AI 爬虫规则 / MCP Server Card / ai-catalog.json / markdown 协商；
本轮补 JSON-LD schema、llms.txt、FAQ 内容结构。

## 基线：score 25/100（危急）

```
========================================================
HeiGe-GEO-SEO 评分报告  |  市场: cn
========================================================
总分: 25 / 100   档位: 危急
GEO 分(被 AI 引用就绪度): 13
SEO 分(被搜索排名就绪度): 27
--------------------------------------------------------
[C] 结构化数据 Schema  0.0/16
   X  FAQPage schema  0.0/6  (无 FAQPage(实测带来 2.7x 引用率))
   X  核心 schema 覆盖(WebSite/Organization/Article)  0.0/4  (无核心 schema)
   X  Schema 丰富度(关键 schema ≥5 属性)  0.0/3  (最大属性数 0)
   X  Schema 有效性  0.0/3  (页面无 JSON-LD)
[D] 内容可抽取性  5.0/22
   X  主张密度(≥4 可抽取事实/100词)  0.0/6  (密度 0.5/100词)
   ~  答案前置(前 140 字符内给直接答案)  3.0/5
   X  句长(平均 15~20 词)  0.0/3  (平均 219.5 词/句)
   X  信息密度/篇幅(800~1500词最优)  0.0/4  (过短(<500词))
   ~  统计数据+外部引用  2.0/4  (数字 2 个,外链 1 个(权威外链 0 个);缺 canonical/og:url…)
[E] 内容结构与可解析性  12.0/16
   X  标题层级(单一 H1 不跳级)  0.0/4  (H1 数量为 0(应为 1))
   OK 列表与表格 / 定义块/Q&A 标题 / 语义三元组密度 / 无反引用信号
[F] 信任、实体与权威  0.0/12
   X  作者署名 + Person schema / sameAs / 实体一致性 / 内容新鲜度(dateModified)
--------------------------------------------------------
最该先修的 5 项:
   C/C1 FAQPage schema、C/C2 核心 schema、C/C3 Schema 丰富度、C/C4 Schema 有效性、D/D1 主张密度
```

## diagnose（7 根因）

- X canonical 缺失或不规范 → head 补 `<link rel="canonical">`
- X 缺 Organization/Person 来源标注、无 sameAs → 补 WebSite + SoftwareApplication JSON-LD
- X 开头缺自包含答案块 → 首屏与内容区前置 30~90 字直接答案
- X 缺 FAQPage schema → 用真实问答对（解析/转写/额度）生成
- ? 信息缺口 → 属内容运营，本轮不编造
- ! ICP/网安备案信号缺失 → **域主决策项**：sph.smartbid.site 若已备案，在页脚展示备案号；未备案前国产 AI 收录基本归零（工具硬提示，本轮无法在代码层解决）
- OK 实体命名跨位置一致

## agentready 25/100（未就绪，非本轮范围）

- X 无语义 `<form>`（解析输入为 div+JS）
- X input 无稳定 name 属性
- X 无 declarative/imperative agent 工具声明

> 站点已有 imperative MCP server（/mcp + tools/list）承担 agent 调用通道；页面表单语义化
> 涉及交互逻辑改动，按「业务逻辑不动」约束本轮不处理。

## cescore 26.6/100（弱）

证据引用层 10.4/43 是最大缺口（权威引语 0、统计 0.9）。首页为工具页而非内容页，
靠 FAQ/说明区补真实事实（额度数字、清晰度、模型名），不编造引语。

## 修复后复评（同日，score 25 → 71 / 危急 → 良）

```
总分: 71 / 100   档位: 良   (GEO 65 / SEO 81)
[C] Schema 14/16   FAQPage 6/6、丰富度 3/3(最大属性数 8)、有效性 3/3
                   核心覆盖 2/4(仅 WebSite,Organization 需真实主体信息后补)
[D] 内容可抽取性 11/22   篇幅 851 词 OK、统计数字 8 个 OK
[E] 结构 16/16   单一 H1、列表、Q&A 全 OK
[F] 信任 3/12   sameAs/实体一致性缺(无真实 Wikidata 等实体可链,不编造)
```

剩余短板与边界（如实）：
- 句长/主张密度：首页说明区为完整中文长句，继续拆短句属文案迭代，收益递减
- sameAs/知识图谱外链：站点无 Wikipedia/Wikidata 实体，不编造
- agentready 表单语义化(25/100)：涉交互逻辑改动，受「业务逻辑不动」约束未处理
- ICP 备案号：域主决策项，代码层无法解决

## 本轮修复清单

| 项 | 动作 |
|---|---|
| canonical / og / description | index.html head 补齐 |
| 核心 schema | WebSite + SoftwareApplication JSON-LD（gen_schema.py 生成） |
| FAQPage schema | 与页面 FAQ 区同源的真实问答对 |
| H1 | 空状态标题 h2 → h1（单一 H1） |
| 内容结构 | 新增「功能说明 / 使用步骤 / 常见问题」静态内容区（如实：视频号解析、ASR 转写、YouTube 维护中、额度） |
| llms.txt | gen_llms_txt.py 生成，worker 新增 `/llms.txt` 路由 |

## 部署

- 代码在 `internal/api/sph/`（worker.js / index.html），同构跑 Cloudflare Worker 与 VPS（Node dev server）。
- 推送 `main` 后 CI 自动 rsync 部署到 rn2 `/opt/sph` 并重启 sph-probe（commit c3d84e0）；本地验证先跑 `node scripts/sph-dev-server.mjs`。
- 上线后复核：`curl -s https://sph.smartbid.site/llms.txt`、`curl -s https://sph.smartbid.site/ | grep -c 'application/ld+json'`、再用 geo_cli score 复评对比基线。
