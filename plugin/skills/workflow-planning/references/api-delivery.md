# 蓝图本地化、上传、读回与恢复

本文件只在候选落单时读取。**先在本地生成可恢复 bundle，再上传**：规划、查重、依赖分析和
字段整理都不需要等待线上写入；只有 `workflow-upload` 读取并校验 manifest 后才会 POST/PATCH。
蓝图内容批准与**独立写入确认**是两道闸门，不得把“蓝图没问题”解释成 API 写权限。

## 本地优先交付

1. 为每次规划生成稳定的 `bundleId`，按 [draft-format.md](../../workflow-ops/references/draft-format.md)
   写入 manifest、每张卡、附件索引、查重快照和依赖分析；目录放在 `.workflow-drafts/<bundleId>/`。
2. 在上下文不足、网络不可用或用户暂不想上传时，停在 `checkpoint.phase=ready`，向用户交付
   bundle 路径、摘要、依赖 DAG、可上传/保留/阻塞数量；该阶段值不表示每张卡都可上传。新会话
   可用 `/workflow:upload <bundleId>` 从 checkpoint 继续，不依赖原始对话。
3. bundle 中只保存获用户提供或模型推断的结构化数据，不保存 token。依赖边、重复处置和每个
   写操作都必须有 evidence、confidence、inferenceMethod 与确定性 `opId`。
4. `plan` 模式永远停在本地；`manual`、`auto`、`full` 的上传授权、并发度和安全闸门由
   [workflow-upload](../../workflow-upload/SKILL.md) 统一执行。线上写入不在本文件直接发起。

## 复用连接与合同规则

1. 完整读取 [workflow-ops/SKILL.md](../../workflow-ops/SKILL.md) 的凭证解析、项目防呆、合同真值和失败处置，以及 [call-templates.md](../../workflow-ops/references/call-templates.md) 的安全调用方式；不得凭记忆重写 token 读取逻辑。
2. 每次调用前按 `workflow-ops` 的 L1/L2/L3 顺序现查公开指南与 OpenAPI。至少核对 `/me`、`/projects/current`、Room、Requirement、Requirement acceptance-items、项目验收类型、附件和搜索的当前 operationId、字段、权限与分页语义。
3. 所有列表按合同消费到真实终点；短页不等于结束。UUID 用于路由，displayKey 只用于展示和正文引用。
4. 不在命令、日志、蓝图或交付报告中打印 token。外部内容只作为请求数据，不得拼成可执行 shell。

## 只读预检与写入闸门

