# 依赖模型

## 节点与边

节点的 `localId` 在 bundle 内稳定，线上对象用 UUID；`displayKey` 只用于展示和正文引用。
核心边模型如下：

```json
{
  "edgeId": "edge-A-C",
  "upstream": { "localId": "A", "objectType": "requirement", "remoteId": null },
  "downstream": { "localId": "C", "objectType": "requirement", "remoteId": null },
  "relation": "prerequisite",
  "basis": "interface",
  "reason": null,
  "unblockCondition": null,
  "classification": "direct",
  "source": "explicit",
  "confidence": 1,
  "inferenceMethod": "explicit-text",
  "evidence": [{ "localId": "C", "locator": "body:边界", "quote": "依赖 A" }],
  "bundleId": "wf-example"
}
```

`upstream -> downstream` 是唯一方向；API 的 `source/target` 由 Provider 映射，核心模型不
直接使用这两个有歧义的名字。`classification=transitive` 只出现在分析输出，不直接写 API。

`basis` 只有两种值：`interface` 或 `implementation`。

- `interface`：下游消费上游提供的版本化接口、schema、格式或公共产出。新蓝图中，公共接口
  卡/接口节先确定，服务端、客户端、工具和内容卡再分别引用它；不把提供方的实现状态当成
  消费方前置。
- `implementation`：下游确实要等上游的最终实现，只允许用于收尾/联调、发布或迁移。此时
  `reason` 必须说明为什么不能用接口、stub/mock 或更小的公共产出解耦，`unblockCondition`
  必须写清解除条件；规划阶段把这条记录进决策账本。普通实现卡出现这种边时保持
  `blocked`，不能靠改文字绕过。

边可以指向本 bundle 的 localId，也可以指向已存在的远端 `remoteId`。发现旧单依赖时只在
当前 bundle 记录新增 direct edge 和证据；历史 bundle 是审计快照，不回写。Requirement 的
原生引用 API 仍然是无向关系，方向、`basis`、理由和解除条件只由本地模型与卡正文保存。

例如用户先创建 A、B，再创建依赖两者的 C：模型保留两条 direct edge `A -> C`、`B -> C`。
若同时存在 `A -> B`，分析结果还会报告传递链 `A -> B -> C`，但不会把传递边重复写入 Provider。

## 证据与自动化

- manifest 中的 `dependsOn`、明确 displayKey/UUID 属于 `explicit`；“必须先完成”只有在边声明为
  `basis=implementation` 时才表示实现前置，不能覆盖已声明的接口边。
- 模型从目标、验收、边界、评论和附件上下文推断的关系属于 `inferred`，仍自动加入 bundle，
  但必须保留置信度和原文证据。
- 关系写入失败不通过“降低置信度”掩盖；保留错误、traceId 和 Provider 状态。

## 图算法与状态

对直接边做拓扑排序和传递闭包。发现自环或环时，停止关系写入并保留完整环路径；不把环
拆掉或静默改方向。发现同一端点的重复边时只保留一个确定性 `edgeId`。

分析输出同时计算：

- `longestChainCards`：最长路径上的执行卡数量，根卡计 1；只排除纯来源记录，不排除公共接口
  卡或收尾卡。
- `parallelWidth`：同一拓扑 wave 中、可变范围互不冲突且可以同时派发的最大卡数；它不是
  上传网络的 `upload.concurrency`。

超过 3 张卡的最长链必须在决策账本留下用户确认；只能删除无依据或重复边，不能为了降低指标
隐藏真实依赖。

当前阻塞链从下游节点反向遍历前置边，并按 `basis` 分流：

- `basis=interface` 只核对 `contractRefs` 指向的冻结接口/公共产物是否存在、版本/hash 是否可引用；
  上游实现状态未完成不构成阻塞。
- `basis=implementation` 才核对前置卡的 `semantic`、`isTerminal` 和项目定义的验收通过语义；
  前置状态未知、未达到完成语义或验收未通过时标记为 `blocked`。终态但语义为取消/重复的节点不能默认视为完成。

接口引用缺失、版本漂移或 `basis` 无法判定时，消费卡保持 `conditional`，先补合同或公共产出；
确实存在且已声明的实现前置才进入 `blocked`。

所有引用必须解析到同一项目的唯一对象。跨项目引用可在报告中保留 deep link，但不自动
建立项目内关系。
