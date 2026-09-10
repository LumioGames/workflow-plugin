# 项目中心文档

本项目使用 Workflow 插件（`workflow`）的调度与编码规程。**通用规则在插件 `rules/`，由 SessionStart 钩子每次会话注入；无钩子的宿主请主动读插件 `rules/` 下的文件。** 本文件只写「这个项目是什么、定过什么」，不复制插件任何一段——`/workflow:lint` 的指纹检查会把抄来的段落报出来。

## 项目是什么

<!-- 填写：一句话定位 / 技术栈 / 关键边界与不做什么。 -->

## Workflow 指针

本项目关心的 Room 表（手工维护，很少变；单号真值在线上）：

| Room | 单号前缀 | 管什么 |
|------|----------|--------|
| <!-- 填写 --> | | |

- 遇到单号、或想知道线上有什么：先 `GET /search`（或 Room overview），再看本地索引；状态以线上 transitions 为准，不凭本地记忆流转。
- 项目绑定用仓根 `.workflow`（只含 `profile` 名，不含 token），由 `/workflow:init` 的接入阶段写入。

## 收口命令

<!-- 填写本项目的验证命令；交回物里如实写「跑了什么 / 什么都没跑」。例： -->

```bash
npm test
```

## 专属技能名册

<!-- 只登记本项目自建的技能（.spec/skills/ 或 .claude/skills/）；插件自带的不登记。没有就保留下面这行。 -->

- 无

## 知识与决策

- 知识导航：[`knowledge/README.md`](knowledge/README.md)
- 决策唯一落点：[`decisions/`](decisions/README.md)（ADR；Accepted 后不改写，只新增取代）
- 项目专属红线：[`rules/system.md`](rules/system.md)（只放这个项目独有的）
- 结构体检扩展：[`tools/lint-extensions.mjs`](tools/lint-extensions.mjs)（可选；通用项在插件里）
