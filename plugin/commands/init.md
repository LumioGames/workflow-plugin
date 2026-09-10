---
description: 在当前项目生成 `.spec/` 骨架与根 CLAUDE.md / AGENTS.md（只有项目专属那一半；不写 .workflow、不生成 token）
argument-hint: "[--force]"
---

调起 Workflow 插件的项目脚手架。执行：

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/init-scaffold.mjs" --target "${CLAUDE_PROJECT_DIR}" $ARGUMENTS
```

脚本默认**不覆盖**任何已存在文件（`--force` 才覆盖）；根 `CLAUDE.md` 已存在时只补缺失的 `@import` 行；根 `AGENTS.md` 已存在则原样跳过。可以反复跑（升级插件后再跑一次补齐新增模板）。

生成的只有「这个项目是什么、定过什么」那一半——`.spec/AGENTS.md`（项目是什么 / Workflow 指针 Room 表 / 收口命令 / 专属技能名册）、`.spec/rules/system.md`（只放项目专属红线的空模板）、`.spec/knowledge/README.md` 与 `.spec/knowledge/features/_TEMPLATE.md`、`.spec/decisions/README.md`、`.spec/tools/lint-extensions.mjs`（lint 扩展样例），以及根 `CLAUDE.md` 与 `AGENTS.md`（薄指针，同一组三行：`.spec/AGENTS.md`、`.spec/knowledge/README.md`、`.spec/rules/system.md`；Claude 靠 `@import` 展开，Codex 须主动 Read）。**不生成** `.spec/tasks/`、`.spec/plans/`——任务真值只有 Workflow；**不写** `.workflow`、不生成 token——项目绑定跑 `/workflow:setup`。

跑完后向用户交代：

1. 新建 / 覆盖 / 跳过了哪些文件（跳过 = 用户已有同名文件，未被改动）。
2. **提醒填三处空**——`.spec/AGENTS.md` 的「项目是什么」、「Workflow 指针」的 Room 表、「收口命令」。有明确依据时（如 package.json 的 scripts 能直接确定验证命令）提出建议值并说明依据；否则不替用户猜。
3. 通用规则由插件每次会话注入，**不要往 `.spec/rules/system.md` 里抄**；填完跑 `/workflow:lint` 看骨架是否绿。
