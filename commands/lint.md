---
description: 项目 `.spec/` 结构体检——只报告不阻断，--strict 才非零；在插件仓内则同时校验插件自身
argument-hint: "[--strict] [--json]"
---

跑结构体检。**只报告不阻断**：默认退出码恒 0，红是待办不是门；只有传 `--strict` 才在有错误时退出码 1——那是给 CI 用的，本地照常用 `/workflow:lint`（CI 里免装插件的 `npx` 一行写法见 README）。

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/spec-lint.mjs" "${CLAUDE_PROJECT_DIR}" $ARGUMENTS
```

检查顺序固定、一份报告：通用项（核心文件、frontmatter、导航 / ADR 索引覆盖、链接可达、`@import` 完整、agents / skills frontmatter、软链存活、ADR 撞号与状态行、禁并行文档根）→ 项目扩展（`.spec/tools/lint-extensions.mjs`，可选；`api` 不匹配会报错、不会静默跳过）→ 指纹检查（项目 `AGENTS.md` / `rules/` 出现插件保留标题、或连续 3 行与插件规则逐字相同 = 项目抄了插件）。

如果当前项目**就是 Workflow 插件仓本身**（仓根 `plugin.json` 的 `name` 为 `workflow`），再跑插件自身的校验与测试：

```bash
node "${CLAUDE_PROJECT_DIR}/tools/plugin-lint.mjs" && npm test --prefix "${CLAUDE_PROJECT_DIR}"
```

把失败项逐条报给用户并指出修法；红不能被改成假绿——删检查项、放宽枚举只能经 ADR。全绿就报 OK，不要加修饰。
