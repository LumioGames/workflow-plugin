# 测试反模式

**何时读**：写或改测试、加 mock、或者想往生产代码里加只有测试会用的方法时。

## 概述

测试要验证真实行为，不是验证 mock 的行为。mock 是隔离手段，不是被测对象。

**核心原则**：测代码做了什么，不测 mock 做了什么。

**严格的先失败测试能自然避开这些反模式。**

## 三条不做

```
1. 不测 mock 的行为
2. 不往生产类里加只有测试用的方法
3. 不在不理解依赖的情况下 mock
```

## 反模式 1：测 mock 的行为

**违例：**
```typescript
// ❌ 只是在验证 mock 存在
test('renders sidebar', () => {
  render(<Page />);
  expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
});
```

**为什么错**：你在验证 mock 能用，不是组件能用；mock 在就过、不在就挂；对真实行为一无所知。

**问自己**：「我们是不是在测一个 mock 的行为？」

**修法：**
```typescript
// ✅ 测真实组件，或者干脆别 mock 它
test('renders sidebar', () => {
  render(<Page />);  // 不 mock sidebar
  expect(screen.getByRole('navigation')).toBeInTheDocument();
});

// 或者：若为了隔离必须 mock sidebar，就别对 mock 做断言——测 Page 在 sidebar 存在时的行为
```

**门函数：**
```
对任何 mock 元素做断言之前：
  问：「我在测真实组件的行为，还是只在测 mock 存在？」
  若只是 mock 存在 → 停，删掉断言或取消 mock；改测真实行为
```

## 反模式 2：生产类里的测试专用方法

**违例：**
```typescript
// ❌ destroy() 只有测试在用
class Session {
  async destroy() {  // 看起来像生产 API！
    await this._workspaceManager?.destroyWorkspace(this.id);
    // ... cleanup
  }
}

// 测试里
afterEach(() => session.destroy());
```

**为什么错**：生产类被测试专用代码污染；生产里误调很危险；违反 YAGNI 与关注点分离；把对象生命周期和实体生命周期混在一起。

**修法：**
```typescript
// ✅ 测试工具负责测试清理；Session 在生产里没有 destroy()
// test-utils/
export async function cleanupSession(session: Session) {
  const workspace = session.getWorkspaceInfo();
  if (workspace) {
    await workspaceManager.destroyWorkspace(workspace.id);
  }
}

// 测试里
afterEach(() => cleanupSession(session));
```

**门函数：**
```
往生产类加任何方法之前：
  问：「这只有测试会用吗？」 是 → 停，放进测试工具
  问：「这个类拥有该资源的生命周期吗？」 否 → 停，放错类了
```

## 反模式 3：不理解依赖就 mock

**违例：**
```typescript
// ❌ mock 破坏了测试逻辑
test('detects duplicate server', () => {
  // 这个 mock 挡掉了测试依赖的写配置副作用！
  vi.mock('ToolCatalog', () => ({
    discoverAndCacheTools: vi.fn().mockResolvedValue(undefined)
  }));

  await addServer(config);
  await addServer(config);  // 本该抛错——但不会
});
```

**为什么错**：被 mock 的方法有测试依赖的副作用（写配置）；「保险起见多 mock 一点」反而破坏了真实行为；测试因为错误的原因通过或莫名失败。

**修法：**
```typescript
// ✅ 在正确的层级 mock
test('detects duplicate server', () => {
  vi.mock('MCPServerManager'); // 只 mock 慢的那部分：服务启动

  await addServer(config);  // 配置写入了
  await addServer(config);  // 检出重复 ✓
});
```

**门函数：**
```
mock 任何方法之前：先别 mock
  1. 问：「真实方法有哪些副作用？」
  2. 问：「这个测试依赖其中哪些？」
  3. 问：「我完全清楚这个测试需要什么吗？」
  依赖副作用 → 在更低层 mock（真正慢 / 外部的操作），或用保留必要行为的测试替身
  不确定 → 先用真实实现跑一遍，看清实际需要什么，再在正确层级加最小 mock
  红旗：「保险起见 mock 掉」「这可能慢，还是 mock 吧」
```

## 反模式 4：不完整的 mock

**违例：**
```typescript
// ❌ 只 mock 了你以为要用的字段
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' }
  // 缺：下游代码要用的 metadata
};
// 之后：代码访问 response.metadata.requestId 时挂掉
```

**为什么错**：部分 mock 藏着结构性假设；下游可能依赖你没写的字段——静默失败；测试过了集成挂；虚假的信心。

**规矩**：按真实存在的完整数据结构 mock，不只 mock 眼前测试用到的字段。

**修法：**
```typescript
// ✅ 镜像真实 API 的完整结构
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' },
  metadata: { requestId: 'req-789', timestamp: 1234567890 }
  // 真实 API 返回的所有字段
};
```

**门函数：**
```
构造 mock 响应之前：
  查：「真实 API 响应含哪些字段？」（看文档 / 真实样例）
  把下游可能消费的字段全部放进去；对照真实 schema 核一遍
  不确定就把所有已文档化的字段都带上
```

## 反模式 5：测试是事后想起的

**违例：**
```
✅ 实现完成
❌ 没写测试
「可以测了」
```

**为什么错**：测试是实现的一部分，不是可选的后续；没有测试不能声称完成。

**修法**：先失败测试 → 实现 → 重构 → 再说完成。

## mock 变得太复杂时

**征兆**：mock 准备比测试逻辑还长；为了让测试过而 mock 一切；mock 缺少真实组件有的方法；mock 一改测试就挂。

**问自己**：「这里真的需要 mock 吗？」用真实组件的集成测试往往比复杂 mock 更简单。

## 先失败测试为什么能防这些

1. **先写测试** → 逼你想清楚到底在测什么
2. **看它失败** → 证明测的是真实行为，不是 mock
3. **最小实现** → 测试专用方法混不进来
4. **真实依赖** → 先看到测试真正需要什么，再决定 mock

**如果你在测 mock 的行为，说明没先看它对着真实代码失败。**

## 速查

| 反模式 | 修法 |
|--------|------|
| 对 mock 元素断言 | 测真实组件，或取消 mock |
| 生产类里的测试专用方法 | 挪进测试工具 |
| 不理解依赖就 mock | 先理解依赖，再最小化 mock |
| 不完整的 mock | 镜像真实 API 全部字段 |
| 测试是事后的 | 先失败测试 |
| mock 过于复杂 | 考虑集成测试 |

## 红旗

- 断言里出现 `*-mock` 的 test id
- 只在测试文件里被调用的方法
- mock 准备占测试 50% 以上
- 去掉 mock 测试就挂
- 说不清为什么需要这个 mock
- 「保险起见」的 mock

## 一句话

**mock 是隔离工具，不是被测对象。** 发现自己在测 mock 的行为，就回头测真实行为，或者质疑为什么要 mock。
