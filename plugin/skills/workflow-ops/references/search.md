# 搜索与查重（共享规则）

**本文件是 ops / planning / execute 共用的单一真相源。** 「什么时候必须先搜索」的动作顺序和 `/search` 的真实能力都以这里为准，各技能不要另写一份口径。

## 一、三个必搜场景（硬性动作顺序，不许跳过）

1. **建单前查重**——需求、bug、任务都适用。关键词取现象/成果的名词，用户给了单号就按单号精确查。命中疑似同一对象 → 先把 `displayKey` + 标题报给用户，**不默默建第二张**；确认是同一个就改为在旧单上补评论/附件。若新材料改变了需求正文，默认提出“在原单下追加评论记录”或“按授权 PATCH 更新原单”两种处置，只有明确选择后才写入。
2. **回答历史类问题之前**——「之前有没有记过…」「这个问题处理过吗」「当时为什么这么定」：先按关键词搜到对象，再用它的评论与 activity 回答（见 [read-card.md](read-card.md) 第二节）。**不凭会话记忆答「没有」**。
3. **拿单开工之前**——按卡内引用的单号与关键词找前置单、关联单和历史同类单（workflow-execute 的读单步骤）。

「搜不到」≠「不存在」：答复只能说「按 X、Y 关键词未搜到」；判定口径见第五节，不要把一次未命中写成「项目里没有」。

## 二、全局搜索的两个时间点

- **草稿生成前**：规划或单次建单开始时先搜索整个当前项目，记录 `dedupe.queries`、命中对象和
  读回快照；不能只搜当前 Room、当前用户或最近一页。
- **上传前**：本地 bundle ready 后、任何 POST/PATCH/PUT/DELETE 前重新执行同一组全局搜索。新命中
  要暂停对应操作，走“复用 / 追加评论 / 授权更新 / 另建”处置；其余独立操作仍可上传。

搜索结果是查重输入，不是写入授权。`workflow-upload` 必须把最终处置和重新搜索的时间写进
manifest；无连接时先写 `searchPending=true`，连接恢复后不能跳过上传前查重。

## 三、`/search` 当前真实能力（已按合同核实，operationId `searchProject`）

- `q` 必填。带 `R-` / `B-` / `T-` / `RM-` / `MS-` / `DOC-` 前缀的 displayKey 走**精确定位**；其余按**标题、摘要或正文**召回——**正文可搜**（PostgreSQL 搜索投影）。
- `types`：逗号分隔的对象类型过滤，词表 `requirement` / `bug` / `work_item` / `room` / `document` / `milestone`。
- `scope`：`title` / `body` / `mixed`（默认 mixed）。找正文标记用 `body`，找标题前缀用 `title`。
- `status`：逗号分隔；状态值沿用项目自定义工作流，**不猜词表**（G6），先从对象或 transitions 读到真实状态 key 再用。
- `roomId`：按需求室收窄（UUID）。找室内已有卡时**必须带上**；只覆盖需求与工作项/缺陷，文档和里程碑没有室归属，带了就一定搜不到这两类。
- `labelIds`：逗号分隔标签 UUID，OR 语义。
- **有 cursor 分页**：`nextCursor` 为空才是终点；cursor 绑定 `indexVersion`，索引版本切换会 422——丢弃旧游标从首页重查，不自拼。
- `limit` 默认 20、上限 50。
- 返回 `items`（type / id / displayKey / title / snippet / matchedField / status / score / deepLink）+ `nextCursor`。`groups` 字段是旧消费者迁移用的，忽略。
- `snippet` 是安全截断片段，**不是全文**：要引用正文，拿 `id`（UUID）GET 对象详情。
- `deepLink` 是相对路径（如 `/requirements/{uuid}`），拼 `https://<子域>.workflow.games<deepLink>` 给用户。

## 四、模板

```bash
# 查重 / 关键词搜索（正文也会被召回）
curl -sS -H "Authorization: Bearer $WORKFLOW_TOKEN" \
  --get --data-urlencode "q=结算 闪退" --data-urlencode "types=bug,requirement" \
  "$WORKFLOW_API_BASE/search"

# 只搜正文（如查找描述里的标记或引用）；室内查重必须带 roomId
curl -sS -H "Authorization: Bearer $WORKFLOW_TOKEN" \
  --get --data-urlencode "q=<正文标记>" --data-urlencode "scope=body" \
  --data-urlencode "roomId=<room-uuid>" --data-urlencode "types=requirement" \
  "$WORKFLOW_API_BASE/search"

# 单号精确定位（R-00001 / B-00042 / RM-00003 / MS-00001 / DOC-00002）
curl -sS -H "Authorization: Bearer $WORKFLOW_TOKEN" \
  --get --data-urlencode "q=B-00042" "$WORKFLOW_API_BASE/search"
```

翻页与列表端点同款循环：原样回传 `nextCursor` 直到空串。

## 五、已存在、室内清单、未落库——三条路不要混

投影由源表触发器与源行同事务维护，两类判定仍然分开：

- **判「已存在」**：`GET /search?q=<标记>&roomId=<室>` **命中即真值**（再 GET 详情核对内容）。不要靠翻完整列表找已有卡。
- **看室内清单**：`GET /requirements?roomId=<室>&view=summary`（cursor 到空）。`view=summary` 只裁 `description`，体积按正文长度可降一个数量级。
- **判「不存在」/ 网络错误后是否已落库**：响应读取失败或连接中断按「请求可能已送达」对账，不得当发送失败自动重发。建单类 POST 已有落盘 `Idempotency-Key` 时**同键同体对账重放**（`201`/`200` 都算成功），不要为了证明未落库去翻全量列表。「搜不到」≠「不存在」；**不得以 search 未命中作为未落库的唯一依据**。没带幂等键时，用室内 `view=summary` 列表核对标题与正文标记，**只读对账并停下**；禁止补写新键后再发送。仅「请求确认未发出」才允许先把键落入 manifest 再作首次发送。
