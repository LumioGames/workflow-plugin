#!/bin/sh
# 官网 / 本仓手动安装入口。检查 Node ≥ 20 后转调 workflow-install.mjs；默认 --mode full。
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "workflow-install: 需要 Node.js >= 20，当前环境找不到 node" >&2
  exit 1
fi

major=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$major" -lt 20 ]; then
  echo "workflow-install: 需要 Node.js >= 20，当前 $(node -v)" >&2
  exit 1
fi

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$here/../tools/workflow-install.mjs" "$@"
