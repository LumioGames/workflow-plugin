---
name: workflow-docs
description: 用户询问 Workflow（workflow.games）的 API 或产品功能怎么用、字段什么含义、支不支持某个能力、错误码什么意思，但不需要立刻执行操作时使用。抓取线上文档作答，不凭记忆。
---

# workflow-docs — 查 Workflow 文档并作答

## 铁律：必须抓取来源作答，不凭记忆

平台迭代快，你记忆里的端点、字段、枚举很可能已经过期。**每个答案都要有当次抓取的来源支撑**；抓不到就说抓不到，不编。

## 三级下钻

按 [workflow-ops/references/connection.md](../workflow-ops/references/connection.md) 第三节的 L1 → L2 → L3 阶梯抓取：**L1** 文档索引 → **L2** 人读指南（多数问题到这层就够）→ **L3** OpenAPI 合同（13000+ 行，**grep 定位后分段读，不要整读**）。「究竟哪个字段必填」「枚举到底有哪些值」以 L3 为准。

## 回答口径

- 涉及具体端点时，给出 **operationId** 和人读参考页链接：`https://workflow.games/wiki/api/<operationId>`（页面上有 curl 示例，用户可直接照抄）。
- 讲字段含义时注明来源层级（哪份 guide / 合同哪个 schema），让用户可复核。
- 支不支持某能力：以当次抓取的合同为准——合同里没有就回答「当前合同没有这个能力」，**不猜测未公开的 roadmap**，不替平台承诺「以后会有」。
- 错误码含义：结合 ProblemDetails 结构解释（`title` / `detail` / `traceId`），常见约定——401 未认证、403 权限不足、422 字段问题、423 项目冻结、429 限流（看 `Retry-After`）。

## 本地草稿、权限与关系能力

用户询问本地优先创单、权限模式、bundle 上传或依赖关系时，回答前仍必须按本技能的三级阶梯
抓取当次线上指南和 OpenAPI；不要把以下快照当成未来合同：

- 客户端策略支持 `plan`、`manual`、`auto`（默认）和 `full`。它只控制写入授权，不扩大 PAT
  scope；项目 `.workflow-policy` 只能降权，不能把用户级策略升到 `full`。
- `.workflow-drafts/<bundleId>/` 是本地 outbox。`workflow-upload` 使用有界并发 worker pool，
  默认 4、上限 8；每个操作必须幂等、按 DAG 等待依赖并写后读回。并发上传是客户端行为，不能
  从文档推断平台提供“批量事务”或无限并发。
- 当前合同中 WorkItem 依赖使用 `POST /schedule/relations`，仅支持 `finish_to_start`，
  通过 `/schedule/snapshot?sections=relations` 读回；`/object-links` 不是需求引用写入口。
- Requirement 引用现有正式 API：`bindRequirementReference`（PUT）、`unbindRequirementReference`
  （DELETE）和 `getRequirementGraph`（GET）。引用是无向且幂等的；依赖方向仍由
  `workflow-dependencies` 分析，不能从图谱 `source/target` 推断。若当次线上 OpenAPI 尚未同步，
  以平台正式提示词为暂时契约并在回答中标注部署时差，不改用猜测的其它 endpoint。绑定首次
  返回 201、重复绑定 200；解除存在或不存在均返回 204；图谱最多 300 节点，`truncated=false`
  才表示完整投影。

## 从「问」变「做」

用户从询问转为要实际执行操作（建需求、记 bug、改状态……）时，**转 workflow-ops 技能**；需要先接入或修连接问题时转 workflow-setup。用户不是在问用法，而是要**向平台方报问题、提体验或功能建议**（平台缺陷、太卡太慢、希望加功能）时，转 workflow-feedback。本技能只答疑，不执行写操作。
