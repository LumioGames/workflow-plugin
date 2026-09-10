import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin");

function read(relativePath) {
  const absolute = join(pluginRoot, relativePath);
  assert.ok(existsSync(absolute), `缺少 ${relativePath}`);
  return readFileSync(absolute, "utf8");
}

const skill = read("skills/workflow-upload/SKILL.md");
const draft = read("skills/workflow-ops/references/draft-format.md");
const calls = read("skills/workflow-ops/references/call-templates.md");
const delivery = read("skills/workflow-ops/references/delivery.md");
const command = read("commands/upload.md");
const connection = read("skills/workflow-ops/references/connection.md");
const gates = read("skills/workflow-ops/references/gates.md");
const cardSpec = read("skills/workflow-ops/references/card-spec.md");
const ops = read("skills/workflow-ops/SKILL.md");
const search = read("skills/workflow-ops/references/search.md");
const apiDelivery = read("skills/workflow-planning/references/api-delivery.md");

describe("Workflow bundle 上传合同", () => {
  test("默认有界并发，且可配置但不能无限扩张", () => {
    for (const text of [skill, draft, calls, delivery]) {
      assert.match(text, /concurrency/);
      assert.match(text, /4/);
      assert.match(text, /8/);
    }
    assert.match(skill, /有界 worker pool/);
    assert.match(skill, /默认为 `4`/);
    assert.match(skill, /范围 `1–8`/);
    assert.match(draft, /"strategy": "bounded-worker-pool"/);
    assert.match(draft, /不创建无限线程或无限请求/);
  });

  test("并发调度遵守 DAG、资源锁和关系 UUID 前置", () => {
    assert.match(skill, /`dependsOn` 已 `verified`/);
    assert.match(skill, /同一资源的 PATCH、附件、评论和交接纪要按资源锁串行/);
    assert.match(skill, /关系操作必须等待两端 UUID 都已读回/);
    assert.match(calls, /topologicalWaves/);
    assert.match(calls, /targetType \+ targetId.*资源锁/);
    assert.match(calls, /关系 Provider\n必须等待两端节点 `verified`/);
    assert.match(skill, /新蓝图先创建总需求\/公共接口/);
    assert.match(skill, /增量 bundle[\s\S]{0,80}不修改历史 manifest/);
  });

  test("每个 worker 独立幂等、重试、读回和 checkpoint", () => {
    assert.match(skill, /确定性的幂等 key/);
    assert.match(skill, /429 按 `Retry-After`/);
    assert.match(skill, /每次请求完成（成功、失败或被阻塞）都原子更新 manifest checkpoint/);
    assert.match(skill, /读回必须在 worker 内完成/);
    assert.match(draft, /每个操作独立记录 `in_flight`/);
    assert.match(calls, /request -> retry with same idempotency key -> GET read-back -> checkpoint/);
    assert.match(delivery, /每个操作都必须有独立读回证据/);
  });

  test("失败 worker 不抹掉成功结果，命令保留部分成功", () => {
    assert.match(skill, /继续执行没有依赖它的操作/);
    assert.match(skill, /保留 bundle/);
    assert.match(skill, /部分成功/);
    assert.match(command, /部分成功、失败或图谱被裁剪时保留草稿/);
    assert.match(delivery, /已验证\/失败\/阻塞操作数/);
  });

  test("本地 ready 后才上传，四种权限模式入口一致", () => {
    assert.match(skill, /`plan` 模式在此停止/);
    assert.match(skill, /`auto`.*只确认一次 bundle/);
    assert.match(skill, /`manual`.*逐组确认/);
    assert.match(skill, /`full`.*草稿 ready 后自动/);
    assert.match(command, /PlanMode 禁止上传/);
    assert.match(command, /Auto 只做一次\s+bundle 确认/);
    assert.match(command, /全部授权自动执行/);
  });

  test("Requirement 引用使用原生无向 Provider 并校验图谱裁剪", () => {
    assert.match(skill, /bindRequirementReference/);
    assert.match(skill, /getRequirementGraph/);
    assert.match(skill, /图谱中的引用边是无向的/);
    assert.match(skill, /truncated=true/);
  });

  test("规划审查决定可执行资格，条件化与阻塞卡不派工", () => {
    assert.match(skill, /规划审查/);
    assert.match(skill, /规划 bundle[\s\S]*节点 `readiness` 过滤/);
    assert.match(skill, /bundle 级 audit 状态只作汇总报告/);
    assert.match(skill, /readiness=conditional/);
    assert.match(skill, /readiness=blocked/);
    assert.match(skill, /planning 节点只有 `readiness=ready`/);
    assert.doesNotMatch(skill, /planning\.auditStatus/);
    assert.doesNotMatch(skill, /只有 `status=ready`/);
    assert.match(draft, /planning\.context/);
    assert.match(draft, /`planning` 是规划 bundle 的可选元数据块/);
    assert.match(draft, /new_blueprint/);
    assert.match(draft, /incremental/);
    assert.match(draft, /audit/);
    assert.doesNotMatch(draft, /standardVersion/);
  });
});

describe("建单幂等与对账（重复建单防线）", () => {
  test("create 的幂等键必须先写入 manifest，禁止现场 uuidgen", () => {
    assert.match(draft, /"idempotencyKey"/);
    assert.match(draft, /UUID v5/);
    assert.match(draft, /bundleId \+ ":" \+ opId/);
    assert.match(draft, /发出前必须已经写入 manifest/);
    assert.match(draft, /create 类 POST 缺 `idempotencyKey` 不得发出/);
    assert.match(skill, /idempotencyKey/);
    assert.doesNotMatch(calls, /Idempotency-Key: \$\(uuidgen\)/);
    assert.doesNotMatch(cardSpec, /Idempotency-Key: \$\(uuidgen\)/);
    assert.doesNotMatch(ops, /\$\(uuidgen\)/);
    assert.match(calls, /禁止 `IDEMPOTENCY_KEY=\$\(uuidgen\)`/);
  });

  test("写操作默认不重试；只有落盘幂等键才允许同键重放", () => {
    assert.match(connection, /写操作默认不重试/);
    assert.match(connection, /只有携带落盘幂等键时才允许重试/);
    assert.match(skill, /没有落盘幂等键不得重发/);
  });

  test("响应读取失败与发送失败分列，前者不得自动重发", () => {
    assert.match(connection, /响应读取失败 \/ 连接中断/);
    assert.match(connection, /请求可能已送达/);
    assert.match(connection, /IncompleteRead/);
    assert.match(connection, /不得自动重发/);
    assert.match(connection, /不得把 POST 与 GET 包进同一套/);
  });

  test("G3 要求批量全量数量对账，不只核对自称创建的那张", () => {
    assert.match(gates, /本批标题各恰好 1 条且条数 == 预期/);
    assert.match(gates, /只核自称创建的那张不算过闸/);
    assert.match(skill, /全量数量对账/);
    assert.match(skill, /标题重复/);
    assert.match(delivery, /全量数量对账/);
    assert.match(calls, /只 GET 自称 UUID 不算过 G3/);
    assert.match(ops, /只核自称创建的那张不算过闸/);
  });

  test("search / planning 恢复路径不得把「没读回响应」当成发送失败", () => {
    assert.match(search, /响应读取失败/);
    assert.match(apiDelivery, /响应读取失败/);
    assert.match(ops, /响应读取失败/);
    assert.doesNotMatch(search, /补写键之后发送/);
    assert.match(search, /只读对账并停下/);
    assert.match(search, /禁止补写新键后再发送/);
  });
});
