---
description: 把想法或文档规划成本地可恢复的 Workflow 需求蓝图，并按权限模式上传
---

强制调起 **workflow-planning** 技能处理下面的输入。先读取来源与项目上下文，一次只问一个真正改变蓝图的问题，执行全局查重和依赖分析，然后把完整蓝图写入本地 `.workflow-drafts/<bundleId>/`。manifest 是本次提单批次的本地清单，不是项目级依赖数据库，也不作为附件上传；后续发现旧单依赖时创建新的增量 bundle，不回写历史清单。输出中必须列出目标 Workflow 项目与 bundle 对象数量及 ready/conditional/blocked 数量。蓝图内容确认不等于线上写入授权；PlanMode 只保留草稿，Auto 由 `/workflow:upload` 做一次 bundle 确认，授权后仅上传节点 `readiness=ready` 的操作。

规划阶段不启动实现、不创建 Worktree、不运行目标仓库测试、不流转需求状态。线上创建、评论、附件、关系和状态写回统一由 `workflow-upload` 按权限模式处理；不会凭空创建未在 manifest 中声明的对象。

用户输入：

$ARGUMENTS
