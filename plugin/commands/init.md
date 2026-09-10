---
description: 装好插件后每个项目跑一次：生成 `.spec/` 骨架与根入口，并接入 Workflow（重跑不覆盖已有文件；已连通则只报告身份）
argument-hint: "[--force]"
---

强制调起 **workflow-init** 技能，严格按其正文两阶段执行，**同一次对话做完**。不要停下来让用户另跑接入命令——已经没有独立的 setup 命令。

## 阶段 1 — 项目文档骨架

跑脚手架（默认**不覆盖**已存在文件；`--force` 才覆盖）：

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/init-scaffold.mjs" --target "${CLAUDE_PROJECT_DIR}" $ARGUMENTS
```

脚本默认不覆盖；根 `CLAUDE.md` 已存在时只补缺失的 `@import` 行；根 `AGENTS.md` 已存在则原样跳过。可以反复跑（升级插件后再跑一次补齐新增模板）。

生成的只有「这个项目是什么、定过什么」——`.spec/AGENTS.md`、`.spec/rules/system.md`、`.spec/knowledge/README.md` 与功能文档模板、`.spec/decisions/README.md`、`.spec/tools/lint-extensions.mjs`，以及根 `CLAUDE.md` 与 `AGENTS.md` 薄指针。**不生成** `.spec/tasks/`、`.spec/plans/`。本阶段**不写** `.workflow`、不生成 token。

向用户交代新建 / 覆盖 / 跳过了哪些文件，并提醒填 `.spec/AGENTS.md` 的三处空。然后**立刻进入阶段 2**。

## 阶段 2 — 立刻接入 Workflow

按 **workflow-init** 的 [references/connection-setup.md](../skills/workflow-init/references/connection-setup.md) 执行（从 Step 0 静默探测开始）。凭证解析只认 workflow-ops 的 `connection.md`。本阶段不把 token 读进会话。没走到「GET /me 与 GET /projects/current 都返回 200，并向用户报告连接身份」不算初始化完成。已连通则只报告身份。
