---
name: workflow-dispatch
description: 主 loop 要把多张 Workflow（workflow.games）单同时派给多个 worker 并合入时使用——从 Room 取 readiness=ready 且文件集互斥的单、各开独立 git worktree 并行派遣、收交回物以 diff 为准、主 loop 合入、合入后触发一次 reviewer、把结论写成 bug 单与评论。用户说派活、扇出、并行开工、几张单一起做时使用；单张单自己承接用 workflow-execute，拆单用 workflow-planning。
---

# workflow-dispatch — 扇出、合入、审一次

主 loop 的调度规程：**取单 → 分组 → 派遣 → 收交回物 → 合入 → 审一次 → 写回**。只有主 loop 派活；worker 只执行、不再派生子 Agent；Workflow 的每一次写入都由主 loop 经 `workflow-ops` / `workflow-upload` 完成——**单一写入方**。

读取 [workflow-execute](../workflow-execute/SKILL.md)（worker 的交回物格式、模式二代写）与 [orchestration.md](../workflow-ops/references/orchestration.md)（Room 盘点、`basis` 前置核对）。

## 硬规矩

- **任务真值只有 Workflow 单。** 状态一律现查 transitions、取语义为「进行中 / 待验收」的边（G6），不写状态名；进度不记在本地文件里。
- **worker 不接触 Workflow 凭证、不写单**（G4）。worker 按 `workflow-execute` 模式二交结构化报告，回写全部由主 loop 代做。
- **不复跑 worker 的测试；worker 的成功报告不作数，以 diff 为准。** 交回物里贴的命令与输出是它的证据；主 loop 核对 diff 与声称是否对得上，不重跑（G7 的对偶：没跑的它写「未执行」，主 loop 也不替它跑）。
- **合入只守一条线：能编过**（ADR-087 决策 3）——本地编译输出或 CI 的 build 作业任一即可；测试结果不作为合入条件。交回物里写「等 CI 转绿」= 违规，退回。
- **合入后审一次**，不每单审。reviewer（[agents/reviewer.md](../../agents/reviewer.md)）只读 diff、不跑命令、不挡合入、只出报告；结论由主 loop 写成 bug 单与评论。
- **删 worktree 或分支之前，列出将丢失的内容并取得用户确认。**

## 流程

### ① 取单：只派 `readiness=ready` 的

1. Room 盘点（orchestration 第四节）：overview 总账 + 三路明细，cursor 翻到空。
2. 对每张候选单按边的 `basis` 核对前置（orchestration 第三节）：`basis=interface` 只确认 `contractRefs` 指向的接口冻结物存在且版本 / hash 可引用——上游是**接口卡**、其实现未完成**不阻塞**，消费方对着接口与 stub 并行；`basis=implementation` 才逐张 `GET` 前置卡，按卡内声明的完成口径对照，未满足 → 不派。
3. 结果分三类：`ready` 进派遣清单；`conditional`（接口未冻结 / 引用漂移）不派，先补接口卡；`blocked` 不派，记下解除条件。
4. 把派遣清单（单号 + 标题 + 文件集）摆给用户确认，不自作主张挑单。

### ② 分组：文件集互斥才并行

- 每张单的**拥有范围**（卡上「范围与协作边界」）就是它的文件集。**互不重叠 → 并行；重叠 → 串行**，同组按依赖顺序排。
- 共享热点（同一文件、同一接口、锁文件、生成清单、场景 / 二进制资产）指定唯一所有者，不并行；服务端 / 客户端 / 工具优先共同消费同一份版本化接口，不互相等实现。
- 并行上限参考依赖分析的 `parallelWidth`；再并行也别超过你能同时收交回物的数量。
- **每个 worker 一个独立 git worktree**：
  - 先检测：`git rev-parse --git-dir` 与 `--git-common-dir` 不同 = 已在 worktree 里，别再套一层；宿主有原生 worktree 工具（隔离参数、`EnterWorktree` 之类）优先用它。
  - 手动建时放在**仓的兄弟目录** `../<仓名>-<单号或 slug>`（`git worktree add ../<仓名>-<slug> -b <分支>`），不放仓内、不放系统临时目录——按相对路径依赖兄弟仓的项目会断。
  - 分支从当前主干基线建；记下基线提交号，之后审查 diff 从它算起，不用 `HEAD~1`。

### ③ 派遣：单正文 + 边界 + 环境 + 交回物规格

派遣 prompt 照 [references/implementer-prompt.md](references/implementer-prompt.md) 填空。四要素缺一不可：

1. **单正文**——它本身就是自包含提示词（`workflow-planning` 的 requirement-template）。写到一个文件里交给 worker 读（brief），不贴进 prompt；exact 值只在 brief 和接口冻结物里出现一次。
2. **【文件集边界】**：只改 `<路径列表>`；并行方正在改 `<路径列表>`，一律不动；lint 报错涉及它们时只记录，主 loop 统一处理。
3. **【环境】**：`<worktree 绝对路径>`、分支名、基线提交号；全程用绝对路径。
4. **交回物规格**：不 push、不开 PR、本地 commit；推分支前不要求跑任何命令，跑了写跑了、没跑写「未执行」；交回物 = `workflow-execute` 的四件（改动清单 / 提交号 / 验证证据 / known gaps 与遗留补单草稿）按其 handoff.md 第三节的模式二报告写到 report 文件，会话里只回状态 + 提交号 + 一行摘要。

