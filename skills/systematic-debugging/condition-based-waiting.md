# 条件等待

## 概述

不稳定的测试常常靠随手写的延时来猜时序。这会造成竞态：快机器上过、负载高或 CI 上挂。

**核心原则**：等你真正关心的那个条件，不猜它要多久。

## 何时用

- 测试里有随手写的延时（`setTimeout`、`sleep`、`time.sleep()`）
- 测试不稳定（有时过、负载高就挂）
- 并行跑时超时
- 在等异步操作完成

**不用于**：在测真实的时序行为（防抖、节流间隔）——这种情况保留延时，但必须写清**为什么**。

## 核心模式

```typescript
// ❌ 之前：猜时序
await new Promise(r => setTimeout(r, 50));
const result = getResult();
expect(result).toBeDefined();

// ✅ 之后：等条件
await waitFor(() => getResult() !== undefined);
const result = getResult();
expect(result).toBeDefined();
```

## 常用写法

| 场景 | 写法 |
|------|------|
| 等事件 | `waitFor(() => events.find(e => e.type === 'DONE'))` |
| 等状态 | `waitFor(() => machine.state === 'ready')` |
| 等数量 | `waitFor(() => items.length >= 5)` |
| 等文件 | `waitFor(() => fs.existsSync(path))` |
| 复合条件 | `waitFor(() => obj.ready && obj.value > 10)` |

## 实现

通用轮询函数：
```typescript
async function waitFor<T>(
  condition: () => T | undefined | null | false,
  description: string,
  timeoutMs = 5000
): Promise<T> {
  const startTime = Date.now();

  while (true) {
    const result = condition();
    if (result) return result;

    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`);
    }

    await new Promise(r => setTimeout(r, 10)); // 每 10ms 轮询一次
  }
}
```

领域化的辅助函数照同一个骨架写——等某类事件、等事件数量、等匹配某谓词的事件：

```typescript
export function waitForEvent<E extends { type: string }>(
  getEvents: () => E[],
  eventType: E['type'],
  timeoutMs = 5000
): Promise<E> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      const event = getEvents().find((e) => e.type === eventType);
      if (event) {
        resolve(event);
      } else if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for ${eventType} event after ${timeoutMs}ms`));
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

export function waitForEventCount<E extends { type: string }>(
  getEvents: () => E[],
  eventType: E['type'],
  count: number,
  timeoutMs = 5000
): Promise<E[]> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      const matching = getEvents().filter((e) => e.type === eventType);
      if (matching.length >= count) {
        resolve(matching);
      } else if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for ${count} ${eventType} events (got ${matching.length}) after ${timeoutMs}ms`));
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}
```

## 常见错误

- ❌ **轮询太快**：`setTimeout(check, 1)` 浪费 CPU → ✅ 每 10ms
- ❌ **没有超时**：条件永远不满足就死循环 → ✅ 一定带超时和清晰的错误信息
- ❌ **陈旧数据**：在循环外缓存状态 → ✅ 在循环里调 getter 拿新数据

## 什么时候固定延时是对的

```typescript
// 工具每 100ms tick 一次——需要 2 个 tick 才能验证部分输出
await waitForEvent(manager, 'TOOL_STARTED'); // 先等触发条件
await new Promise(r => setTimeout(r, 200));   // 再等时序行为
// 200ms = 100ms 间隔的 2 个 tick——有依据、有注释
```

**要求**：先等触发条件；延时基于已知时序（不是猜）；注释写明**为什么**。
