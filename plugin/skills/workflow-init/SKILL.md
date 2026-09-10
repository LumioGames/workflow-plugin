---
name: workflow-init
description: 装好插件后每个项目跑一次（也可重跑）：生成 .spec 骨架与根入口，并接入 Workflow。已有项目文件默认不覆盖；已连通则只报告身份。还没有账号或 API token、调 API 遇到 401 或 403、要查连接或新增/切换项目时使用。
---

# workflow-init — 项目文档初始化并接入 Workflow

用户要的是**一次初始化**，不是两步。同一次对话做完下面两阶段，不要停下来让用户另跑接入命令。

阶段 1 只写项目文件、**不写 token、不读 `config.toml`、不写 `.workflow`**。阶段 2 才走连接；token 由用户在自己终端写盘，**不进会话**。重跑安全：已有项目文件默认不覆盖；已连通则阶段 2 只按完成判据报告身份。

## 阶段 1 — 项目文档骨架

跑插件自带的脚手架（默认**不覆盖**已存在文件；`--force` 才覆盖）。插件根就是会话开始时给出的那个：

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/init-scaffold.mjs" --target "${CLAUDE_PROJECT_DIR}"
```

脚本默认不覆盖；根 `CLAUDE.md` 已存在时只补缺失的 `@import` 行；根 `AGENTS.md` 已存在则原样跳过。可以反复跑（升级插件后再跑一次补齐新增模板）。

生成的只有「这个项目是什么、定过什么」——`.spec/AGENTS.md`、`.spec/rules/system.md`（项目专属红线的空模板）、`.spec/knowledge/README.md` 与 `.spec/knowledge/features/_TEMPLATE.md`、`.spec/decisions/README.md`、`.spec/tools/lint-extensions.mjs`（lint 扩展样例），以及根 `CLAUDE.md` 与 `AGENTS.md`（薄指针，同一组三行：`.spec/AGENTS.md`、`.spec/knowledge/README.md`、`.spec/rules/system.md`）。**不生成** tasks/、plans/——任务真值只有 Workflow。

本阶段结束后向用户交代：

1. 新建 / 覆盖 / 跳过了哪些文件（跳过 = 用户已有同名文件，未被改动）。
2. **提醒填三处空**——`.spec/AGENTS.md` 的「项目是什么」、「Workflow 指针」的 Room 表、「收口命令」。有明确依据时提出建议值并说明依据；否则不替用户猜。
3. 通用规则由插件每次会话注入，**不要往 `.spec/rules/system.md` 里抄**。

然后**立刻进入阶段 2**，不要把「下一步去接入」留给用户。

## 阶段 2 — 接入 Workflow

完整读取并执行 [references/connection-setup.md](references/connection-setup.md)。凭证解析顺序、API 根地址规范化和可抄的 shell 片段只认 [workflow-ops/references/connection.md](../workflow-ops/references/connection.md)，不要另写一份。

没走到「`GET /me` 与 `GET /projects/current` 都返回 200，并向用户报告连接身份」不算初始化完成。已连通则按该文件 Step 0 直接报告，结束。
