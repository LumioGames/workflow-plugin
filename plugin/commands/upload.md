---
description: 将 Workflow 本地草稿按权限模式可靠上传并逐项读回验证
---

调起 **workflow-upload** 技能处理下面的 bundle。先读取有效权限模式、全局查重结果、依赖 DAG、
ready/conditional/blocked 数量和准确对象数量，再按模式授权：PlanMode 禁止上传，Auto 只做一次
bundle 确认，手动按操作组确认，全部授权自动执行。规划 bundle 仅派发节点 `readiness=ready`
的操作；Requirement 引用使用原生无向 `references` API，并用图谱按无序 UUID 对读回；每次写入
都必须读回；部分成功、失败或图谱被裁剪时保留草稿并如实报告。

bundle ID 或路径：

$ARGUMENTS
