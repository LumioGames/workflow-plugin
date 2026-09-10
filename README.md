<div align="center">

# Workflow Agent 插件

### 你的 AI 会写代码，但它不会替你管项目。<br/>现在会了。

**把 Claude Code / Cursor / Codex 直接接进 [Workflow](https://workflow.games) —— 需求、缺陷、任务、状态流转、线上验收，全部由 Agent 自己跑完。**

![version](https://img.shields.io/badge/version-1.0.0-2ea44f) ![skills](https://img.shields.io/badge/skills-16-blue) ![spec](https://img.shields.io/badge/Agent%20Plugins-1.0.0-8b5cf6) ![API](https://img.shields.io/badge/API-OpenAPI%20%E5%90%88%E5%90%8C%E7%9C%9F%E5%80%BC-orange) ![write](https://img.shields.io/badge/%E5%86%99%E6%93%8D%E4%BD%9C-%E5%85%A8%E9%87%8F%E8%AF%BB%E5%9B%9E%E9%AA%8C%E8%AF%81-red)

**简体中文** · [English](./README.en.md)

</div>

<!-- lumio-community:start -->
<div align="center">
<table>
<tr>
<td align="center" width="50%" valign="top">
<a href="https://qm.qq.com/q/PGkXh4tCyQ"><img src="https://raw.githubusercontent.com/LumioGames/.github/main/profile/assets/qr-qq.svg" width="170" alt="QQ 交流群 972220164"></a><br>
<a href="https://qm.qq.com/q/PGkXh4tCyQ"><img src="https://img.shields.io/badge/QQ%20%E4%BA%A4%E6%B5%81%E7%BE%A4-972220164-6171F0?style=for-the-badge&logo=tencentqq&logoColor=white" alt="QQ 交流群 972220164"></a><br>
<sub>什么都能聊</sub>
</td>
<td align="center" width="50%" valign="top">
<a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=7bbl451c-aa1d-4e6d-a21c-fd1f1ebeb6b5"><img src="https://raw.githubusercontent.com/LumioGames/.github/main/profile/assets/qr-workflow.svg" width="170" alt="Workflow 开发者社区"></a><br>
<a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=7bbl451c-aa1d-4e6d-a21c-fd1f1ebeb6b5"><img src="https://img.shields.io/badge/%E9%A3%9E%E4%B9%A6%E7%BE%A4-Workflow%20%E5%BC%80%E5%8F%91%E8%80%85%E7%A4%BE%E5%8C%BA-7C8CFF?style=for-the-badge&logoColor=white" alt="Workflow 开发者社区"></a><br>
<sub>飞书话题群 · Agent 与项目管理</sub>
</td>
</tr>
</table>
<sub>先进群再看代码。其它群和整体介绍见 <a href="https://github.com/LumioGames">LumioGames 主页</a>。</sub>
</div>
<!-- lumio-community:end -->

---

## 这是什么

**Workflow Agent 插件把 Claude Code、Cursor、Codex 等 AI 编码 Agent 直接接入 [Workflow](https://workflow.games)（workflow.games）项目管理平台。** 装好之后，AI Agent 能把一句话需求拆成可执行的开发蓝图并落单、带查重地记录缺陷、在真实线上环境跑测验收，并按判定流转工单状态 —— 且**每一次写入都必须读回验证**才允许声称成功。

插件包含 16 个技能、12 个斜杠命令、21 条硬闸门（G1–G7 落单闸门、Q1–Q7 QA 闸门与 F1–F7 反馈闸门），以线上 OpenAPI 合同为真值的自动化测试并每周校验合同漂移。规划和所有写回默认先落 `.workflow-drafts/<bundleId>/`，依赖分析与受控并发上传由专用 skill 处理。遵循 [Agent Plugins 1.0.0](https://agent-plugins.org/) 规范，同时兼容 Claude Code marketplace，MIT 许可。

**1.0.0 起它还管开发本身怎么做**：会话开始自动注入通用规则并把线上单据拉成本地索引，随包附带 brainstorming / TDD / 排障 / 沉淀 / 收审五个方法技能与一个只读 reviewer 子 Agent，外加项目文档结构体检（`/workflow:lint`）与项目初始化（`/workflow:init`）。

---

## 你每天都在忍受的三件事

<table>
<tr><td width="33%" valign="top">

### 😤 代码写完了，看板还是空的

Agent 十分钟改完三个模块，然后你打开 PM 系统，一条记录都没有。需求要补、bug 要录、状态要挪 —— **AI 干活，你做文员。**

</td><td width="33%" valign="top">

### 🔥 让 AI 碰 API？它敢把单开进隔壁项目

编一个不存在的字段、建三张重复单、把 token 打进日志、在你说"这方案不错"的下一秒就哐哐往线上写了 17 张卡 —— **一次翻车，够你清理一下午。**

</td><td width="33%" valign="top">

### 💨 "帮我规划一下需求"，得到一段聊天记录

不是任务，是对话。关掉窗口就没了，派给另一个 Agent 它看不懂，交给同事他得重问一遍。**规划的结果没法执行，等于没规划。**

</td></tr>
</table>

这个插件就是来解决这三件事的。**不是给 AI 加个"能调 API"的开关 —— 而是给它一整套敢放它上生产的纪律。**

---

## 它到底干什么

| 技能 | 一句话 |
| :-- | :-- |
| 🌱 `workflow-init` | 每个项目跑一次：生成 `.spec` 骨架与根入口，并接入 Workflow（注册 → token → 验证连接；已连通则只报告身份） |
| 🧠 `workflow-planning` | **把一句话变成一套能直接派活的开发蓝图** —— 判定单需求还是需求室、拆交付轨道、排并行 wave、写验收 |
| ⚡ `workflow-ops` | 干活：建需求 / 需求室 / 里程碑、记 bug（自带查重）、查任务、指派、流转、重开、评论、附件、交接纪要 |
| 🤝 `workflow-execute` | **拿单执行到交回** —— 找到指派给自己的单、读全（含所属需求室最近的交接纪要）、先摆决策点讨论再流转开工、并行子 Agent 干活，完成后按统一模板回写证据、留一条交接纪要再流转待验收；支持无凭证由调度方代写 |
| 🧪 `workflow-qa` | **在真实线上环境跑测验收** —— 复现 bug、复测修复、判定、回写证据与状态，**不读代码下结论** |
| 📖 `workflow-docs` | 答疑：现抓线上文档和 OpenAPI 合同回答，**不凭记忆瞎编** |
| 📣 `workflow-feedback` | **向平台方反馈问题与建议** —— 报错、体验不佳、卡慢、缺失功能都能报；只收集你主动提供的信息、发送前逐字确认、匿名提交，**不读 token、回执不是正式单** |
| 🔄 `workflow-update` | 自检版本、校验 sha256、安全自更新 |
| 🧩 `workflow-dependencies` | 自动分析上下游依赖，补全 direct edge、传递链和阻塞链，保留证据与置信度 |
| ⬆️ `workflow-upload` | 从本地 bundle 按权限模式受控并发上传、幂等恢复并逐项读回 |
| 🚦 `workflow-dispatch` | **主 loop 一次扇出多张单再合入** —— 从 Room 取 ready 且文件集互斥的单、各开独立 git worktree 并行派遣、以 diff 为准收交回物、合入后统一触发一次 reviewer，结论写成 bug 单与评论 |
| 💡 `brainstorming` | 动手之前先把想法问成有共识的设计：澄清意图、比较方案、写成项目活文档并记决策，再交给 `workflow-planning` 拆单 |
| 🧫 `test-driven-development` | 写生产代码之前先写一个会失败的测试：红 → 最小实现 → 重构；附反模式清单 |
| 🔍 `systematic-debugging` | 遇 bug 先走「根因调查 → 模式分析 → 假设验证 → 实施」四阶段，**没定位根因不许动手改**；修 3 次不成就质疑架构 |
| 📚 `spec-steward` | 改完把「改了什么、为什么」沉淀回项目 `.spec/`：放对位置、frontmatter 合规、导航与 ADR 索引同步、在途工作写单号 |
| 📝 `receiving-code-review` | 收到审查意见后先核实再改，一次一项各自验证，不表演性认同，也允许有理有据地反驳 |

---

### 需求引用与依赖方向

Requirement 之间的关联通过原生 `references` API 建立：`PUT /api/v1/requirements/{id}/references/{targetId}`
绑定、`DELETE` 解除，并用 `GET /api/v1/requirement-graph` 读回。该关系是无向且幂等的；图谱里的
`source` / `target` 只是稳定展示顺序，不代表谁依赖谁。`workflow-dependencies` 仍维护
`upstream → downstream` 的 direct edge、传递链、阻塞链和证据，上传器只绑定 direct edge，并按无序
UUID 对验证图谱结果。

---

### 钩子与本地索引

装上插件后，**每次会话开始**（启动 / 恢复 / `/clear` / 压缩后）自动跑两件事，不用你敲任何命令：

**① 注入通用规则。** `rules/` 下的规则全量进上下文——怎么派活、怎么收口、什么绝对不许做。规则是插件资产、跟着插件版本升级，**项目自己不要抄一份**（抄了 `/workflow:lint` 会报「项目抄插件」）。

**② 把线上单据拉成本地索引。** 落在 `$XDG_CACHE_HOME/workflow/index/<host>.json`（没设 XDG 时 `~/.cache`），不进仓库、不进插件根。规则是这样定的：

- **15 分钟内不重拉**，失败也占这 15 分钟——否则离线时每次开会话都要空等一轮超时；
- **每天一次全量对齐**（按 Room 枚举需求），其余走增量；
- **联不上就沿用旧快照**并在文件里标「离线沿用」和时间，退出码恒 0——索引是便利，不是门；
- 注入上下文的**只有一行计数**（路径 / 条数 / 各 Room 计数 / 多久前刷新），正文一个字不进——要找单号时 Agent 自己 grep 那个文件，几万字的看板不占你的上下文预算；
- **索引只用来找单号和 Room，状态以线上为准**——流转前一律现查 transitions，不许照索引里的 `status` 办事。

想立刻刷新（比如刚建完一批单）就跑 `/workflow:index`，它忽略 15 分钟有效期。当前目录没有 `.workflow` 标记时，它什么都不拉、也不警告——先 `/workflow:init` 绑定项目。

### 结构体检与脚手架

**`/workflow:lint` —— 项目 `.spec/` 的结构体检，只报告不阻断。** 默认退出码恒 0：红是待办，不是门，允许带红提交；只有传 `--strict` 才在有错误时退出 1（给 CI 用），`--json` 输出机器可读结果。检查顺序固定、一份报告：

1. **通用项** —— 核心文件、frontmatter、导航与 ADR 索引覆盖、链接可达、`@import` 完整、软链存活、ADR 撞号与状态行、禁并行文档根；
2. **项目扩展** —— 可选的 `.spec/tools/lint-extensions.mjs`，导出 `api = 1` 即被加载（版本对不上会**报错**，不会静默跳过），项目在这里加自己的检查项；
3. **指纹** —— 项目的 `AGENTS.md` / `rules/` 里出现插件的保留标题、或连续 3 行与插件规则逐字相同，就报「项目抄了插件」。通用规则每次会话注入，抄一份只会让两边慢慢长歪。

**`/workflow:init` —— 装好插件后每个项目必须跑的唯一步骤。** 一次做完两件事：先生成「这个项目是什么、定过什么」（`.spec/AGENTS.md`、`.spec/rules/system.md` 空模板、知识导航与功能文档模板、决策索引、lint 扩展样例、根 `CLAUDE.md` 与 `AGENTS.md` 薄指针），再立刻接入 Workflow（注册引导、建 token、写配置、验证连接）。脚手架默认不覆盖已有文件，token 不进会话、不由脚手架脚本写入。重跑安全：已有项目文件保持原样，已连通则只报告身份。不生成本地任务目录，任务真值只有 Workflow。

CI 里不装插件也能跑同一套体检：

```bash
npx github:LumioGames/workflow-plugin spec-lint . --strict
```

### reviewer 子 Agent

`agents/reviewer.md` 是一个**只读的对抗审查者**：假设交付有问题，然后去证伪。它的定位被写死成三条——

- **合入后审一次，不挡合入。** 合入只守「能编过」；报告里的 findings 是待办，由主 loop 决定补单、派修、再审，不是回滚门。
- **没有 Bash。** 不跑测试、不跑 lint、不跑构建、不碰 git。diff 由主 loop 生成成文件交给它，被改文件按需读。
- **只出报告。** 不流转单、不建单、不评论、不改代码——结论由主 loop 统一写成 bug 单与评论，保持单一写入方。

为什么要单开一个上下文：**写的人和审的人必须是两个上下文**，自己审自己的产出，审查必然失效。

---

## 仓库布局

本仓既是插件本身，也是一个用这套插件干活的项目。**用户装到的只有 `plugin/`。**

```
workflow-plugin/
├── plugin/            # ★ 发布面：skills/ agents/ commands/ hooks/ rules/ templates/ tools/ bin/
├── .claude-plugin/    # marketplace.json（留在仓库根，用 git-subdir 指向 plugin/）
└── tests/             # 开发面，不下发；package.json / .github/ 同理
```

往 `plugin/` 里放开发过程文件（`tests/`、`package.json`、`.github/`、`.gitignore`、`.claude/`）
会被 `plugin-lint` 的「发布面隔离」检查拦下 —— 否则这些会被原样装进用户机器。

**本地开发**：`git-subdir` 从远端 URL 克隆，所以本地路径 marketplace 装不出子目录插件。
改动想即时生效，把 `~/.claude/plugins/` 下对应目录软链到本仓的 `plugin/`（不提交这个链接）。

---

## 30 秒装好

本仓库同时是一个 **[Agent Plugins 1.0.0](https://agent-plugins.org/)** 插件包和一个 Claude Code marketplace —— 插件本体在 [`plugin/`](plugin/)，仓库根只放开发面（见 [仓库布局](#仓库布局)），两边客户端都能直接装。

**Agent Plugins 客户端**（Cursor / Codex / Copilot / VS Code / Kiro …）

```bash
npx plugins add LumioGames/workflow-plugin
```

**Claude Code**

```bash
/plugin marketplace add LumioGames/workflow-plugin
/plugin install workflow@workflow-plugin
```

**Codex / 手动安装**

```bash
curl -fsSL https://workflow.games/plugin/install.sh | bash
```

> 默认 `--mode full`：运行时落到 `$XDG_DATA_HOME/workflow/plugin`（缺 XDG 时 `~/.local/share/workflow/plugin`），`~/.codex/skills/<skill>` 是指向运行时的 symlink。`--mode skills` 仍只装 Markdown + VERSION，并打印能力边界。也可 `--target ~/.claude/skills` 或 `--target .agents/skills`（项目级）。

**装好之后，每个项目必须跑一次 `/workflow:init`**（或对 Agent 说「初始化这个项目」）。安装只把插件放到机器上；init 才生成仓根 `CLAUDE.md` + `AGENTS.md`，并立刻接入 Workflow。不跑 init，Claude / Codex 没有项目入口，也还没连上项目。没有账号也不要紧——同一条命令会带你走完注册、建 token、写配置、验证连接。脚手架不把 token 写进会话。

装好即得十二个命令：`/workflow:init`、`/workflow:plan <描述>`、`/workflow:bug <描述>`、`/workflow:take <单号>`、`/workflow:qa <单号>`、`/workflow:deps <单号或草稿>`、`/workflow:upload <bundle>`、`/workflow:policy <show|set>`、`/workflow:feedback <描述>`、`/workflow:update`、`/workflow:lint`、`/workflow:index`。

> **装过 `lumioagentspec` 插件的注意**：它的全部功能已并入本插件 1.0.0，两边同时启用会重复注入规则——所以检测到它还开着时，每次会话开始都会提示你卸载。

---

## 见识一下

### 🧠 一句话 → 一套能执行的蓝图

```
/workflow:plan 战斗结算界面要能显示本局评分和掉落
```

Agent 会先读你的输入、仓库里的 `AGENTS.md` / `CLAUDE.md` / 设计文档和现有实现，**一次只问一个真正会改变蓝图的问题**（不会拿一堆它自己能查到的事情来烦你），然后判定形态：

- 一个 Agent 能独立交付、独立验收 → **一张 Requirement**
- 要拆客户端 / 服务端 / 美术 / 工具链，有预研门、并行 wave、共享合同 → **一间 Requirement Room**

关键在于：**每张可执行需求都是一份自包含的 Agent 提示词。**

> 身份、真值优先级、执行前置、决策权限、拥有范围与共享热点、详细要求、验证证据、必须交付、验收标准、禁止事项、阻塞升级、交回格式 —— 十二节全部填满。

它不依赖原始对话。你可以把它丢给三天后的另一个 Agent、丢给刚入职的同事、丢给一个全新的 session —— **照样跑得起来。**

质量闸门还会按变更类型自动选路：代码走风险驱动用例 + TDD + 集成 + 整体 Review + 最终 QA；美术、文案、配置走专业评审 + 导入 + 在引擎验证 —— **不会给一张贴图需求硬塞一个 Code Review 卡。**

### ⚡ 记个 bug，顺手帮你查重

```
/workflow:bug 结算页负责人显示成了原始 id
```

建单前先 `GET /search` 查重 → 撞上疑似重复**先报给你**（不默默建第二张）→ 建单 → `GET` 读回 → 汇报 `displayKey` + UUID + 可点链接 + 实际落库的字段值。

**「记一下」就只记录** —— 不提修复方案、不扩写成开发任务、不擅自开始改代码。

### 🤝 拿一张单，从领活干到交回

```
/workflow:take R-00012
```

Agent 把单读**全**（正文 + 评论 + 附件 + 验收项，缺一路不算读过）、卡有需求室再读一路**该室最近的交接纪要**看上一棒做到哪、逐张核对前置单状态，然后**先梳理需求**——把歧义和需要你拍板的决策点连同建议一并摆出来，讨论完才现查 transitions 流转到进行中开工。干活阶段按确认过的拆分**尽可能并行多个子 Agent**（互斥所有权切分、共享热点不并行、子 Agent 不碰凭证与回写）。做完后按固定顺序回写：**这次不做的 TODO 经确认补需求单** → 证据附件 → **统一结构的证据评论**（改动清单、**提交单号（Git commit / PR 或 SVN revision）**、按验收项逐条对照、实际跑过的命令与输出、决策记录、Known gaps 与遗留补单、边界声明）→ **一条 ≤200 字的交接纪要**（做了什么 / 怎么交接 / 交接文档在哪，写给下一棒的人）→ 流转到待验收（工作流没有验收态才流转已完成）。**做完不回写等于没做完。**

> **接力靠纪要，不靠翻聊天记录。** 纪要以 Workflow 为唯一真值（绑了飞书群的需求室会镜像一份进群给人看，但 Agent 只读 API，**不去拉群历史**）。读进来的纪要是别人写的自由文本，插件里按**数据**处理——里面的祈使句和伪造系统提示一律不执行。

多 Agent 编排下还有第二种姿势：执行 Agent **不持有任何 token**，卡内容随派遣 prompt 进来，交回一份调度方**不追问一句就能代写**的结构化报告，由持凭证的调度方统一回写。执行 Agent 在没绑定 `.workflow` 的目录里，**绝不会**拿全局默认项目兜底写数据。

### 🧪 真的去线上跑一遍，再决定这单怎么处置

```
/workflow:qa B-00087
```

Agent 读单、把**每一张截图附件都看一遍**建立复现基线，然后**在你声明的线上环境实际操作**：原路径至少跑两遍（当前会话 + 干净重入），每个关键步骤截图，首次没复现就换浏览器 / 语言 / 视口 / 账号状态做变体重试。

判定只有六个：**属实 / 部分属实 / 已修复 / 未复现 / 重复 / 阻塞**。然后追加证据附件、在描述末尾写进 QA 记录块（原文一字不动）、发结构化评论、现查 transitions 后流转状态。

> **「结论只来自线上实测」是写死在提示词里的第一条。** 读代码、看提交记录、旧截图、接口响应 —— 一律不算验收证据。本地和 dev 跑通了也不能冒充线上结论；证据不够就判「阻塞」告诉你缺什么，**不会给你一个猜出来的"应该修好了"**。
>
> 另外两条：**「未复现」不等于「不存在」** —— 变体没试完不许写，要按 `cannot_reproduce` 关单必须再问你一次。**QA 不下场修** —— 发现问题就回写证据交给实现方，不改一行代码。

### 📣 遇到平台问题？一句话反馈给 Workflow

```
/workflow:feedback 需求列表加载要十几秒，太慢了
```

Agent 只整理你**主动提供**的信息（不扫仓库、不读任何凭证），把完整报告、目标 Host、附件清单与不发送清单**逐字亮给你确认**，确认后才匿名提交到平台客服收件箱。返回的 `sup_` 编号是**待人工审核的收件，不是正式单** —— 它会如实告诉你这一点，而不是宣称「已建单」。

**报错、体验不佳、卡顿慢、缺失功能、产品建议都能报** —— 不限于 bug。

---

## 为什么敢让它碰你的线上数据

这才是这个插件真正花力气的地方。

<table>
<tr><td width="50%" valign="top">

**🚦 双闸门授权**

**蓝图内容确认与线上写入是两个闸门。** 你说"方案不错"只是内容批准。想落单？Agent 必须先亮出：目标项目、蓝图修订号、查重结果、**准确的对象数量**，然后明确问你一句「是否写入」。范围一变，授权立即作废、重新确认。

**🔍 写完必读回**

每个 POST/PATCH 之后强制 `GET` 回读。**没有读回证据，不许说"已创建"。** 部分成功就报部分成功，列清哪些落库、哪些没有。

**🧯 幂等恢复**

网络断了、5xx 了 —— 先查是否已落库，确认没有才重发。已成功的对象绝不重建，只补缺失的子资源。**杜绝重复建单。**

**🧪 验收结论不拿代码当证据**

线上验收只认线上实测。读代码、看提交记录、旧截图、接口返回 200 —— **一律不算证据**；本地和 dev 跑通了也不能冒充线上结论。证据不够就判「阻塞」告诉你缺什么，**不会编一个"应该修好了"**。

</td><td width="50%" valign="top">

**🎯 绝不写错项目**

写操作前强制核对 `project.subdomainPrefix` 与实际 API Host、与 `.workflow` 绑定的 profile 三方一致。对不上就**停**。`.workflow` 存在但解析不出来？也**停** —— 绝不悄悄回落到全局默认项目。

**🔐 token 全程不外泄**

只走环境变量，不进命令行明文。任何输出（汇报、日志、报错）里只以 `wfp_` + 前 8 位指代。更新流程绝不触碰你的 `config.toml`。

**📡 字段以合同为准，不凭记忆**

平台自定义的工作流状态、验收类型、缺陷自定义字段一律**现查**，查不到就留空并告诉你 —— **不猜一个值填进去**。

**🚧 不为了截图动生产数据**

复现要动测试账号自身数据之外的业务数据，或会触发真实扣费、删除、注销 —— **先说明影响与恢复方式并另取授权**，未获授权判「阻塞」。原始反馈也一字不改：QA 结论只以描述末尾的 QA 块、新评论、新附件三种方式追加。

</td></tr>
</table>

> 还有一条边界写死在提示词里：**落单不等于开工。** 规划与落单时，Agent 只创建你授权的 PM 对象和结构化验收项，不建 WorkItem、不流转状态、不创建 Worktree、不跑你仓库的测试、不动一行代码。
>
> **例外只有两个，且范围都写死了。** `workflow-qa` 被授权跑测并按判定流转状态，但改代码、改资产、建分支、部署、修 bug 一律仍然禁止 —— **QA 不下场修**。`workflow-execute` 被授权流转**自己承接的那张卡**并回写完成证据，但替别的卡流转、把拿单扩写成落单、改原始描述、验收自己的交付一律仍然禁止。

---

## 一台机器，多个项目

插件全局装一份就够，不必按项目重复安装。每个仓库仍须跑一次 `/workflow:init`。

```
~/.config/workflow/config.toml     每个项目一节 [profiles.<名>]，各放各的 token
<你的仓库>/.workflow               一行 profile = "<名>"，不含 token，可提交给全队共享
```

凭证按 **环境变量 → `.workflow` 标记 → 全局 `current_profile`** 三级解析 —— **人在哪个目录干活，就连哪个项目**，不用手动切。配置里有多个 profile 而当前目录没绑定？Agent 会停下来问你，而不是猜。拿单执行的场景更严：**没有 `.workflow` 绑定的目录里，执行 Agent 禁止拿全局默认项目兜底写数据**——要么先绑定，要么交回给调度方代写。

首次在某个项目目录跑 `/workflow:init` 时，接入阶段会引导你建 token 并写好 `.workflow`。

用 `workflow-qa` 做线上验收时，`.workflow` 可以再加一个**可选**的 `[qa]` 表，声明受测线上地址、入口路径，以及测试账号凭据的**环境变量名**：

```toml
profile = "my-project"

[qa]
base_url = "https://<受测线上站点>"
entry_path = "/login"
username_env = "QA_USER"
password_env = "QA_PASS"
surfaces = ["web"]
```

**只写变量名，不写账号密码本身** —— 这个文件是要提交进版本库给全队共享的。`[qa]` 缺失时 QA 技能会停下来问你，**不猜受测地址**；`config.toml` 的格式一个键都没加，`[qa]` 只属于 `.workflow`。

---

## 更新

| 安装方式 | 怎么更新 |
| :-- | :-- |
| Claude Code（marketplace） | `claude plugin marketplace update workflow-plugin` + `claude plugin update workflow@workflow-plugin --scope user`（更新后需重启会话）；也支持 autoUpdate 自动升级或在 `/plugin` 界面手动更新 |
| Agent Plugins 客户端 | 重跑一次 `npx plugins add LumioGames/workflow-plugin` |
| Codex / 手动安装 | 对 Agent 说「更新 workflow 插件」—— 先判渠道，再走 `workflow-install.mjs`（默认 full）：sha256 + 白名单可执行文件，备份落到 `$XDG_DATA_HOME/workflow/backups/`，不进 skills 扫描目录 |

自更新只从 `workflow.games` 域（或本地 `--from-dir`）下载。**技能渠道**只允许 `.md` 与 `VERSION`；**完整运行时**允许 `runtime-manifest.json` 白名单内的 `.mjs` —— 不在白名单的可执行文件立即中止、不落盘。官网旧 `files.json` 不能当 full。

---

## 不想跑安装脚本？

把这段原样发给你的 AI Agent，效果等价：

```
请为我安装 Workflow（workflow.games）Agent 插件：
1. 抓取 https://workflow.games/plugin/version.json?cb=<当前时间戳>，读出 version 与 files 字段；
2. 抓取 files 指向的清单（加同样的 cb 参数），逐个下载清单中的文件并校验 sha256，不符则停止并告诉我；
3. 跑插件自带的安装器（默认 --mode full）：完整树落到 $XDG_DATA_HOME/workflow/plugin，~/.codex/skills/<skill> 指过去。技能渠道只允许 Markdown 与 VERSION；full 允许清单白名单内的 .mjs。备份不进 skills。旧 files.json 不能当完整运行时；
4. 列出安装的技能与版本；
5. 在当前项目跑一次 /workflow:init（或对 Agent 说「初始化这个项目」）：生成仓根 CLAUDE.md / AGENTS.md 指针，并立刻接入 Workflow（先检测本机 ~/.config/workflow/config.toml 是否已有可用配置）。
```

---

## 常见问题

### Workflow Agent 插件支持哪些 AI 编码工具？

支持 Claude Code、Cursor、Codex，以及任何实现 [Agent Plugins 1.0.0](https://agent-plugins.org/) 规范的客户端（Copilot、VS Code、Kiro 等）。Claude Code 走 marketplace 安装；Agent Plugins 客户端用 `npx plugins add LumioGames/workflow-plugin`；Codex 与手动安装走安装脚本。

### 这个插件和 MCP server 有什么区别？

Workflow Agent 插件是**技能包（skills），不是 MCP server**。插件不常驻进程、不占用 Agent 的工具槽位，本体是一组 Markdown 提示词，Agent 按需读取后用自己的 HTTP 能力直接调用 Workflow REST API。代价是需要 Agent 具备联网能力，收益是零运行时依赖、行为完全可审计 —— 你能直接读到它被约束了什么。

### 让 AI 直接写线上项目管理数据，安全吗？

插件用 21 条硬闸门约束一切对外写入。项目写操作前强制核对 `project.subdomainPrefix`、实际 API Host、`.workflow` 绑定的 profile 三方一致，对不上就停；每个 POST/PATCH 之后强制 `GET` 读回，**没有读回证据不许说「已创建」**；token 只走环境变量，任何输出里只以 `wfp_` + 前 8 位指代。

### 使用这个插件需要先有 Workflow 账号吗？

不需要。装完在项目里跑一次 `/workflow:init` 即可——没有账号时同一条命令会引导注册、创建项目 API Token、写入配置、验证连接，并在遇到 401 / 403 时现场分诊。

### workflow-qa 是真的去线上点，还是读代码猜结论？

真的在线上环境实际操作。`workflow-qa` 的头号纪律是**结论只来自线上实测** —— 读代码、看提交记录、旧截图、接口返回 200 一律不算验收证据。原路径至少跑两遍并记录复现率，首次未复现必须做变体重试。判定只有六个：属实、部分属实、已修复、未复现、重复、阻塞。

### 一台机器上接多个项目怎么办？

插件全局装一份即可，不必按项目重复安装；每个仓库仍须跑一次 `/workflow:init`。`~/.config/workflow/config.toml` 每个项目一节 `[profiles.<名>]` 各放各的 token，项目仓库根放一个 `.workflow` 文件声明绑定哪个 profile。凭证按**环境变量 → `.workflow` 标记 → 全局 `current_profile`** 三级解析，人在哪个目录干活就连哪个项目。

### 多个 Agent 编排干活，执行 Agent 没有 token 怎么办？

`workflow-execute` 原生支持「调度代写」模式：持凭证的调度 Agent 派卡（卡内容随派遣 prompt 下发），无凭证的执行 Agent 干完活交回一份结构化报告 —— 目标单、建议流转、可直接 POST 的证据评论正文、附件清单、Known gaps —— 由调度方统一回写并逐步读回。执行 Agent 在没有 `.workflow` 绑定的目录里禁止拿全局默认项目兜底写数据。

### 向平台反馈后，为什么我的项目里没有出现 Bug 单？

`sup_` 开头的是平台客服收件编号，不是正式单号。反馈先进入平台方的待审核收件箱，只有平台运营人员审核并转正后才会产生正式单——`workflow-feedback` 不能跳过这一步，也没有公开的收件进度查询入口。想把问题记进**你自己的项目**，用的是 `/workflow:bug`（workflow-ops），两条路互不混淆。

### 反馈会带上我的 token 或项目文件吗？

不会。`workflow-feedback` 走公开匿名端点，**不读取任何 Workflow 凭证**、不带 `Authorization` 头或 Cookie；素材只来自你主动提供的内容，发送前把完整报告与不发送清单（token、配置、环境变量、项目正文、完整请求体等）逐字展示给你确认。服务端还会再扫描一遍，命中敏感内容直接拒收（422）。

### Workflow 和 Jira、Linear 这类工具是什么关系？

[Workflow](https://workflow.games) 是面向游戏研发团队的 AI-native 研发协作平台，需求、缺陷、排期、追溯一体。本仓库是 Workflow 的 AI Agent 接入层，**不对接 Jira 或 Linear**。

### 这个插件开源吗？用什么许可？

开源，MIT 许可，源码在 [github.com/LumioGames/workflow-plugin](https://github.com/LumioGames/workflow-plugin)。技能渠道只允许 Markdown 与 `VERSION`；完整运行时允许清单白名单内的 `.mjs`。不在白名单的可执行文件会立即中止。

---

<div align="center">

**完整安装与使用指南 → [workflow.games/wiki/guides/agent-plugin](https://workflow.games/wiki/guides/agent-plugin)**

*让 AI 把活干完，也把单落完。*

</div>
