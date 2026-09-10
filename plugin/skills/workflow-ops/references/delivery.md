# 交付口径（收尾必读）

每次操作收尾，按下面的清单向用户汇报。原则：**证据先于声称**——没读回就不说「已创建 / 已修改」。
本地 bundle 是统一 outbox：上传由 `workflow-upload` 执行，独立操作默认以 `concurrency=4`
受控并发，不能把“发起请求”误报成已落库。

## 必报内容

1. **对象清单**：每个创建/修改的对象一行——`displayKey` + UUID + 标题 + 可点链接。`deepLink` 是相对路径，拼 `https://<子域>.workflow.games<deepLink>`（优先用读回响应或搜索结果）。
2. **读回证据**：写操作后的 `GET` 读回关键字段（状态、负责人、优先级等实际落库值），不引用请求体当证据。批量建单必须另附全量数量对账：列表翻页到 `nextCursor` 为空，本批标题各恰好 1 条且条数 == 预期；只核对「你以为建的那张」不够。
3. **边界声明**：明确说没做什么——比如「仅记录 bug，未启动修复」「未指派负责人（用户未点名）」。
4. **查询完整性**：查询类任务要声明是否翻页到 `nextCursor` 为空；只读了首页就说明「仅首页，可能不全」。
5. **失败与遗留**：没成功的调用列出状态码 + ProblemDetails 的 `title` + **`traceId`**（用户拿它找平台方排查）；重试过几次、最终放弃在哪一步。
6. **Bundle 与并发**：报告 `bundleId`、最终 checkpoint、`concurrency`、已验证/失败/阻塞操作数；说明是否存在部分成功和可恢复的 pending upload。
7. **依赖关系**：列出方向性 direct edge、原生 Requirement `references` 的无序 UUID 对、
   `getRequirementGraph` 的 `truncated` 和读回结果；transitive 链只作为分析结果，不声称已单独写入。

## 纪律

- 不虚报：部分成功就说部分成功，列清哪些落库了、哪些没有——防止用户以为全成而漏单。
- 疑似重复建单的场景（网络错误后重发过）要在报告里写明查重结论。
- 并发上传的每个操作都必须有独立读回证据；某一 worker 失败时不得抹掉其它 worker 的成功结果。
- 同一对象的追加评论、附件和更新要按资源锁实际串行，并在报告中说明“复用 / 追加 / 更新”的处置。

## 模板

```
本次操作结果：
- bundle：wf-example（checkpoint=complete，concurrency=4；verified=6，failed=0，blocked=0）
- 已创建 bug B-00087（0199a…e3f2）「结算页负责人显示为原始 id」
  https://<子域>.workflow.games/... （读回确认：status=todo, priority=P1, severity=major）
- 附件 screenshot.png 已上传并读回确认。
- 依赖：R-00010 → R-00087（Provider=RequirementReference/native=true/directional=false；
  graph 读回确认无序 UUID 对存在）
边界：仅记录，未启动修复；未指派负责人。
失败：无。
```
