---
name: workflow-upload
description: 将 Workflow 本地草稿按权限模式、全局查重、依赖拓扑和 Provider 协议可靠上传，并以受控并发批量执行、逐项读回验证；支持部分成功恢复。
---

# workflow-upload — 草稿上传与恢复

处理 `.workflow-drafts/<bundleId>/`，先读取 [draft-format.md](../workflow-ops/references/draft-format.md)、
[permission-modes.md](../workflow-ops/references/permission-modes.md)、
[dependency-model.md](../workflow-dependencies/references/dependency-model.md) 和
[relation-provider.md](../workflow-ops/references/relation-provider.md)。

## 上传顺序

1. 校验 manifest、卡片、附件、策略快照、操作 DAG 和规划审查；`plan` 模式在此停止。规划 bundle
   按节点 `readiness` 过滤：`conditional` 或 `blocked` 节点的创建/更新操作留在草稿，不因同 bundle
   中存在这些节点而阻塞其它 `ready` 节点；bundle 级 audit 状态只作汇总报告。
2. 按 connection 规则验证 `/me`、`/projects/current` 和三方项目一致性。预检看 `membership.moduleAccess`，不看 `permissions`。
3. 在任何 POST/PATCH/PUT/DELETE 前重新执行项目级搜索：`GET /search?q=<标记>&roomId=<室>` **命中即真值**。search 未命中不得当成「不存在」的唯一依据；室内清单用 `view=summary`，不要翻带完整 `description` 的全量列表。建单类 POST 必须带 manifest 已落盘的确定性 `idempotencyKey`（作 `Idempotency-Key` 头）；缺键不得发出。
4. 精确 marker/UUID 自动幂等复用；已有单默认追加结构化评论。只有 manifest 明确 `update`
   且授权时才 PATCH 原正文，并带 `expectedUpdatedAt`。
5. 按依赖拓扑创建 Room、需求、WorkItem/bug 和其它节点；新蓝图先创建总需求/公共接口，
   再把接口已满足且拥有范围互斥的 `ready` 卡放入同一并发 wave，最后释放收尾卡。增量 bundle
   只创建本次新增对象或关系，不修改历史 manifest。真实共享热点与实现前置操作必须等待对应
   的就绪条件；接口边只等待冻结合同/公共产物可引用。不要把依赖边当成可并行提示。
6. 解析真实 UUID/displayKey/deepLink 后创建验收项、评论和附件；不同目标之间可并发，最后
   通过 Provider 写入直接边。Requirement direct edge 调用原生
   `bindRequirementReference`，再用 `getRequirementGraph` 读回；图谱中的引用边是无向的，
   依赖方向仍以 manifest 的 upstream/downstream 为准。同一目标上的交接纪要
   （`createHandoff`）排在其证据评论**之后**、状态流转**之前**：`handoffRef` 要指向刚落库
   的那条评论，而先留纪要再流转才不会出现「已流转但没有交接落点」的窗口。纪要响应
   `roomId` 为空按「已存库、未镜像」如实报，不算失败；`mirrored=true` 只是「会去投」，不是
   送达回执，不得据此声称已通知到人。
7. 每个写操作后立即 GET 读回，更新 checkpoint 和 events.ndjson。全部操作结束后无条件做全量数量对账：相关列表翻页到 `nextCursor` 为空，本批标题各恰好 1 条且条数 == 预期，出现标题重复即失败——不得只核对「你以为建的那张」。完整完成才清理 bundle。

## 受控并发上传（默认开启）

上传器必须使用**有界 worker pool** 发出多个异步请求，不得把整批对象一个一个串行上传。
这就是“多线程上传”的协议实现：并发的是网络操作，依赖、幂等和读回仍按单操作维护。

- manifest 可在 `upload.concurrency` 指定并发度；缺失时默认为 `4`，允许范围 `1–8`，超出范围
  停止并报告。`1` 仅用于平台临时限流或用户明确要求串行。
