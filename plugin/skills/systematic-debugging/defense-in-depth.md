# 多层防御校验

## 概述

修一个坏数据引起的 bug 时，在一处加校验看起来够了。但单点检查会被别的代码路径、重构或 mock 绕过。

**核心原则**：数据经过的**每一层**都校验，让这个 bug 在结构上不可能再发生。

## 为什么要多层

单点校验：「我们修了这个 bug」。多层校验：「我们让这个 bug 不可能发生」。

不同层抓不同情况：入口校验抓大多数；业务逻辑抓边界；环境守卫防特定场景下的危险操作；调试日志在其它层都失效时留线索。

## 四层

### 第 1 层：入口校验
**目的**：在 API 边界拒绝明显非法的输入。

```typescript
function createProject(name: string, workingDirectory: string) {
  if (!workingDirectory || workingDirectory.trim() === '') {
    throw new Error('workingDirectory cannot be empty');
  }
  if (!existsSync(workingDirectory)) {
    throw new Error(`workingDirectory does not exist: ${workingDirectory}`);
  }
  if (!statSync(workingDirectory).isDirectory()) {
    throw new Error(`workingDirectory is not a directory: ${workingDirectory}`);
  }
  // ... proceed
}
```

### 第 2 层：业务逻辑校验
**目的**：确认数据对这个操作是说得通的。

```typescript
function initializeWorkspace(projectDir: string, sessionId: string) {
  if (!projectDir) {
    throw new Error('projectDir required for workspace initialization');
  }
  // ... proceed
}
```

### 第 3 层：环境守卫
**目的**：在特定上下文里阻止危险操作。

```typescript
async function gitInit(directory: string) {
  // 测试里拒绝在临时目录之外 git init
  if (process.env.NODE_ENV === 'test') {
    const normalized = normalize(resolve(directory));
    const tmpDir = normalize(resolve(tmpdir()));

    if (!normalized.startsWith(tmpDir)) {
      throw new Error(
        `Refusing git init outside temp dir during tests: ${directory}`
      );
    }
  }
  // ... proceed
}
```

### 第 4 层：调试仪器
**目的**：为事后取证留上下文。

```typescript
async function gitInit(directory: string) {
  const stack = new Error().stack;
  logger.debug('About to git init', {
    directory,
    cwd: process.cwd(),
    stack,
  });
  // ... proceed
}
```

## 怎么用

找到一个 bug 之后：

1. **追数据流**——坏值从哪来？在哪被用？
2. **列出所有检查点**——数据经过的每一个位置
3. **每层加校验**——入口、业务、环境、调试
4. **逐层测试**——试着绕过第 1 层，确认第 2 层能抓住

## 例子

Bug：空的 `projectDir` 导致在源码目录里 `git init`。

**数据流：**
1. 测试准备 → 空字符串
2. `Project.create(name, '')`
3. `WorkspaceManager.createWorkspace('')`
4. `git init` 跑在 `process.cwd()`

**加的四层：**
- 第 1 层：`Project.create()` 校验非空 / 存在 / 可写
- 第 2 层：`WorkspaceManager` 校验 projectDir 非空
- 第 3 层：`WorktreeManager` 在测试里拒绝临时目录之外的 git init
- 第 4 层：git init 之前记堆栈日志

**结果**：全部测试通过，bug 无法再复现。

## 关键认识

四层都有必要。测试期间每一层都抓到了别的层漏掉的情况：不同代码路径绕过了入口校验；mock 绕过了业务逻辑检查；不同平台的边界情况需要环境守卫；调试日志暴露了结构性误用。

**别只在一处校验。** 每层都加。
