# 根因回溯

## 概述

bug 常常在调用栈深处才显形（在错误目录里 git init、文件建到了错误位置、数据库用了错误路径）。本能是在报错的地方修，那是在治症状。

**核心原则**：沿调用链向上追，直到找到最初的触发点，然后在源头修。

## 何时用

- 错误发生在执行深处（不在入口）
- 堆栈显示很长的调用链
- 不清楚坏数据从哪来
- 要找出是哪个测试 / 哪段代码触发的问题

能向上追 → 追到源头修；追到死胡同 → 只能在症状处修，但要说明。追到源头之后，再加 [defense-in-depth.md](defense-in-depth.md) 的多层校验。

## 回溯过程

### 1. 观察症状
```
Error: git init failed in ~/project/packages/core
```

### 2. 找直接原因
**哪段代码直接导致了它？**
```typescript
await execFileAsync('git', ['init'], { cwd: projectDir });
```

### 3. 问：谁调用了它？
```typescript
WorktreeManager.createSessionWorktree(projectDir, sessionId)
  → called by Session.initializeWorkspace()
  → called by Session.create()
  → called by test at Project.create()
```

### 4. 继续向上
**传进来的值是什么？**
- `projectDir = ''`（空字符串！）
- 空字符串作为 `cwd` 会解析成 `process.cwd()`
- 那就是源码目录！

### 5. 找到最初触发点
**空字符串从哪来？**
```typescript
const context = setupCoreTest(); // Returns { tempDir: '' }
Project.create('name', context.tempDir); // 在 beforeEach 之前就访问了！
```

## 加堆栈日志

手动追不动时，加仪器：

```typescript
// 在有问题的操作之前
async function gitInit(directory: string) {
  const stack = new Error().stack;
  console.error('DEBUG git init:', {
    directory,
    cwd: process.cwd(),
    nodeEnv: process.env.NODE_ENV,
    stack,
  });

  await execFileAsync('git', ['init'], { cwd: directory });
}
```

**要点**：测试里用 `console.error()`（logger 可能被压掉）。

**跑并抓取：**
```bash
npm test 2>&1 | grep 'DEBUG git init'
```

**分析堆栈**：找测试文件名；找触发调用的行号；找规律（同一个测试？同一个参数？）。

## 找出是哪个测试污染了环境

测试跑完多了不该有的文件 / 状态，但不知道是哪个测试造成的：逐个跑、第一次出现污染就停。下面是二分脚本，按需存成本地脚本执行（它不随技能分发）：

```bash
#!/usr/bin/env bash
# 用法: find-polluter.sh <要检查的文件或目录> <测试文件模式>
# 例:   find-polluter.sh '.git' 'src/**/*.test.ts'
set -e
[ $# -eq 2 ] || { echo "usage: $0 <file_to_check> <test_pattern>"; exit 1; }
POLLUTION_CHECK="$1"; TEST_PATTERN="$2"
TEST_FILES=$(find . -path "$TEST_PATTERN" | sort)
TOTAL=$(echo "$TEST_FILES" | wc -l | tr -d ' ')
COUNT=0
for TEST_FILE in $TEST_FILES; do
  COUNT=$((COUNT + 1))
  if [ -e "$POLLUTION_CHECK" ]; then
    echo "污染在第 $COUNT/$TOTAL 个测试之前已存在，跳过: $TEST_FILE"; continue
  fi
  echo "[$COUNT/$TOTAL] $TEST_FILE"
  npm test "$TEST_FILE" > /dev/null 2>&1 || true
  if [ -e "$POLLUTION_CHECK" ]; then
    echo "找到污染源: $TEST_FILE  产生了: $POLLUTION_CHECK"; ls -la "$POLLUTION_CHECK"; exit 1
  fi
done
echo "没找到污染源，全部测试干净"
```

## 真实例子：空的 projectDir

**症状**：`.git` 建在了 `packages/core/`（源码目录）。

**回溯链：**
1. `git init` 跑在 `process.cwd()` ← cwd 参数为空
2. WorktreeManager 收到空 projectDir
3. Session.create() 传了空字符串
4. 测试在 beforeEach 之前访问了 `context.tempDir`
5. setupCoreTest() 初始返回 `{ tempDir: '' }`

**根因**：顶层变量初始化时访问了空值。

**修法**：把 tempDir 改成 getter，在 beforeEach 之前访问就抛错。

**并加了多层防御：**
- 第 1 层：Project.create() 校验目录
- 第 2 层：WorkspaceManager 校验非空
- 第 3 层：NODE_ENV 守卫拒绝在临时目录之外 git init
- 第 4 层：git init 之前记堆栈日志

## 原则

找到直接原因 → 能再向上一级吗？能 → 继续追 → 到源头了吗？没到 → 继续；到了 → 在源头修 → 每层加校验 → bug 不可能再发生。

**永远不要只在报错处修。** 追回去找最初的触发点。

## 堆栈日志小贴士

- **测试里**：用 `console.error()`，不用 logger——logger 可能被压掉
- **在操作之前记**：在危险操作之前打日志，不是失败之后
- **带上下文**：目录、cwd、环境变量、时间戳
- **抓堆栈**：`new Error().stack` 给出完整调用链