- 每个 worker 一次只处理一个 `opId`。调度器只派发 `pending` 且所有 `dependsOn` 已 `verified` 的
  操作；同一资源的 PATCH、附件、评论和交接纪要按资源锁串行，互不相关的资源可同时进行。
- Requirement 引用操作按“引用关系组”归并资源锁；同一无序 UUID 对的 bind/unbind 不能并发，
  不同 UUID 对可以并发。`manual` 只确认关系组，不逐边询问。
- 创建节点必须先完成并读回，再释放其子资源；关系操作必须等待两端 UUID 都已读回。一个 wave
  中的失败不会阻塞没有依赖它的其它操作（继续执行没有依赖它的操作），但依赖它的操作保持 `blocked`，不能越过 DAG。
- 并发请求仍各自使用已落盘、确定性的幂等 key、超时和重试上限；没有落盘幂等键不得重发。写操作默认不重试；只有同键同体才允许对账重放。429 按 `Retry-After` 降低并发或退避，
  423/401/403/409/422 与响应读取失败按共享失败表处理。不得因为并发而重复发送、换新键或复用别的操作的 key。不得把 POST 与 GET 包进同一套 except → retry。
- 每次请求完成（成功、失败或被阻塞）都原子更新 manifest checkpoint 和 `events.ndjson`；进程
  中断后只恢复未 `verified` 的操作。读回必须在 worker 内完成，不能先宣称整批成功再补读。
- 输出和收尾报告同时列 `concurrency`、已完成/失败/阻塞数量、每个操作的读回结果；部分成功
  保留 bundle，不能因某个 worker 失败而删除已落库对象。

## 模式行为

- `auto`：显式调用本命令后，展示项目、数量、复用/新建清单、边数量和并发度，只确认一次 bundle。
- `manual`：每个操作组展示 endpoint、目标、字段 diff 和关系 metadata，逐组确认。
- `full`：草稿 ready 后自动进入本流程，不询问，但仍执行所有安全闸门、受控并发和读回。

授权只绑定当前 manifest digest；内容、项目、数量、关系集合或规划审查结果变化即重新计算并重新授权。

## 规划状态与增量依赖

- `readiness=conditional` 的卡只能作为草稿保存；接口、公共产出或决策冻结后重新分析，
  再将它晋级为 `ready`。`readiness=blocked` 的卡只保留阻塞对象、理由和解除条件，不进入
  执行队列。
- planning 节点只有 `readiness=ready` 时，上传器才可派工；`checkpoint.phase` 和
  `analysis.audit.status` 不替代节点门控。非 planning 的 ops/execute 写回节点缺省
  `readiness` 时，按操作自身状态和依赖调度。
- 旧单未完成但接口已存在时，新增消费卡只引用接口，不等待旧单实现。接口和可拆出的公共
  产出都不存在时，当前 bundle 可以补写远端关系并报告阻塞，但不得启动消费卡。
- 关系写入仍通过 Provider；Requirement 的原生引用是无向事实，依赖方向、接口消费说明和
  阻塞理由以 manifest 与卡正文为准。历史 bundle 不因新增依赖而回写。

## 失败恢复

写操作默认不重试。create 类 POST 没有落盘幂等键不得重发、也不得发出。响应读取失败
（IncompleteRead / chunked 截断 / 超时无完整响应体）按「请求可能已送达」对账：有键则同键同体
对账重放（`201`/`200` 都算成功），没键则只读列表/详情。不得把 POST 与 GET 包进同一套
except → retry。已验证的操作不重建。409 重新读取并报告并发变化；422 依据 ProblemDetails
修正一次；401/403/423/429 按 connection 处置。
任何部分成功、关系图谱读取被裁剪、环或跨项目引用、全量数量对账发现标题重复都保留 bundle 并报告准确状态；图谱
`truncated=true` 时不得声称缺失边已删除或图谱完整。
