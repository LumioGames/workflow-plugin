# 关系 Provider 契约

依赖分析只产生统一边模型，上传器通过 Provider 处理 API 差异。Provider 必须实现或声明：

```text
capabilities(context)
listEdges(node)
createEdge(edge, idempotencyKey)
verifyEdge(edge)
removeEdge(edge)        # 支持删除时提供
```

`createEdge` 只接受 `classification=direct`；返回写入结果、是否原生关系、是否有向和可读回的
端点。若平台返回 Provider edge ID 就记录它；平台未声明 edge ID 时，`edgeId` 使用本地稳定的
无序端点键（Requirement 为排序后的 UUID 对，WorkItem 为远端 `relationId`）。metadata 至少包含
`edgeId`、`bundleId`、`classification`、`confidence`、`evidence`、`inferenceMethod`、`native`
和 `directional`；规划侧还应保留 `basis`，实现前置边保留 `reason` 和 `unblockCondition`。
Provider 不得把传递边展开成重复写入。

## 当前映射

### WorkItem 依赖

WorkItem 使用已存在的 `POST /schedule/relations`：`upstream` 映射到 `sourceWorkItemId`，
`downstream` 映射到 `targetWorkItemId`，`relation=prerequisite` 映射到合同允许的
`type=finish_to_start`。Provider 对 WorkItem 关系仅支持 `finish_to_start`。用
`/schedule/snapshot?sections=relations` 读回，删除时使用 `/schedule/relations/{relationId}`。

### Requirement 引用

平台现在提供原生、无向、幂等的 Requirement 引用 API（operationIds：
`bindRequirementReference`、`unbindRequirementReference`、`getRequirementGraph`）：

```http
PUT /api/v1/requirements/{requirementId}/references/{targetRequirementId}
Authorization: Bearer wfp_...

DELETE /api/v1/requirements/{requirementId}/references/{targetRequirementId}
Authorization: Bearer wfp_...

GET /api/v1/requirement-graph
Authorization: Bearer wfp_...
```

在插件中使用已包含 `/api/v1` 的 `$WORKFLOW_API_BASE`，因此实际请求路径为：

```text
PUT    $WORKFLOW_API_BASE/requirements/<requirement-uuid>/references/<target-uuid>
DELETE $WORKFLOW_API_BASE/requirements/<requirement-uuid>/references/<target-uuid>
GET    $WORKFLOW_API_BASE/requirement-graph
```

两个引用端点的路径参数必须是当前项目中的 canonical lowercase hyphenated UUID，不能自引用。
非法 UUID / 自引用返回 422；不可见或不存在返回 404；没有需求模块 `edit` 权限、项目冻结或
RLS 不允许时按 403/423 处理。绑定首次返回 201，已存在返回 200；解除引用始终按无向 UUID 对
定位，存在、已删除或重复删除均返回 204。插件不猜测或附加未在契约中声明的请求体、查询参数
或幂等 Header；本地确定性 `opId` / idempotency key 只用于 checkpoint 与恢复。

API 的关系语义是 `references`，不是方向性依赖。对依赖模型中的每条 Requirement direct edge
`upstream -> downstream`，Provider 建立一条无向 native reference（例如 A 依赖到 C 就调用
`PUT $WORKFLOW_API_BASE/requirements/<upstream-uuid>/references/<downstream-uuid>`，B 到 C 同理），metadata 固定为 `native=true`、
`directional=false`、`relationType=requirement_reference`，并保留模型中的 upstream/downstream
和证据。不要为传递链重复绑定 A/C；只绑定分析得到的 direct edge。

### Requirement 图谱读回

`GET /api/v1/requirement-graph` 返回最多 300 个节点，节点类型为 `milestone`、
`requirement_room`、`requirement`、`work_item`，边类型包括层级边、WorkItem 父子边和
`requirement_reference`。服务端按稳定 UUID 顺序输出引用边的 `source` / `target`；它们只是
无向边的规范展示顺序，`source/target` 不代表依赖方向。权限过滤发生在构图前，图谱隐含当前项目，不传
`projectId`。

Provider 的 `verifyEdge` 必须读取完整图谱并按无序 UUID 对查找 `requirement_reference`：

- 找到目标边即可确认绑定成功，即使响应 `truncated=true`；
- 删除后的“确实不存在”只有在 `truncated=false` 时才能确认；边缺失但图谱被裁剪时保持
  `blocked`，不能声称删除成功；
- `truncated=false` 才能作为完整图谱交付给用户。图谱是派生读模型，不替代对象详情、搜索或
  ChangeSet / Event activity。

## 依赖方向与引用关系的分工

`workflow-dependencies` 继续以 `upstream/prerequisite -> downstream/dependent` 作为唯一方向，
负责传递闭包、阻塞链、环检测和证据。Requirement 原生 API 只承载“这两个需求已建立引用”的
事实，因此图谱只能回答关联是否存在，不能单独回答谁阻塞谁。上传报告必须同时列出本地方向性
direct edge 和原生 `requirement_reference` 的读回结果；不能把图谱的 `source/target` 重新解释成
方向依赖。

解除引用只删除 manifest 明确声明的 direct native edge；不会删除本地分析记录，也不会把传递
边当成待删除关系。旧版本留下的 `native=false` 评论引用保留不动，除非用户明确要求清理。

## 关系操作的标准写入序列

解析双方 UUID -> 校验同项目、非自引用和 canonical 格式 -> 生成稳定 `opId` -> 按权限模式将
引用操作加入当前 bundle（增量依赖不修改历史 bundle） -> 调用绑定/解除端点 -> `GET /requirement-graph` 读回核对无序 UUID 对、
关系类型和截断标志 -> 记录 remote edge 与 ChangeSet/Event（若响应或 activity 可见）。409/网络
错误先读图谱确认，不盲目重发；重复绑定接受 200，重复解除接受 204。

关系边不逐条人工询问。`manual` 模式按“Requirement 引用关系组”一次确认，`auto` 按整个 bundle
一次确认，`full` 按用户级 standing authorization 自动执行；这些授权不改变平台 `edit` 权限，
也不能绕过项目一致性、全局查重、环检测、幂等恢复和写后读回。
