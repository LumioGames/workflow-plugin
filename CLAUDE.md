# workflow-plugin

**插件本体在 [`plugin/`](plugin/)；仓库根是开发面，不随插件下发。**

- **发布面 = `plugin/`**：装进用户机器的就是这个目录的全部内容（`skills/` `agents/` `commands/`
  `hooks/` `rules/` `templates/` `tools/` `bin/` + 两份清单 + LICENSE）。
  marketplace 用 `git-subdir` 只拉这一层。
- **开发面 = 仓库根**：`tests/`、`package.json`、`.github/`、`CHANGELOG.md` —— **一律不下发**。
  往 `plugin/` 里放开发过程文件会被 `plugin-lint` 的「发布面隔离」检查拦下。

通用调度与编码规程在 [`plugin/rules/`](plugin/rules/)，由 SessionStart hook 每次会话注入；无钩子的宿主请主动读 `plugin/rules/`。
