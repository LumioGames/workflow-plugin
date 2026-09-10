# 回写 Workflow

QA 结论只能以**三种追加**方式落地：description 末尾的 QA 块、新评论、新附件。原 description 正文、原附件、原评论一字不动（Q6）。

调用姿势（鉴权、分页、multipart、读回）沿用 [workflow-ops 的 call-templates.md](../../workflow-ops/references/call-templates.md)，权限和本地 outbox 规则沿用 [permission-modes.md](../../workflow-ops/references/permission-modes.md) 与 [draft-format.md](../../workflow-ops/references/draft-format.md)，本文件只写 QA 特有的部分。

## 一、写入顺序（固定，每步读回）

顺序不是风格问题：`resolution` 只有在条目**已处于终态**时才能设，提前写必 422；description 是读-改-写，不带并发校验就会盖掉别人的编辑。

1. 把证据附件加入 bundle；上传后按 `(targetType, targetId)` 读回核对数量与归属。
2. **`GET` 单据** → 取当前 `description` 原文与 `updatedAt`，把 CAS 快照写入操作。
3. 把 **`PATCH` description**（原文 + QA 块，带 `expectedUpdatedAt` 与 `reason`）加入 bundle；上传后读回核对**原文一字未变**、QA 块只有一份。
4. 把 **`POST` 评论**加入 bundle；上传后读回核对正文与目标单。
5. **`GET` transitions** → 挑 `allowed=true` 且语义匹配的边 → 把 **`POST` transition**（带 `reason`）加入 bundle，上传后读回核对状态。
6. **仅当条目已落终态且判定需要关单结论** → 把 `PATCH` 写 `resolution` 加入 bundle，再按顺序上传和读回。
7. 上传器末次全量 `GET` → 确认状态、QA 评论、附件、description 块四者都在。

任何一步失败：如实报**部分成功**，列清哪些落库、哪些没有，绝不声称整单已更新。

## 二、description 的 QA 块

用标记包裹，重跑时**整块替换而不是再追加一份**——否则单据会被历次验收撑成流水账。

```markdown
<!-- workflow-qa:start -->
## QA 验收记录

- 最近验收：YYYY-MM-DD HH:mm（时区）· <判定>
- 环境：<受测地址或客户端版本>
- 复现率：<n/n>
- 证据：<本次附件名列表>
- 详情见本单最新一条 QA 评论
<!-- workflow-qa:end -->
```

拼装规则：

- 原文里**已有** `<!-- workflow-qa:start -->` … `<!-- workflow-qa:end -->` → 用新块替换这一段，原文其余部分逐字保留。
- 原文里**没有** → 在原文末尾追加一个空行再接新块。
- 原文为空 → 只写 QA 块，**不替用户补写复现步骤**。
- 块里只放摘要。操作步骤、逐步预期与实际、已尝试变体这些正文放评论，不塞进 description。

```bash
curl -sS -X PATCH "$WORKFLOW_API_BASE/work-items/<uuid>" \
  -H "Authorization: Bearer $WORKFLOW_TOKEN" \
  -H "content-type: application/json" \
  --data '{
    "description":"<原文 + QA 块>",
    "expectedUpdatedAt":"<上一步读到的 updatedAt>",
    "reason":"QA 线上验收结论回写"
  }'
```

`expectedUpdatedAt` 不是可选优化：不带它就是无条件覆盖，别人在你读取之后编辑过的描述会被静默抹掉。**返回 409 就是有人改过** —— 重新 `GET` 原文、重新拼块、重试一次；第二次仍 409 就停下报告，不硬覆盖。

需求单同理，把路径换成 `$WORKFLOW_API_BASE/requirements/<uuid>`。

## 三、QA 评论模板

`POST $WORKFLOW_API_BASE/comments`，`targetType` 取 `bug`（缺陷）或 `requirement`（需求单），`body` 是 Markdown：

```markdown
## QA 线上验收：<判定>

- 环境：<受测地址或客户端版本> · <浏览器/系统> · <视口>
- 时间：YYYY-MM-DD HH:mm（时区）
- 账号：<脱敏标识>
- 复现率：<n/n>
- 验收范围：<页面 / 对象 / 关键前置状态>

### 操作与结果
1. 操作：…
   - 预期：…
   - 实际：…

### 已尝试变体
（仅「未复现」必填，逐条列出换过的浏览器 / 语言 / 视口 / 账号状态 / 时序）

### 证据
- 本次截图：<附件名>
- 原单对照：<引用原附件名，不重复上传>

### 缺口或影响
- 无；或写明未覆盖项、阻塞条件、影响范围、仅单端验证等已知缺口
```

省略没有事实内容的小节，不留空标题。**不得出现**登录名、密码、token、Cookie、他人个人数据或整段控制台日志。

## 四、状态流转与关单结论

先 `GET $WORKFLOW_API_BASE/work-items/<uuid>/transitions` 看有哪些边、`allowed` 是什么，再 `POST $WORKFLOW_API_BASE/work-items/<uuid>/transition`。**永远不硬 `PATCH` 状态**——项目可配自定义工作流，状态词表不是固定枚举（G6）。

- `allowed:false` 的边带 `blockedReason` / `guardCode` → 原样转述给用户，不硬闯、不换路径绕。
- 没有语义匹配且 `allowed` 的边 → **保持原状态**，在评论里写明建议状态。
- 需要经过多个合法节点 → 每一步都查询、执行、读回，不跳状态。
- 取消边与 `requireReason=true` 的边**必须带非空 `reason`**，否则 422。

`resolution` 仅对 `type=bug` 生效，四个值里 QA 只用三个：

| 值 | 什么时候用 | 谁授权 |
| --- | --- | --- |
| `fixed` | 判定「已修复」，复测原步骤不再出现且相邻链路无新问题 | 需要 `membership.permissions` 含 `run_acceptance` |
| `duplicate` | 判定「重复」，与已有单同一根因 | 报用户确认保留哪一张后才写，评论里链到保留单 |
| `cannot_reproduce` | 已完整对齐环境并穷尽变体后仍不存在 | **必须另取用户授权**——判「未复现」本身不足以关单（Q7） |
| `wontfix` | — | **QA 不用**。这是产品决策，不是验收结论 |

时序硬约束：`resolution` **只能在条目已处于终态时写**，非终态写入返回 422。所以永远是「先流转到终态 → 再写 resolution」，不是反过来。缺 `run_acceptance` 权限时停下报告并把结论留在评论里，不换 token、不绕权限。

## 五、失败与幂等恢复

`GET` 类失败按 [connection.md 的失败处置表](../../workflow-ops/references/connection.md)处理。写操作特有的一条：

**网络错误或 5xx 之后，必须先读回确认是否已落库，确认没有才重发。** 这是重复评论、重复附件、QA 块被追加两遍的唯一来源。

重跑整个流程时，第 1–3 步天然幂等（附件按名去重后再传，QA 块整块替换），第 4 步评论**不会**自动去重——重跑前先看最新评论是否已是本次结论。
