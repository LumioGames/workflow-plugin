# 宿主差异与角色准入

> 判据在 [`../rules/dispatch.md`](../rules/dispatch.md)（调度与编码红线）与
> [`../rules/system.md`](../rules/system.md)（硬红线）。**本文只展开宿主适配，不另立门。**

## 技能名的写法

下文与规则正文一律用**裸名**（如 `workflow-planning`）。Claude Code 把插件技能暴露为
`workflow:<name>`，按裸名匹配即可；按 Agent Plugins 标准直接加载 `skills/` 的客户端看到的就是裸名。
**不在规则正文里硬编码前缀。**

## 能力矩阵

本插件以 Agent 插件分发，双标准并存：技能层遵循 [Agent Plugins 1.0.0](https://agent-plugins.org/)
可跨客户端加载；子 Agent、slash command 与 hook 是 Claude Code 专有层。

| 能力 | Claude Code | Codex / 其他客户端 |
|------|-------------|--------------------|
| 规则常驻 | SessionStart hook 每次会话注入 `rules/` 与索引一行 | **无钩子**——靠项目 `AGENTS.md` 的「通用规则在插件 `rules/`」指针主动读 |
| 索引刷新 | SessionStart hook 自动（15 分钟内不重拉） | 手动跑 `tools/refresh-index.mjs` |
| 技能加载 | 插件自动发现，按 `workflow:<name>` 调用 | 按 Agent Plugins 标准发现 `skills/` |
| 子 Agent | 插件 `agents/` 自动发现 | **无**——主 loop 手动读 `agents/reviewer.md` 本地对抗审查；同上下文自审丧失「写 ≠ 审」独立性，属已知降级 |
| worktree 隔离 | Agent 工具 `isolation: "worktree"` | `git worktree add`；无对应物时并行退化为串行 |
| 任务真值 | Workflow 单（宿主内置任务工具只作个人草稿） | 同左 |

宿主能力演进快，以官方文档为准，偏差时更新本表。

## `agents/` 的准入门槛

**只收「隔离本身即是产出价值」的角色**——当前仅 `reviewer`（写的人 ≠ 审的人，同上下文自审必然失效）。

编码、拆单不设角色：那是方法与规程的事，见各技能与 `dispatch.md` 的「编码约定」。
新增角色前先回答：把它放进主 loop 会丢掉什么？答不上来就不该立。
