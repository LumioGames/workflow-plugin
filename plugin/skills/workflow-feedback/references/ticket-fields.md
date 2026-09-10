# 反馈收件的字段口径（SupportTicketRequest）

提交走 `POST /support/tickets`，multipart/form-data；必填只有 `type` 与 `title`，`source=agent` 时另有五件套必填（见下表加注「agent 必填」的行）。确切约束以合同现查为准（在 OpenAPI 里 grep `SupportTicketRequest`）。

## 关键字段

| 字段 | 口径 |
| --- | --- |
| `type` | 必填，`bug` / `feature`。报错、行为与文档不符、体验不好、卡顿慢 → `bug`；缺失功能、产品建议 → `feature`；分不清就问用户一句 |
| `title` | 必填，≤200 字符。写用户能识别的**现象**（如「需求列表加载超过 10 秒」），不写内部实现猜测 |
| `module` | ≤50 字符，用户说了才填（如「需求看板」「附件上传」） |
| `severity` | `blocker` / `major` / `minor`，**用户说了才填、不替用户默认**——「未评估」和「major」是两回事 |
| `description` | ≤10000 字符：现象 / 期望 / 影响三段。体验类写清慢或卡在哪一步、大约多久、期望多久。operationId、traceId **不塞这里**（有专用字段） |
| `role` | ≤50 字符，用户主动说明身份才填（如「项目管理员」） |
| `contact` | ≤200 字符，仅用户主动留联系方式才填，必须是合法邮箱形态，否则 422。**邮箱只允许进这个字段**——写进 description 或 reproduction 会命中服务端敏感扫描直接 422 |
| `source` | 固定 `agent`——渠道标签，不提供身份或权限 |
| `idempotencyKey` | agent 必填，随机 UUID（≤36 字符）。每一版**确认过的**报告一枚：同版重试复用，内容改动重新确认并重新生成（生命周期见 [submit-flow.md](submit-flow.md)） |
| `userConfirmed` | agent 必填，固定 `true`，且**只在完成 F3 的逐字确认后才允许为 true**——它表示「插件已完成本次显式确认」，不构成授权；未确认就填 true 是伪造确认 |
| `pluginVersion` | agent 必填，≤64 字符，读同包 `workflow-update/VERSION` |
| `hostType` | agent 必填，`codex` / `claude_code`。其他宿主没有对应枚举值——**不硬造**，改走人工渠道 |
| `hostVersion` | agent 必填，≤64 字符，宿主自报版本；取不到填 `unknown` 并如实展示 |
| `operationId` | ≤128 字符，仅允许**公开 OpenAPI** 里的 operationId（如 `createRequirement`） |
| `traceId` | ≤128 字符，仅允许 **ProblemDetails** 返回的 traceId |
| `reproduction` | ≤5000 字符，仅用户主动提供且**已脱敏**的**最小复现**；**禁止完整 HTTP 请求体** |
| `files` | ≤5 个，单个 ≤25MiB，仅本次会话点名的文件（F6）。类型按**扩展名白名单**判定，不信 Content-Type：`.svg`、可执行文件与脚本类会被拒（422）；`.md` / `.html` / `.js` 会按不可信源码保存并强制下载 |

## 不发送清单（确认时逐字展示给用户）

以下内容**绝不进入**报告或附件的任何字段：

- token（任何形态）
- `Authorization` 头
- Cookie
- `.workflow` 文件内容
- `config.toml` 文件内容
- 环境变量（名称与值）
- 邮箱（`contact` 字段除外）
- 项目文件与正文（代码、需求单内容、任何项目数据）
- 跨租户数据（别的项目、别人的信息）
- 账户与会话信息
- 完整 HTTP 请求体
- 本次会话未明确点名的附件

客户端在组装后先自查一遍；服务端还会再扫描一遍——命中敏感内容返回 422，**只指出字段、不回显秘密**。

## 纪律

- 用户没给的字段就是没给：不替他默认、不替他推断。交付时明说哪些留空（如「未评估 severity」「未填 module」）。
- 描述与复现里的个人信息只保留定位问题所需的最小集合。