派遣纪律：一个 prompt 只描述**这一张单**，不贴会话历史与其它单的摘要；能继承上下文的 fork 优先，冷启动 worker 才把背景写进 brief；模型按任务难度选，说清楚不含糊；worker 提问就答完整再让它继续。派前先为这张单流转到「进行中」语义的边并读回（主 loop 代做，G3）。

### ④ 收交回物：先查冲突，以 diff 为准

worker 回四种状态之一：

- **DONE**：核对 report 里有改动清单、提交号、实际跑过的验证（或「未执行」）；`git diff <基线>..<worker HEAD>` 对得上声称才算。
- **DONE_WITH_CONCERNS**：先读顾虑。涉及正确性 / 范围 / 接口 → 合入前解决；只是观察（「这个文件变大了」）→ 记下来交给 reviewer。
- **NEEDS_CONTEXT**：补上缺的上下文，重派同一 worker。
- **BLOCKED**：判断是上下文不够（补上重派）、任务太大（拆单，经 `workflow-planning`）、接口错了（先改接口卡，再重派消费方）、还是单本身错了（升级用户）。**不**无改动地让它再试一次。

合入前先预演冲突（`git merge --no-commit --no-ff <分支>` 或 rebase 到当前主干）；冲突退回该 worker 解决，不替它改。

### ⑤ 合入：主 loop 合入主工作区

- 通过冲突预演、且**能编过** → 合入主工作区。不因测试红拒合；但**带红合入不等于可以把红改成假绿**——不删断言、不放宽必跑集合、不刷 Golden 消红。
- 一组内的单按顺序合；异组各自独立合。
- 合入后清理该 worker 的 worktree（`cd` 到主仓根 → `git worktree remove <路径>` → `git worktree prune`），分支留到审查写回完成再删；删之前列出将丢失的内容（未合入的提交、未提交的改动）并取得确认。

### ⑥ 审一次：合入后触发 reviewer

全部合入后触发一次 [agents/reviewer.md](../../agents/reviewer.md)，prompt 照 [references/reviewer-prompt.md](references/reviewer-prompt.md)：

- **材料**：单号与单正文（brief 文件）、`git diff <基线>..HEAD` 写成的 diff 文件（含 `--stat` 与提交列表）、各 worker 的 report 文件。材料不齐它会报「材料不齐」，先补齐再派。
- **级别**：快审（默认）/ 深审（安全面、生产关键路径、大重构才显式要求），附一句理由。
- **范围外**：仍在途的并行文件集，diff 里出现一律不审。
- **不预判 findings**：不写「不要报 X」「最多 P2」；觉得会误报就让它报出来，你在裁决时处理。
- reviewer 不跑命令、不挡合入；它的报告里若出现「我已流转 / 我已建单」= 越权，不采信。

### ⑦ 写回：主 loop 是唯一写入方

1. **每张派出的单**按 `workflow-execute` 第 7 节代写四件，顺序固定：遗留补单 → 附件 → 证据评论（worker 的 report 正文 + 合入提交号）→ 交接纪要 → 流转「待验收」语义的边；先进 bundle，经 `workflow-upload` 按权限模式上传并逐项读回（G3）。
2. **reviewer 结论**：`P0` / `P1` 各起一张 bug 单（按 card-spec，正文引用来源单与 `文件:行号`），`P2` 与证据核验结果写成来源单的评论；用户明确不补的写明「用户决定不补」。
3. 有 `P0` / `P1` → 派**一个** fix worker 带完整 findings 清单（按 `receiving-code-review` 先核实再改），合入后再审一次；不一条 finding 一个 worker。
4. 全部写回读回后向用户交回：派了哪些单、合入提交号、reviewer 结论、补了哪些单、没成功的调用列状态码 + `traceId`。

## 进度与恢复

进度真值在线上（单状态 + 证据评论）和 `git log`。会话被压缩或恢复后：先 Room 盘点看每张单的状态与评论，再看 `git log` 与 `git worktree list`，**不凭记忆重派**已合入的单——重派整组是最贵的失误。

## 红旗

- 派 `conditional` / `blocked` 的单；把上游「实现未完成」误当 `basis=interface` 的阻塞
- 同组文件集重叠的单并行；共享热点没有唯一所有者
- 把会话历史贴进派遣 prompt；exact 值在 prompt 里出现第二份
- 复跑 worker 的测试；或反过来，只看它「测试通过」四个字不看 diff
- 让 reviewer 跑命令、让 reviewer 写单、告诉 reviewer 别报什么
- 为消红改断言；为通过合入等 CI
- 不确认就删 worktree / 分支
- 一条 finding 派一个 fix worker
- 会话恢复后凭记忆重派

## 无子代理的宿主

没有子 Agent 能力时退化为串行：主 loop 自己按 `workflow-execute` 模式一逐张承接（文件集互斥的顺序不变），合入后对照 `agents/reviewer.md` 的清单做一次自审——写的人和审的人是同一个上下文，**这是已知降级**，自审时加倍怀疑。
