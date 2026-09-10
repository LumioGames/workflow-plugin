---
description: 手动刷新线上单据的本地索引——找单号与 Room 用，状态以线上为准
---

跑插件自带的索引刷新脚本并**忽略 15 分钟有效期**（插件根目录就是会话开始时 `<workflow-rules>` 首行给出的那个）：

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/refresh-index.mjs" --force
```

它按 `workflow-ops` 的凭证顺序取值：环境变量 `WORKFLOW_API_BASE` + `WORKFLOW_TOKEN` → 当前目录向上最近的 `.workflow` 标记 → `~/.config/workflow/config.toml` 对应 profile；**绝不回落全局 `current_profile`**——当前目录没有 `.workflow` 就什么都不拉，先转 `workflow-setup` 绑定。索引落在 `$XDG_CACHE_HOME/workflow/index/<host>.json`（缺 XDG 时 `~/.cache`），不进仓、不进插件根。首次或超过 24 小时走全量（按 Room 枚举需求），否则走增量；联不上就沿用旧快照并标「离线沿用」，退出码恒 0。

跑完只做三件事：① 看 stderr（最多一行，没有就是顺利）；② 读索引文件头——先看有没有 `stale`，有则**不要报成功**，说明旧快照保留与失败原因（超时 / 离线 / 已设代理变量名 / 401·403），再读 `refreshedAt`、`fullPulledAt`、`rooms` 数、`items` 数，按 `room` 分组数一下；③ 向用户报一行：路径、条数、各 Room 计数、刷新时间。**不要把索引正文整个贴进对话**，需要找单号时自己 grep 那个文件。不报代理 URL、不报 token。

预设边界：索引只用来找单号和 Room；单据状态以线上为准（现查 transitions），不得据索引里的 `status` 流转任何单。
