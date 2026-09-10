# Dispatch Rules（调度与编码 · 每次会话强制在场）

任务真值只有 Workflow：单在线上，状态由 transitions 现查，本地只有索引与草稿。**主 loop 调度，子 Agent 执行，Skill 是方法，规则是红线。** 主 loop 理解目标、拆单、派活、收交回物；清晰小改动直接编码，创造性工作先出设计共识再拆单；职能子 Agent 只有 `reviewer`（写的人 ≠ 审的人）。

> 项目自身的定位、Room 表、收口命令与专属技能名册在项目 `.spec/AGENTS.md`，知识导航在项目 `.spec/knowledge/README.md`；本文件只定义跨项目通用的调度与编码规程，项目不复述、不复制。
>
> **技能名的写法**：下文一律用裸名（如 `workflow-planning`）。Claude Code 把插件技能暴露为 `workflow:<name>`，按裸名匹配即可；按 Agent Plugins 标准直接加载 `skills/` 的客户端看到的就是裸名。不在规则正文里硬编码前缀。

## 调度核心

**一件事一个技能**（权威是各 `skills/*/SKILL.md`）：

| 动作 | 技能 | 一句话 |
|------|------|--------|
| 拆单 | `workflow-planning` | 模糊想法 / 长文 → 可执行蓝图 → 本地 bundle → 按权限模式上传；每条前置边写清 `basis`；实现计划作单附件 |
| 依赖 | `workflow-dependencies` | 补全 upstream → downstream 边，算 `readiness` 与 `parallelWidth`（范围互不冲突的最大并行数） |
| 派活 | `workflow-dispatch` | 取 `readiness=ready` 且文件集互斥的单，各开 git worktree 并行派 worker；收交回物、合入、触发 reviewer |
| 领单 | `workflow-execute` | 读单核对 → 流转开工 → 交付 → 四件硬性交付回写 |
| 验收 | `workflow-qa` | 在真实线上环境跑测与判定，回写原单并按结论流转 |
| 单次操作 | `workflow-ops` | 字段明确的建单 / 记 bug / 查询 / 指派 / 流转 / 评论 / 附件 / 交接纪要 |

**子 Agent 名册**（便利镜像；权威是 `agents/` 下各文件）：

| 名称 | 职责 | 何时调度 |
|------|------|----------|
| `reviewer` | 合入后只读 diff 做对抗审查，只出报告（结论 / findings 按 P0–P2 / 证据核验） | 合入后审一次；不跑命令、不挡合入、不审半成品；结论由主 loop 写成 bug 单 / 评论 |

> **agents/ 准入门槛：只收「隔离本身即是产出价值」的角色**（当前仅 `reviewer`）。编码 / 拆单不设角色，规程见「编码约定」与各技能。

- **调度取向：快 > 稳 > 好，并行优先。** `readiness=ready` 且文件集互斥即扇出；能继承上下文的 fork 优先于冷启动 worker；串行只留给真有依赖或文件重叠的工作。
- **前置只看 `basis`。** `basis=interface`：接口物（协议 / API 签名 / schema / 公共模块 / 规范）冻结可引用即开工，不等上游实现——上游代码没合入不算阻塞。`basis=implementation` 只允许收尾 / 联调 / 发布 / 迁移这几类，且卡上必须写不可解耦的理由 `reason` 与解除条件 `unblockCondition`，缺一退回重拆。新卡默认接口前置。
- **默认流程：** 创造性工作（新功能 / 建组件 / 改行为）→ `brainstorming` 出设计共识（设计落项目 `.spec/knowledge/features/`，取舍记 `.spec/decisions/`，讨论过程不入库）→ `workflow-planning` 拆单（派活提示词就是单正文，实现计划作单附件）→ `workflow-dispatch` 并行派活，或主 loop 自己 `workflow-execute` 领单 → 推分支开 PR 即交回，不等 CI → 主 loop 合入 → `reviewer` 审一次 → 主 loop 把结论写成 bug 单 / 评论 → `workflow-qa` 验收。修 bug / 排障先 `systematic-debugging` 找根因再动手。
- **审查闭环：** reviewer 合入后审、只读 diff、不跑命令、不挡合入；结论由主 loop（单一写入方）写成 bug 单与评论。reviewer 报告里出现「我已流转 / 我已建单」= 越权，主 loop 不采信。
- **快速模式：** 合入前用 `closeout-gate`（随插件分发于 `tools/closeout-gate.mjs`，判定规则与阈值的单一权威是其头注释）定级——有效行 < 50（只计新增行，去空行与注释）且非红线面 → 免审，交付附一行豁免声明与工具输出；红线面（`rules/`、hooks、`.claude/`、CI 配置、鉴权 / 安全面、公共契约与 schema 文件）触碰即至少快审，不因行数小而豁免；机器判不了的语义红线面由人工判与 reviewer 兜底。
- **派 worker 三选一：** ① 多张互不依赖的单可并行 ② 改动大到撑爆编排上下文 ③ 需要隔离的干净实现环境。
- **并行边界与合入：** 文件集**互不重叠**才可并行，重叠必串行；文件集不重叠但共享同一数据不变量的改动，必须声明一条共同的集成验收链。并行 worker 各在独立 git worktree 实现——Claude Code 用 Agent 工具的 worktree 隔离，其他宿主 `git worktree add`。主 loop 收交回物先查冲突、不复跑其测试，合入主工作区；冲突退回实现方；删除分支或 worktree 前列出将丢失的内容并取得确认。
- **交回物 = `workflow-execute` 的四件硬性交付：** ① 状态流转——取 transitions 里语义为「待验收」的边，工作流没有验收态才取「已完成」的边；② 带提交号（commit / 分支 / PR）的证据评论——跑了什么写什么，没跑的写「未执行」；③ 这次不做的 TODO 经确认补需求单并在评论引用单号；④ ≤200 字交接纪要（`agentLabel` 必填不猜）。派活方收交回物只认这四件与 diff，子 Agent 的成功报告不作数。
- **谁来调度：** 只有主 loop 派活；子 Agent 只执行，各自上下文只拿单正文 + 相关文件。
- **失败处理：** P0 / P1 → 附审查报告退回重做，实现方按 `receiving-code-review` 处理（先对照代码核实再改，不盲改、不表演性认同）；同一问题三次不过 → 质疑方案：拆解问题重拆单，方向问题升级用户。

