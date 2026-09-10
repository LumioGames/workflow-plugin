---
name: knowledge
description: 项目知识库导航——查「某事怎么做」(standards)或「某功能怎么设计的」(features)时，从这里找到对应 .md
metadata:
  type: index
---

# Knowledge（项目知识库 · 导航）

本文件是 `knowledge/` 下所有 .md 的导航：一行描述 + 路径，按需下钻。

> **导航行与各文档 frontmatter `description` 同一句话口径，只写「是什么 + 何时查」。** 交付历史在 git，不进文档；长度 / status 枚举 / 登记覆盖 / 链接可达由 `/workflow:lint` 机械校验。

## standards/（开发规范 · 要遵守的「怎么做」）

| 文档 | 一句话 |
|------|--------|
| — | （暂无；新增规范文档放 `standards/`，并在此登记一行） |

## features/（功能设计与记录 · 供了解）

| 文档 | 一句话 |
|------|--------|
| [`features/_TEMPLATE.md`](features/_TEMPLATE.md) | 新功能文档模板——新增功能记录时照此建 |

---

新增 / 修改 / 维护知识文档（放哪、frontmatter、同步本导航）→ 用 `spec-steward` 技能；决策记录（唯一落点）→ [`../decisions/`](../decisions/README.md)。
