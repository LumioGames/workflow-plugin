# 专业覆盖层索引

每张可执行卡**只选一个主覆盖层**，只读它对应的文件，把适用的跨切面约束合并进基础模板。

**别通读全部覆盖层**——17 个不相关角色定义躺在上下文里会让卡片串味：贴图卡冒出 Code Review、纯配置卡冒出 Red-Green-Refactor。选不准时问「谁对这张卡的交付物负最终责任」，不是「这张卡涉及哪些工种」。

| 主覆盖层 | 何时选 | 文件 |
| --- | --- | --- |
| `[原始需求]` | 复杂蓝图第一张：来源真值与变更控制，**不是**待执行任务 | [overlays/original-requirement.md](overlays/original-requirement.md) |
| `[预研]` | 高风险未知须靠原型/测量/评审消除，要时间盒与停止阈值 | [overlays/spike.md](overlays/spike.md) |
| `[策划·系统/玩法]` | 锁定下游共享的规则、状态机、数值与成功指标 | [overlays/design-system.md](overlays/design-system.md) |
| `[策划·关卡/内容]` | 产出关卡、任务、内容表与节奏难度曲线 | [overlays/design-level.md](overlays/design-level.md) |
| `[叙事/本地化]` | 产出剧本、文本 key、字符串表、翻译/录音 Brief | [overlays/narrative-localization.md](overlays/narrative-localization.md) |
| `[UX/UI]` | 产出信息架构、逐屏流、状态表与交互规格 | [overlays/ux-ui.md](overlays/ux-ui.md) |
| `[美术]` | 产出视觉源资产与导出资产，须在目标引擎评审 | [overlays/art.md](overlays/art.md) |
| `[技术美术]` | 产出 shader / rig / 导入器 / 管线与自动校验 | [overlays/tech-art.md](overlays/tech-art.md) |
| `[动画/VFX/音频]` | 产出运行时表现资产与事件接口（并行生产时分别拆卡） | [overlays/anim-vfx-audio.md](overlays/anim-vfx-audio.md) |
| `[测试·用例]` | 生产代码前把已锁需求转成风险驱动用例矩阵 | [overlays/qa-cases.md](overlays/qa-cases.md) |
| `[程序·协议/公共]` | 锁定 API/DTO、协议、schema 等下游共享合同 | [overlays/dev-contract.md](overlays/dev-contract.md) |
| `[程序·服务端]` | 实现服务端领域规则、存储、鉴权与在线系统 | [overlays/dev-server.md](overlays/dev-server.md) |
| `[程序·客户端]` | 实现客户端/前端运行时，消费锁定协议与设计 | [overlays/dev-client.md](overlays/dev-client.md) |
| `[程序·工具/构建]` | 实现编辑器工具、内容管线、CI 或发布构建 | [overlays/dev-tools.md](overlays/dev-tools.md) |
| `[数据/运营/发布]` | 产出埋点口径、实验分流、灰度开关或发布计划 | [overlays/data-liveops.md](overlays/data-liveops.md) |
| `[集成]` | 合并交付包、处置共享热点、产出可回滚集成候选 | [overlays/integration.md](overlays/integration.md) |
| `[Review]` | 对基线到集成候选做整体对抗审查并给放行结论 | [overlays/review.md](overlays/review.md) |
| `[测试·收尾]` | 执行最终 QA 或领域验收并闭环退回的问题 | [overlays/qa-final.md](overlays/qa-final.md) |

**跨切面约束**：选定主覆盖层后，只把这张卡真正会碰到的横向项并进「详细要求」和「验证计划与证据」——目标平台/机型与输入方式、存档兼容与迁移、回滚路径、在引擎/在机验证场地、性能预算（帧时/内存/包体/面数/容量）、无障碍与本地化、联网确定性与重连、遥测与告警、平台认证。不适用的写「不适用：原因」，不为凑格式生成空条目。
