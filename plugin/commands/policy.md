---
description: 查看或设置 Workflow 的 Auto、PlanMode、手动和全部授权策略
---

调起 `workflow-ops` 技能并读取 [permission-modes.md](../skills/workflow-ops/references/permission-modes.md)。
`show` 只显示当前生效模式、来源和项目覆盖；`set` 只修改用户级 policy 或项目 `.workflow-policy`，
写入前展示目标文件与新旧值并取得明确确认。项目策略不得把用户级权限提升到 `full`，未知值停止。

操作：

$ARGUMENTS
