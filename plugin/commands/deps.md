---
description: 分析 Workflow 单据或本地草稿的上下游依赖并补全关系清单
---

调起 **workflow-dependencies** 技能分析下面的单号或草稿。先做项目级全局搜索，解析明确引用并
自动补全语义依赖，输出直接边、传递链、阻塞链、证据和置信度。Requirement direct edge 上传时
使用原生无向 `references` API；图谱 `source/target` 仅是展示顺序，不代表依赖方向。结果写回
本地 bundle；需要线上写入时交给 `/workflow:upload`，不在本命令里绕过权限模式。

目标单号或草稿路径：

$ARGUMENTS
