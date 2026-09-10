---
name: test-driven-development
description: 实现功能、修 bug 或重构、要写生产代码之前使用——按「先写失败测试 → 最小实现 → 重构」推进；这是用 TDD 时的规矩，不是推分支前的门，推分支前不要求跑任何命令。
---

# test-driven-development — 先写失败的测试

## 概述

先写测试，看它失败，再写刚好让它通过的代码。

**核心原则**：没看过测试失败，就不知道它测的是不是对的东西。

**定位**：TDD 是一种方法，用它就守它的规矩——先有失败的测试，再有生产代码。它不是推分支前的门：**推分支前不要求跑任何命令**（ADR-087 决策 2）；交回物里如实写「跑了什么 / 什么都没跑」即可。

## 何时用

- 新功能、bug 修复、重构、行为变更——凡是要写生产代码、且目标行为能被自动化测试捕获的。
- 例外（先问用户）：一次性原型、生成代码、确实没有可自动化测试缝的行为——此时用最近层级的合同 / 仪器化 / 手工验证替代，并在交回物里写明测试性缺口。

用 TDD 时想「这次先跳过、以后补」——停下。写在实现之后的测试只能证明「它现在做什么」，写在前面的才证明「它应该做什么」。

## 用 TDD 时的规矩

```
先有失败的测试，再有生产代码
```

先写了代码再补测试？把代码删掉，从测试重来。不留作「参考」、不「边写测试边改」、不再看它。基于测试重新实现。

## 红 — 绿 — 重构

```
红：写失败测试 → 验证它正确地失败 → 绿：最小实现 → 验证全部通过 → 重构（保持绿）→ 下一个
```

### 红：写一个会失败的测试

写一个最小的测试，说明应该发生什么。

<Good>
```typescript
test('retries failed operations 3 times', async () => {
  let attempts = 0;
  const operation = () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return 'success';
  };

  const result = await retryOperation(operation);

  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
```
名字清楚、测真实行为、只测一件事
</Good>

<Bad>
```typescript
test('retry works', async () => {
  const mock = jest.fn()
    .mockRejectedValueOnce(new Error())
    .mockRejectedValueOnce(new Error())
    .mockResolvedValueOnce('success');
  await retryOperation(mock);
  expect(mock).toHaveBeenCalledTimes(3);
});
```
名字含糊、测的是 mock 不是代码
</Bad>

要求：一个行为；名字说清行为；用真实代码（非不得已不用 mock）。

### 验证红：看着它失败

跑这个测试。确认：

- 是失败，不是报错
- 失败信息符合预期
- 失败原因是功能缺失，不是笔误

**测试直接通过？** 你在测既有行为，改测试。**测试报错？** 先修错，跑到它正确地失败为止。

### 绿：最小实现

写刚好能让测试通过的最简代码。

<Good>
```typescript
async function retryOperation<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  throw new Error('unreachable');
}
```
刚好够用
</Good>

<Bad>
```typescript
async function retryOperation<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    backoff?: 'linear' | 'exponential';
    onRetry?: (attempt: number) => void;
  }
): Promise<T> {
  // YAGNI
}
```
过度设计
</Bad>

不加功能、不顺手重构别的代码、不「改进」到测试要求之外。

### 验证绿：看着它通过

再跑一遍。确认：这个测试通过；其它测试仍通过；输出干净（没有错误、警告）。

**测试失败？** 改代码，不改测试。**别的测试挂了？** 现在修。

### 重构：清理

只在绿之后：去重、改好名字、抽辅助函数。保持绿，不加行为。

### 重复

下一个功能点，下一个失败测试。

## 好测试

| 特质 | 好 | 坏 |
|------|----|----|
| **最小** | 只测一件事。名字里出现「和」就该拆 | `test('validates email and domain and whitespace')` |
| **清楚** | 名字描述行为 | `test('test1')` |
| **表达意图** | 展示想要的 API 长什么样 | 看不出代码应该做什么 |

## 常见借口

| 借口 | 实际 |
|------|------|
| 「太简单不用测」 | 简单代码也会坏。写个测试 30 秒 |
| 「做完再补测试」 | 一写就通过的测试证明不了任何事 |
| 「事后测试效果一样」 | 事后 = 「它做了什么」；事前 = 「它该做什么」 |
| 「我手动测过了」 | 临时 ≠ 系统；没有记录，不能重跑 |
| 「删掉几小时的代码太浪费」 | 沉没成本。留着没被验证的代码是技术债 |
| 「留作参考，先写测试」 | 你会去改它。那就是事后测试。删就是删 |
| 「得先探索一下」 | 可以。探索完扔掉，从 TDD 开始 |
| 「测试难写 = 设计不清」 | 听测试的。难测 = 难用 |
| 「TDD 会拖慢我」 | TDD 比调试快 |
| 「既有代码没有测试」 | 你正在改进它。给既有代码补测试 |

## 红旗——停下，从头来

- 代码在测试之前
- 测试在实现之后
- 测试一写就通过
- 说不清测试为什么失败
- 测试「以后再加」
- 「就这一次」的自我说服
- 「精神比形式重要」「这次情况不一样」

**这些都意味着：删掉代码，从 TDD 重来。**

## 示例：修 bug

**Bug**：空邮箱被接受。

**红**
```typescript
test('rejects empty email', async () => {
  const result = await submitForm({ email: '' });
  expect(result.error).toBe('Email required');
});
```

**验证红**
```bash
$ npm test
FAIL: expected 'Email required', got undefined
```

**绿**
```typescript
function submitForm(data: FormData) {
  if (!data.email?.trim()) {
    return { error: 'Email required' };
  }
  // ...
}
```

**验证绿**
```bash
$ npm test
PASS
```

**重构**：需要时把校验抽成多字段通用的。

## 自检清单

交回前对一遍：

- [ ] 每个新函数 / 方法都有测试
- [ ] 每个测试都看过它先失败
- [ ] 失败原因符合预期（功能缺失，不是笔误）
- [ ] 每个测试都只用最小代码通过
- [ ] 全部测试通过、输出干净
- [ ] 测试用真实代码（mock 只在不得已时）
- [ ] 边界与错误分支覆盖了

打不满勾 = 这段代码没走 TDD。

## 卡住时

| 问题 | 办法 |
|------|------|
| 不知道怎么测 | 先写出你希望有的 API；先写断言；问用户 |
| 测试太复杂 | 设计太复杂。简化接口 |
| 什么都得 mock | 耦合太紧。用依赖注入 |
| 测试准备巨大 | 抽辅助函数；还复杂就简化设计 |

## 与排障的配合

修 bug 先写能复现的失败测试（`systematic-debugging` 第四阶段），再按本循环修——测试同时证明修好了并防回归。

## 测试反模式

加 mock 或测试工具时先读 [testing-anti-patterns.md](testing-anti-patterns.md)：测 mock 而不是测真实行为、往生产类里加只有测试用的方法、不理解依赖就 mock。