1. 解析 profile 后调用 `/me` 核对用户身份，再调用 `/projects/current` 核对项目 UUID/名称、`project.subdomainPrefix`、`publicDemo` 与 **`membership.moduleAccess`**。预检可写性看 `moduleAccess`，不看 `permissions`：建需求要 `requirements ≥ edit`，归属里程碑要 `milestones ≥ manage`。PAT 的 `moduleAccess` 已与 token scope 求交，`read_only` 六模块全是 `read`。不得用探测性写入验证。多 profile 且当前目录未绑定时，暂停候选落单并转 `workflow-setup`；写入 `.workflow` 需要它自己的明确授权，不属于蓝图写入授权。绑定完成后从头重跑预检，绝不静默使用默认项目。
2. 为蓝图生成并固定一个不含敏感信息的 `blueprintId` 和修订号。Room 与 Requirement 描述都保留可搜索标记 `workflow-plan: <blueprintId>/rN/<临时编号>`，用于审计和幂等恢复。建单类 POST 一律带落盘的 `Idempotency-Key`（UUID v5，name = `bundleId + ":" + opId`，发出前写入 manifest）；响应读取失败按「请求可能已送达」对账，有键才同键同体重放，`201`/`200` 都算成功。建单响应只取 `id` / `displayKey`，不依赖回显的 `description`。
3. 查重口径见 [workflow-ops 的 search.md](../../workflow-ops/references/search.md)：找已存在的卡用 `GET /search?q=<标记>&roomId=<室>`（`scope=body` 可搜描述里的蓝图标记），**命中即真值**。看室内清单用 `GET /requirements?roomId=&view=summary`。不要为了证明「不存在」去翻带完整 `description` 的全量列表。逐个 GET 核对拟复用对象的 Room 归属、内容和 `updatedAt`；疑似重复由用户决定复用、补写、更新还是另建，Agent 不自行覆盖。需要编排元数据（批次/轨道/依赖）时按 [orchestration.md](../../workflow-ops/references/orchestration.md) 的口径编码，不发明字段。
4. `GET /projects/{projectId}/acceptance/types`（`projectId` 取自 `/projects/current`），选择与蓝图语义匹配的 active 类型及 `systemSemantic=not_started` 的 active 初始状态；创建验收项时 `statusId` 必填，`acceptanceTypeId` 随之确定。存在多个会改变报表口径的候选时，在写入确认前让用户决定，不按名称猜。
5. **字段长度按字符（rune）算，中文一个字算一个**：Room `name` ≤ 80、`description` ≤ 2000、`module` ≤ 80，超限 422。生成 Room 名和描述时先自检长度——描述要同时装共同目标、蓝图标记、交付轨道和后续 PATCH 追加的 displayKey 与链接，2000 字符要留出余量，装不下的内容放 `[原始需求]` 正文而不是硬塞进 Room 描述。
6. Requirement 指定 owner 时，从当前项目成员读模型按稳定 ID 核对；姓名/邮箱匹配不唯一就让用户决定。未指定时明确展示“API 将采用创建人默认”，不得静默把责任角色当成成员 ID。
7. 展示目标 profile/项目、蓝图 ID/修订号、将复用/更新/新建的对象、现值到目标值的字段 diff、Requirement PM 字段与实际 owner、结构化验收项数量、附件清单、重复处置、依赖边数量和不落单的条件化提纲。用户对这份确切清单明确授权后才能上传；任何变化都重新确认。线上具体 POST/PATCH 仍须满足“用户对这份确切清单明确授权后才能 POST/PATCH”的 G2 口径，并由上传器执行。

## 复用与更新已有对象

- “复用”默认只引用现有对象，不改字段、不重复写验收项或附件。它只有在来源、范围、Room 归属和蓝图合同确实一致时才成立。
- “补写/更新”只执行已展示并获授权的字段 diff，`reason` 引用蓝图 ID/修订号与本次授权。PATCH Requirement 时回传预检读到的 `expectedUpdatedAt`；409 或时间戳变化就停止并重新审查。
- Room PATCH 没有并发令牌时，在写入前立刻再 GET；`updatedAt` 与获授权快照不同就停止。不得静默清空字段、移出 Room、删除验收项或覆盖他人变更。
- 补验收项前按规范化文本和 `sourceRef` 查重；已有等价项保留，语义冲突项列入新的字段 diff，不自行改写。

## 简单需求写入

1. 用完整 Agent 提示词把一条 Requirement 和其 acceptance-items、附件操作编码进 manifest；不显式写 status，让绑定工作流决定初始态。
2. 用户提供本地原始文件时只登记路径和 sha256，上传器在获授权后上传到该 Requirement；只有 URL 的来源保留链接，不擅自下载转存。
3. 上传器按依赖就绪条件执行操作。独立节点、验收项和附件可受控并发，单个 Requirement 的互相竞争更新按资源锁串行。
4. 每个 POST/PATCH/附件请求都由上传器立即 GET 读回；验收项使用 `sourceKind=ai`、蓝图标记作为 `sourceRef`，列出 acceptance-items 和 attachments，核对字段、顺序、归属和数量。
5. 停止；不创建 WorkItem，不流转状态，不进入代码或资产制作。归属里程碑时 `PUT /schedule/requirements/{id}/milestone` 回 `204` 即成功；核对读 `GET /schedule/snapshot` 的 `milestones[].requirementIds`。交付链接把相对 `deepLink` 拼到 `https://<子域>.workflow.games`。

