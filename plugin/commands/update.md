---
description: 检查并更新 Workflow Agent 插件到最新版本
---

强制调起 **workflow-update** 技能，严格按其正文流程执行：**先判安装形态**（宿主托管 / 手动安装）→ 宿主托管交给宿主自己的更新机制、不读官网 version.json；手动安装才读本地 VERSION 并带 cb 参数比对线上 version.json，必要时走 sha256 校验的自更新。
