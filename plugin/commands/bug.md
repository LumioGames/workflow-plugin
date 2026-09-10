---
description: 把一个 bug 记录成本地可恢复的 Workflow 草稿（只记录，不修复）
---

调起 **workflow-ops** 技能的记 bug 流程处理下面这条 bug。预设边界：**只记录，不启动修复，不扩写成开发任务**。先按技能要求全局查重和分析依赖，再生成本地 bundle；线上写入统一交给 `/workflow:upload`，按当前权限模式执行并读回。

用户描述原文（即 bug 现象）：

$ARGUMENTS
