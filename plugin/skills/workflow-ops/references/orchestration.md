# 编排元数据与 Room 盘点（共享规则）

多 Agent 编排里，调度方要「按批次取卡、按轨道过滤、核对前置、聚合盘点」，落单方要提前把这些信息编码进卡里。**本文件是落单与查询两侧共用的唯一口径**（planning 落单、ops 建单、execute 拿单、调度盘点都指回这里）。原则：**真字段 > 标题前缀 > 正文约定**——能被服务端过滤的优先。

## 一、编码口径表（字段与过滤能力均已按合同核实）

| 编排概念 | 承载 | 落单侧怎么写 | 查询侧怎么取 |
| --- | --- | --- | --- |
| 批次 / 卡集合 | **Room（真字段 `roomId`）** | 建 Room 后按 `roomId` 归属，或 `POST /rooms/<uuid>/objects` 批量收纳既有单 | 找已有卡：`GET /search?q=<标记>&roomId=`（命中即真值）；室内清单：`GET /requirements?roomId=&view=summary` 与 `GET /work-items?roomId=`（都 cursor 分页） |
| 阶段 / 时间节点 | **里程碑（真字段，需求侧单选归属）** | `PUT /schedule/requirements/<uuid>/milestone`（`reason` 必填；`204` 即成功） | 核对归属：`GET /schedule/snapshot` 的 `milestones[].requirementIds`；或 `/search?types=milestone`；状态由需求进度自动派生 |
| 负责人 / 待办人 | **`ownerId` / `activeUserId`（真字段）** | 建单或 PATCH 指派 | `GET /work-items?ownerId=` 或 `?activeUserId=`；需求列表**没有** ownerId 过滤 → 用 `GET /me/workbench`（view=owned）或列表翻页后本地过滤 |
| 专业 / 轨道 | 标题前缀（planning 惯例 `[程序·客户端]` 等） | 标题前缀 | `/search?scope=title` 搜前缀初筛；权威口径 = 列表翻页 + 本地过滤 |
| 模块 | `module`（真字段，但**列表端点不可按它过滤**） | 对齐项目既有取值 | 列表翻页后本地过滤——不要臆造 module 查询参数 |
| 波次 / 前置依赖 | **依赖模型 + Provider**：当前 bundle 的 manifest 保存 direct edge；卡正文保留 displayKey、接口消费说明和完成口径 | planning 调 `workflow-dependencies` 生成 DAG，upload 通过 Provider 写入；历史 bundle 不回写 | `/search?scope=body` 搜引用初筛；**权威判定按 `basis` 分流**：interface 核对冻结合同/公共产物，implementation 才逐张 GET 前置卡看状态；关系读回按 Provider（见第三节） |

## 二、按批取卡骨架（cursor 翻到空为止）

```bash
CURSOR=""
while :; do
  RESP=$(curl -sS -H "Authorization: Bearer $WORKFLOW_TOKEN" \
    --get --data-urlencode "roomId=<room-uuid>" --data-urlencode "view=summary" --data-urlencode "limit=250" \
    ${CURSOR:+--data-urlencode "cursor=$CURSOR"} \
    "$WORKFLOW_API_BASE/requirements")
  echo "$RESP" | python3 -c 'import sys,json;[print(i["displayKey"],i["status"],i["title"]) for i in json.load(sys.stdin)["items"]]'
  CURSOR=$(echo "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["nextCursor"])')
  [ -z "$CURSOR" ] && break
done
```

`/work-items?roomId=` 同款循环；加 `includeTransitions=true` 可在同一响应里带上每张卡的可用流转（`availableTransitions`），省掉逐卡查 transitions 的 N+1。

## 三、依赖分析与前置核对

依赖补全统一交给 [workflow-dependencies](../../workflow-dependencies/SKILL.md)：先解析明确前置，再用
目标、验收、边界、评论和附件上下文补全模型推断；每条 direct edge 保留 evidence、confidence、
inferenceMethod 和接口/实现依据，transitive edge 只用于链路分析，不重复写入 API。方向固定为
`upstream/prerequisite -> downstream/dependent`，发现自环、环、孤儿或跨项目引用就阻塞相关写入。

新蓝图按“总需求/Room → 公共接口或公共产出 → 可并行执行卡 → 收尾联调/验收卡”组织。增量
bundle 先读取线上已有单据和关系，再只写新增卡或新增 direct edge；不要要求原 bundle 在本地
存在，也不要修改历史 manifest。旧单未完成但接口已冻结时，消费卡依接口并行；接口和可拆出的
公共产出都不存在时，消费卡保持阻塞并写解除条件。

派卡 / 开工前按边的 `basis` 核对前置：`basis=interface` 只逐项确认 `contractRefs` 指向的冻结合同或公共产物存在且版本/hash 可引用，不要求提供方实现完成；`basis=implementation` 才逐张 `GET` 前置卡，按**卡内声明的完成口径**对照当前状态和验收——「搜到了」不等于「完成了」。状态词表是项目自定义（G6），不拿固定词硬猜；拿不准某状态算不算「完成」时报给用户判断。

需求/工作项关系的 API 差异由 [relation-provider.md](relation-provider.md) 隔离：WorkItem 当前可用
`POST /schedule/relations`（仅 `finish_to_start`）；Requirement 使用
`bindRequirementReference` / `unbindRequirementReference` 的原生无向 `references` 关系。
上传器只写 Provider 声明支持的 direct edge，并通过 `getRequirementGraph` 读回；图谱的
`source/target` 只是稳定展示顺序，不代表依赖方向。

## 四、Room 盘点（聚合验收的数据源）

1. **总账**：`GET /rooms/<uuid>/overview`——服务端在全量数据上算的精确计数：`phase`（派生阶段）、需求分桶（backlog / unstarted / started / completed / canceled / triage / duplicate）、工作项 active/closed、验收缺口（缺验收项的需求数、被阻塞项数、未通过项数）、缺陷未解决数与 blocker 数、下一步建议。需要需求室 + 需求 + 缺陷三个模块的 read，任一不足整份 403。
2. **明细**：`GET /requirements?roomId=&view=summary`（cursor 到空）→ 需要正文时再按 UUID 打开；每张需求 `GET /requirements/<uuid>/acceptance-items` + `GET /comments?targetType=requirement&targetId=` 取验收状态与证据评论；`GET /work-items?roomId=&includeTransitions=true` 取缺陷/任务与其可用流转。
3. **汇总纪律**：以 overview 计数为准、明细为证；两边对不上先报差异再下结论（常见原因：翻页没走完、模块权限裁剪了明细）。

## 五、平台当前不支持的能力（不得在提示词或蓝图里臆造）

- **需求级有向依赖关系没有独立 API**：Requirement 原生 API 只提供无向 `references`；
  `workflow-dependencies` 仍负责分析 upstream/downstream、传递链和阻塞链，不能把图谱的
  `source/target` 解读成方向。
- **`/object-links` 不是本功能写入口**：需求引用通过 `bindRequirementReference` 写入；不绕过
  引用端点直接写 `object_links`，也不伪造其它关系类型。
- `/requirements` 列表只有 `roomId` 过滤（无 ownerId / status / module）；`/work-items` 列表无 status 过滤——状态过滤用 `/search?status=`（值先现查）或取回后本地过滤。
- `/rooms` 与 `/comments` 列表只有 `limit`、无 cursor。

需要以上未覆盖能力时，把它列成**平台需求建议**报给用户，不在插件侧硬绕。
