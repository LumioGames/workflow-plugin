---
description: 检查并更新 Workflow Agent 插件到最新版本
---

强制调起 **workflow-update** 技能，严格按其正文流程执行：**先判安装形态**（宿主托管 / 手动安装）→ 宿主托管交给宿主自己的更新机制、不读官网 version.json；手动安装才读本地 VERSION 并带 cb 参数比对线上 version.json。手动安装的落盘走 `workflow-install.mjs`（默认 full、备份不进 skills、白名单内 `.mjs` 才允许），必要时 `--doctor` 只打印兼容性诊断，不删 ADR / 历史计划。