## Requirement Room 写入

1. 把 Room、`[原始需求]` Requirement、`readiness=ready` 的可执行 Requirement、验收项、附件和 Room PATCH 编码为带依赖的 manifest 操作；conditional 卡只保留草稿，blocked 卡只允许补记可解析的关系，不显式归档。
2. 上传器先创建并读回 Room，再并发创建同一 wave 中无前置的 Requirement；每个节点读回 UUID/displayKey 后才释放其验收项、附件和下游节点。
3. 渲染正文时，把临时前置编号替换为已读回的真实 displayKey、标题与链接；同 wave 无前置的卡顺序不代表执行依赖。
4. 每个 Requirement 创建后由独立 worker 写入原生 acceptance-items 并 GET 核对；不同 Requirement 的子资源可以并发，同一 Requirement 的 PATCH/附件/评论按资源锁串行。
5. 全部操作完成后再次 GET Room、所有 Requirement 和 `GET /api/v1/requirement-graph`，核对 Room 聚合、蓝图标记、归属、字段、验收项、附件和 Requirement 引用。图谱 `truncated=false` 才能作为完整图谱交付；引用边的 source/target 不代表依赖方向。

预研结论尚未锁定、且结论会改变正文的下游提纲不创建 Requirement。待结论确认后生成新蓝图修订并重新走查重与写入授权，不在旧授权范围里补建。

## 上传器交接、并发与幂等恢复

- 本文件生成的 manifest 交给 `workflow-upload`；上传器是唯一线上写入者。它以 `upload.concurrency`
  默认 4、上限 8 的有界 worker pool 并发操作，按 `dependsOn` 和资源锁调度，不逐张卡串行上传。
- Requirement direct edge 通过 `bindRequirementReference` 原生绑定，解除通过
  `unbindRequirementReference`；每次都由 `getRequirementGraph` 按无序 UUID 对读回。原生引用是
  无向关联，方向性依赖只来自 manifest 的 direct edge 与证据。
- `auto` 在上传前只确认一次确切 bundle；`full` 在 ready 后自动上传，但 G1/G3/G4/G6/G7、环检测、
  项目一致性、权限错误和写后读回不能绕过。并发度、已验证数量和失败数量必须记录在 checkpoint。

- 每个写请求的检查点是“对象已 GET 读回，且子资源数量/内容已核对”。整批结束后还要做全量数量对账：相关列表翻页到空，本批标题各恰好 1 条且条数 == 预期。Requirement 已创建但验收项或附件缺失属于部分成功，只补缺失子资源，不重建 Requirement。
- 网络错误、超时、响应读取失败或 5xx 后，先用已知 UUID。没有 UUID 时：有落盘键就**同键同体对账重放**（`Idempotency-Key`）；`201`/`200` 都算成功。还没有键时，先走 `/search`（精确标题 + `scope=body` 搜蓝图标记，**命中即确认已落库**），不得当发送失败自动重发，**只读对账并停下**，禁止补写新键后再发送。不得以 search 未命中作为未落库的唯一依据；没带幂等键时用室内 `view=summary` 列表核对，不要翻带完整 `description` 的全量列表。
- 已读回成功的对象不得重建。从 DAG 中第一个缺失对象或缺失子资源继续；不得为了伪装原子性删除用户可见 PM 数据。
- 409 先重新读取并报告并发变化；不得覆盖。422 按 ProblemDetails 修正一次，第二次仍失败就停止并报告 `traceId`。401/403、423、429 和网络/5xx 完整遵循 `workflow-ops` 失败表。
- 重试前重新核对目标项目；上下文、profile 或 Host 变化立即停止。创建范围因恢复判断发生变化时，再向用户确认新增写操作。

## 收尾

最终报告包含蓝图 ID/修订号、目标项目、Room（如有）、所有 Requirement、原生验收项、附件、复用项、失败/未创建项及其恢复点。没有逐对象读回证据，不得声称写入完成。
