# 反馈提交流程（匿名端点）

本技能全程只碰两个公开端点，均无鉴权：`GET /support/config`（开关探测）与 `POST /support/tickets`（收件提交）。**不读取 WORKFLOW_TOKEN、不带任何 `Authorization` 头、不带 Cookie、不复用其他技能的调用模板。**

## 一、开关探测

```bash
curl -sS "https://workflow.games/api/v1/support/config"
```

- `enabled=true` → 继续。
- `enabled=false` → 停止提交，把响应里的 `contactEmail` 与 `feishuGroupLink` 转述给用户走人工渠道。
- 用户点名其他 Workflow 部署时，只替换 Host 部分（如 `https://<子域>.workflow.games`），路径不变，且替换后的 Host 必须出现在确认报告里。

## 二、幂等键生命周期

- 用户对**某一版**报告确认后 → `uuidgen` 生成一枚 UUID，锁定这版内容。
- 同一版遇到网络错误 / 5xx / 429 重试 → **复用同一 key**：服务端对同 key + 同内容返回同一个 `sup_` 回执并标记 `idempotentReplay=true`，不重复收件、不重复存附件、不重复扣收件额度。
- 内容或附件有任何改动 → 旧确认与旧 key 同时作废：重新确认、重新生成。旧 key 配新内容会得到 409 `idempotency_conflict`。
- **绝不换 key 盲重发**——那会绕过服务端幂等去重，制造重复收件。

## 三、提交模板

必发字段（agent 渠道最小集）：

```bash
curl -sS -X POST "https://workflow.games/api/v1/support/tickets" \
  -F "type=bug" \
  -F "title=<现象一句话>" \
  -F "description=<现象 / 期望 / 影响>" \
  -F "source=agent" \
  -F "idempotencyKey=<确认后生成的 UUID>" \
  -F "userConfirmed=true" \
  -F "pluginVersion=<workflow-update/VERSION 的内容>" \
  -F "hostType=claude_code" \
  -F "hostVersion=<宿主版本或 unknown>"
```

- Codex 宿主把 `hostType` 改为 `codex`；`type` 按判定可为 `feature`。
- 可选字段按用户实际提供逐行追加，没给就整行不加：`-F "module=…"`、`-F "severity=…"`、`-F "role=…"`、`-F "contact=…"`、`-F "operationId=…"`、`-F "traceId=…"`、`-F "reproduction=…"`。
- 附件每个一行 `-F "files=@<用户点名的文件路径>"`，至多 5 行（F6）。

干净会话硬要求：命令里**不出现任何 `Authorization` 头**、不出现 `-b` / `--cookie`。带上失效的会话 Cookie 会得到 401，而不是降级为匿名成功。

## 四、回执核对（202）

列表式核对，不把回执 JSON 直接贴给用户：

- `id`：`sup_` 开头的收件编号——**收件不是建单**，转述时明说，状态恒为待人工审核。
- `type`：与提交一致。
- `attachmentsStored`：**已落存储**的附件数；与提交数不一致要说明。
- `idempotentReplay`：为 `true` 说明此前已收到同一份，本次未重复收件。

## 五、出错了

按 SKILL.md 的「失败处置」表执行；ProblemDetails（含 `traceId`）原样转述给用户，**绝不伪装成功**。