## 编码约定

**约束一切写代码的上下文——主 loop 直编或通用 worker，一视同仁。**

- **领单先流转**：动手前经 `workflow-execute` 取 transitions 里语义为「进行中」的边流转；不自标完成——完成态由验收方流转。
- **先加载再动手**：经项目 `.spec/knowledge/README.md` 导航读相关规范与被改源文件，按规模校准深度——改 ≤ 1 个文件只读直接相关文档与源文件；2–5 个文件读全部相关文档；多模块多步骤 → 回主 loop 重拆。低估规模是最常见的失误。
- **排障先找根因**：遇到 bug / 测试失败 / 异常行为，先走 `systematic-debugging` 四阶段，未完成根因调查不动手修；修 3 次不成 = 质疑架构，停下上报。
- **不夹带（单一权威）**：只做当前单要求的改动，不顺手重构、不加未要求的功能、不引入单外新依赖。
- **交付带证据：跑了才说跑了，没跑写「未执行」。** 推分支前不要求跑任何命令，想跑就跑、不跑也交回；交回后不等 CI；不得用计划中的验证冒充结果，声称附命令与关键输出。
- **改完沉淀**：新模式 / 新规范用 `spec-steward` 落项目 `.spec/knowledge/`，决策记 `.spec/decisions/`（ADR 不改写、只新增取代；feature 文档只描述设计现状）；纯修复 / 微调可豁免，豁免须在交回物声明。
- **方法技能按需用**：`brainstorming`（设计共识）、`test-driven-development`（用它时先写失败测试再写实现——是方法不是门）、`systematic-debugging`（根因四阶段）、`receiving-code-review`（处理退回）、`spec-steward`（沉淀进 `.spec/`）。

## 线上指针

- **遇到单号或想知道线上有什么** → 先 `GET /search?q=<单号或关键词>`（带 `R-` / `B-` / `T-` / `RM-` 前缀的单号走精确定位）或 `GET /rooms/<uuid>/overview`（Room 总账），再看本地索引——会话开始注入的一行给出路径（`$XDG_CACHE_HOME/workflow/index/<host>.json`，缺 XDG 时 `~/.cache`）、条数、各 Room 计数与刷新时间；**索引只用来找单号和 Room，状态以线上为准**；正文不注入，需要时自己 grep 那个文件；`/workflow:index` 手动刷新。
- **文档里写单号，不写本地路径**：凡落了单的地方写 `displayKey`（如 `R-00012`）；派活提示词就是单正文，实现计划作单附件。
- **状态不是枚举**：一律「取 transitions 里该语义的边」（`GET …/transitions`，或列表加 `includeTransitions=true`，选 `allowed=true` 的那条）；规则、技能、文档里不得硬写状态名；索引里的 `status` 只作参考，不得据以流转。
- **索引里没有 X ≠ 项目里没有 X**：变更端点按模块 read 权限裁类型——token 没有某模块的 read，该类整类不出现且**不报 403**，两种情况在响应上分不开。索引只用来「找到已知的东西」，不得拿它断言某类单据不存在。
- **按项目拉，不按 Room 拉**：分组在本地按 `roomId` 做。被移出某室的对象不会出现在该室的增量里（只出现在新室），按室拉会让旧室永远删不掉那条。

## 宿主差异

本插件以 Agent 插件分发，双标准并存：技能层遵循 [Agent Plugins 1.0.0](https://agent-plugins.org/) 可跨客户端加载；子 Agent、slash command 与 hook 是 Claude Code 专有层。

| 能力 | Claude Code | Codex / 其他客户端 |
|------|-------------|--------------------|
| 规则常驻 | SessionStart hook 每次会话注入 `rules/` 与索引一行 | **无钩子**——靠项目 `AGENTS.md` 的「通用规则在插件 `rules/`」指针主动读 |
| 索引刷新 | SessionStart hook 自动（15 分钟内不重拉） | 手动跑 `tools/refresh-index.mjs` |
| 技能加载 | 插件自动发现，按 `workflow:<name>` 调用 | 按 Agent Plugins 标准发现 `skills/` |
| 子 Agent | 插件 `agents/` 自动发现 | **无**——主 loop 手动读 `agents/reviewer.md` 本地对抗审查，同上下文自审丧失「写 ≠ 审」独立性，属已知降级 |
| worktree 隔离 | Agent 工具 `isolation: "worktree"` | `git worktree add`；无对应物时并行退化为串行 |
| 任务真值 | Workflow 单（宿主内置任务工具只作个人草稿） | 同左 |

宿主能力演进快，以官方文档为准，偏差时更新本表。
