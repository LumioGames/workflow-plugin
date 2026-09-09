<div align="center">

# Workflow Agent 插件

### 你的 AI 会写代码，但它不会替你管项目。<br/>现在会了。

**把 Claude Code / Cursor / Codex 直接接进 [Workflow](https://workflow.games) —— 需求、缺陷、任务、状态流转、线上验收，全部由 Agent 自己跑完。**

![version](https://img.shields.io/badge/version-0.8.2-2ea44f) ![skills](https://img.shields.io/badge/skills-10-blue) ![spec](https://img.shields.io/badge/Agent%20Plugins-1.0.0-8b5cf6) ![API](https://img.shields.io/badge/API-OpenAPI%20%E5%90%88%E5%90%8C%E7%9C%9F%E5%80%BC-orange) ![write](https://img.shields.io/badge/%E5%86%99%E6%93%8D%E4%BD%9C-%E5%85%A8%E9%87%8F%E8%AF%BB%E5%9B%9E%E9%AA%8C%E8%AF%81-red)

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

插件包含 10 个技能、10 个斜杠命令、21 条硬闸门（G1–G7 落单闸门、Q1–Q7 QA 闸门与 F1–F7 反馈闸门），以线上 OpenAPI 合同为真值的自动化测试并每周校验合同漂移。规划和所有写回默认先落 `.workflow-drafts/<bundleId>/`，依赖分析与受控并发上传由专用 skill 处理。遵循 [Agent Plugins 1.0.0](https://agent-plugins.org/) 规范，同时兼容 Claude Code marketplace，MIT 许可。

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
| 🔌 `workflow-setup` | 从零接入：注册引导 → 建 token → 写配置 → 验证连接 → 401/403 现场分诊 |
| 🧠 `workflow-planning` | **把一句话变成一套能直接派活的开发蓝图** —— 判定单需求还是需求室、拆交付轨道、排并行 wave、写验收 |
| ⚡ `workflow-ops` | 干活：建需求 / 需求室 / 里程碑、记 bug（自带查重）、查任务、指派、流转、重开、评论、附件、交接纪要 |
| 🤝 `workflow-execute` | **拿单执行到交回** —— 找到指派给自己的单、读全（含所属需求室最近的交接纪要）、先摆决策点讨论再流转开工、并行子 Agent 干活，完成后按统一模板回写证据、留一条交接纪要再流转待验收；支持无凭证由调度方代写 |
| 🧪 `workflow-qa` | **在真实线上环境跑测验收** —— 复现 bug、复测修复、判定、回写证据与状态，**不读代码下结论** |
| 📖 `workflow-docs` | 答疑：现抓线上文档和 OpenAPI 合同回答，**不凭记忆瞎编** |
| 📣 `workflow-feedback` | **向平台方反馈问题与建议** —— 报错、体验不佳、卡慢、缺失功能都能报；只收集你主动提供的信息、发送前逐字确认、匿名提交，**不读 token、回执不是正式单** |
| 🔄 `workflow-update` | 自检版本、校验 sha256、安全自更新 |
| 🧩 `workflow-dependencies` | 自动分析上下游依赖，补全 direct edge、传递链和阻塞链，保留证据与置信度 |
| ⬆️ `workflow-upload` | 从本地 bundle 按权限模式受控并发上传、幂等恢复并逐项读回 |

---

### 需求引用与依赖方向

Requirement 之间的关联通过原生 `references` API 建立：`PUT /api/v1/requirements/{id}/references/{targetId}`
绑定、`DELETE` 解除，并用 `GET /api/v1/requirement-graph` 读回。该关系是无向且幂等的；图谱里的
`source` / `target` 只是稳定展示顺序，不代表谁依赖谁。`workflow-dependencies` 仍维护
`upstream → downstream` 的 direct edge、传递链、阻塞链和证据，上传器只绑定 direct edge，并按无序
UUID 对验证图谱结果。

---

## 30 秒装好

本仓库同时是一个 **[Agent Plugins 1.0.0](https://agent-plugins.org/)** 插件包和一个 Claude Code marketplace —— 仓库根就是插件根，两边客户端都能直接装。

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

> 默认装到 `~/.codex/skills`；也可 `--target ~/.claude/skills` 或 `--target .agents/skills`（项目级）。

没有账号也不要紧 —— 装完直接对 Agent 说 **「接入 Workflow」**，`workflow-setup` 一步步带你走完注册、建 token、写配置、验证连接。

装好即得十个命令：`/workflow:setup`、`/workflow:plan <描述>`、`/workflow:bug <描述>`、`/workflow:take <单号>`、`/workflow:qa <单号>`、`/workflow:deps <单号或草稿>`、`/workflow:upload <bundle>`、`/workflow:policy <show|set>`、`/workflow:feedback <描述>`、`/workflow:update`。

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

插件全局装一份就够，不必按项目重复安装。

```
~/.config/workflow/config.toml     每个项目一节 [profiles.<名>]，各放各的 token
<你的仓库>/.workflow               一行 profile = "<名>"，不含 token，可提交给全队共享
```

凭证按 **环境变量 → `.workflow` 标记 → 全局 `current_profile`** 三级解析 —— **人在哪个目录干活，就连哪个项目**，不用手动切。配置里有多个 profile 而当前目录没绑定？Agent 会停下来问你，而不是猜。拿单执行的场景更严：**没有 `.workflow` 绑定的目录里，执行 Agent 禁止拿全局默认项目兜底写数据**——要么先绑定，要么交回给调度方代写。

首次在某个项目目录接入时，`workflow-setup` 会引导你建 token 并写好 `.workflow`。

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
| Codex / 手动安装 | 对 Agent 说「更新 workflow 插件」—— 查线上版本 → 逐文件校验 sha256 → 备份旧版 → 就位 |

自更新只从 `workflow.games` 域下载，技能包只允许 `.md` 与 `VERSION` 纯文本 —— **清单里出现任何可执行文件，立即中止并告警。**

---

## 不想跑安装脚本？

把这段原样发给你的 AI Agent，效果等价：

```
请为我安装 Workflow（workflow.games）Agent 插件：
1. 抓取 https://workflow.games/plugin/version.json?cb=<当前时间戳>，读出 version 与 files 字段；
2. 抓取 files 指向的清单（加同样的 cb 参数），逐个下载清单中的文件并校验 sha256，不符则停止并告诉我；
3. 把 skills/ 下的技能目录写入 ~/.codex/skills/（Claude Code 手动安装则写入 ~/.claude/skills/，项目级安装写入 .agents/skills/）；技能包只应包含 Markdown 与 VERSION 文本文件，发现可执行文件立即停止；
4. 列出安装的技能与版本；
5. 然后直接开始 workflow-setup 技能的接入流程：先检测本机 ~/.config/workflow/config.toml 是否已有可用配置。
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

不需要。装完直接对 Agent 说「接入 Workflow」，`workflow-setup` 技能会引导你完成注册、创建项目 API Token、写入配置、验证连接，并在遇到 401 / 403 时现场分诊。

### workflow-qa 是真的去线上点，还是读代码猜结论？

真的在线上环境实际操作。`workflow-qa` 的头号纪律是**结论只来自线上实测** —— 读代码、看提交记录、旧截图、接口返回 200 一律不算验收证据。原路径至少跑两遍并记录复现率，首次未复现必须做变体重试。判定只有六个：属实、部分属实、已修复、未复现、重复、阻塞。

### 一台机器上接多个项目怎么办？

插件全局装一份即可，不必按项目重复安装。`~/.config/workflow/config.toml` 每个项目一节 `[profiles.<名>]` 各放各的 token，项目仓库根放一个 `.workflow` 文件声明绑定哪个 profile。凭证按**环境变量 → `.workflow` 标记 → 全局 `current_profile`** 三级解析，人在哪个目录干活就连哪个项目。

### 多个 Agent 编排干活，执行 Agent 没有 token 怎么办？

`workflow-execute` 原生支持「调度代写」模式：持凭证的调度 Agent 派卡（卡内容随派遣 prompt 下发），无凭证的执行 Agent 干完活交回一份结构化报告 —— 目标单、建议流转、可直接 POST 的证据评论正文、附件清单、Known gaps —— 由调度方统一回写并逐步读回。执行 Agent 在没有 `.workflow` 绑定的目录里禁止拿全局默认项目兜底写数据。

### 向平台反馈后，为什么我的项目里没有出现 Bug 单？

`sup_` 开头的是平台客服收件编号，不是正式单号。反馈先进入平台方的待审核收件箱，只有平台运营人员审核并转正后才会产生正式单——`workflow-feedback` 不能跳过这一步，也没有公开的收件进度查询入口。想把问题记进**你自己的项目**，用的是 `/workflow:bug`（workflow-ops），两条路互不混淆。

### 反馈会带上我的 token 或项目文件吗？

不会。`workflow-feedback` 走公开匿名端点，**不读取任何 Workflow 凭证**、不带 `Authorization` 头或 Cookie；素材只来自你主动提供的内容，发送前把完整报告与不发送清单（token、配置、环境变量、项目正文、完整请求体等）逐字展示给你确认。服务端还会再扫描一遍，命中敏感内容直接拒收（422）。

### Workflow 和 Jira、Linear 这类工具是什么关系？

[Workflow](https://workflow.games) 是面向游戏研发团队的 AI-native 研发协作平台，需求、缺陷、排期、追溯一体。本仓库是 Workflow 的 AI Agent 接入层，**不对接 Jira 或 Linear**。

### 这个插件开源吗？用什么许可？

开源，MIT 许可，源码在 [github.com/LumioGames/workflow-plugin](https://github.com/LumioGames/workflow-plugin)。技能包只允许包含 Markdown 与 `VERSION` 纯文本文件 —— 自更新时清单里出现任何可执行文件会立即中止并告警。

---

<div align="center">

**完整安装与使用指南 → [workflow.games/wiki/guides/agent-plugin](https://workflow.games/wiki/guides/agent-plugin)**

*让 AI 把活干完，也把单落完。*

</div>
