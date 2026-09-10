// refresh-index（本地单据索引）的行为测试。
//
// 存在的理由：这个脚本跑在会话开始、无人看着，任何一处出错都只能表现为「索引悄悄不对」——
// 拉了别的项目（回落 current_profile）、把已删的单留着、每次会话都空等超时、两个会话互相
// 覆盖。下面每条都对应 ADR-088「索引文件」规格的一句话。全部用本地 http 打桩与临时目录。

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { refreshIndex, TTL_MS, FULL_INTERVAL_MS } from "../tools/refresh-index.mjs";
import { resolveCredentials, cacheIndexPath } from "../tools/lib/workflow-config.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "tools/refresh-index.mjs");

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

// ---- 打桩服务器：每个测试注入自己的 handler，并记录全部请求 ----

let server;
let port;
let calls = [];
let handler = () => ({ status: 404, body: { title: "not found" } });

function respond(res, { status = 200, body = {}, delayMs = 0 }) {
  const send = () => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  delayMs ? setTimeout(send, delayMs) : send();
}

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization });
    const result = handler(url, req);
    if (result === "hang") return; // 故意不回
    respond(res, result);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(() => server.close());

// ---- 临时目录：每个测试一套 HOME / XDG / 项目目录 ----

let sandbox;
let home;
let cacheHome;
let project;

beforeEach(() => {
  calls = [];
  sandbox = mkdtempSync(join(tmpdir(), "refresh-index-"));
  home = join(sandbox, "home");
  cacheHome = join(sandbox, "cache");
  project = join(sandbox, "project");
  mkdirSync(join(home, ".config/workflow"), { recursive: true });
  writeFileSync(
    join(home, ".config/workflow/config.toml"),
    `current_profile = "global"\n\n[profiles.global]\nbase_url = "http://127.0.0.1:1"\ntoken = "wfp_global000"\n\n[profiles.sandbox]\nbase_url = "http://127.0.0.1:${port}"\ntoken = "wfp_sandbox00"\n`,
  );
  mkdirSync(join(project, ".git"), { recursive: true });
  writeFileSync(join(project, ".workflow"), 'profile = "sandbox"\n');
});

const env = () => ({ PATH: process.env.PATH, HOME: home, XDG_CACHE_HOME: cacheHome });
const indexPath = () => cacheIndexPath({ env: env(), home, host: "127.0.0.1" });
const readIndex = () => JSON.parse(readFileSync(indexPath(), "utf8"));

function run(options = {}) {
  const logs = [];
  const result = refreshIndex({
    env: env(),
    cwd: project,
    home,
    now: () => NOW,
    log: (line) => logs.push(line),
    requestTimeoutMs: 300,
    totalBudgetMs: 1500,
    ...options,
  });
  return result.then((r) => ({ ...r, logs }));
}

function seedIndex(overrides = {}) {
  const doc = {
    api: 1,
    host: "127.0.0.1",
    serverTime: iso(NOW - 2 * TTL_MS),
    fullPulledAt: iso(NOW - 2 * TTL_MS),
    refreshedAt: iso(NOW - 2 * TTL_MS),
    rooms: { "RM-00001": { id: "room-1", name: "Room 1" } },
    items: {
      "R-00001": { type: "requirement", room: "RM-00001", title: "旧标题", status: "s0", updatedAt: "2026-09-10T10:00:00Z" },
      "R-00002": { type: "requirement", room: "RM-00001", title: "会被删", status: "s0", updatedAt: "2026-09-10T10:00:00Z" },
    },
    ...overrides,
  };
  mkdirSync(dirname(indexPath()), { recursive: true });
  writeFileSync(indexPath(), JSON.stringify(doc));
  return doc;
}

const ROOMS = { items: [{ id: "room-1", displayKey: "RM-00001", name: "Room 1" }, { id: "room-2", displayKey: "RM-00002", name: "Room 2" }] };

function fullHandler(url) {
  if (url.pathname === "/api/v1/rooms") return { body: ROOMS };
  if (url.pathname === "/api/v1/requirements") {
    const roomId = url.searchParams.get("roomId");
    const cursor = url.searchParams.get("cursor");
    if (roomId === "room-1" && !cursor) {
      return { body: { items: [{ displayKey: "R-00001", title: "一", status: "s1", updatedAt: "2026-09-10T11:00:00Z" }], nextCursor: "page2" } };
    }
    if (roomId === "room-1" && cursor === "page2") {
      return { body: { items: [{ displayKey: "R-00002", title: "二", status: "s1", updatedAt: "2026-09-10T11:00:00Z" }], nextCursor: "" } };
    }
    if (roomId === "room-2") {
      return { body: { items: [{ displayKey: "R-00003", title: "三", status: "s2", updatedAt: "2026-09-10T11:00:00Z" }], nextCursor: "" } };
    }
  }
  return { status: 500, body: { title: `unexpected ${url.pathname}` } };
}

describe("凭证解析（不回落 current_profile）", () => {
  test(".workflow 缺失：不拉、不写文件、不警告", async () => {
    rmSync(join(project, ".workflow"));
    const r = await run();
    assert.equal(r.status, "no-marker");
    assert.deepEqual(r.logs, []);
    assert.deepEqual(calls, []);
    assert.equal(existsSync(join(cacheHome, "workflow")), false);
  });

  test(".workflow 存在但解析不出 profile：一行警告、不拉、绝不用 current_profile", async () => {
    writeFileSync(join(project, ".workflow"), "profile = 'sandbox'\n"); // 单引号 = 解析失败
    const r = await run();
    assert.equal(r.status, "no-credentials");
    assert.equal(r.logs.length, 1);
    assert.match(r.logs[0], /解析不出 profile/);
    assert.deepEqual(calls, []);
    assert.equal(existsSync(join(cacheHome, "workflow")), false);
  });

  test("profile 在 config 里不存在 / 不完整：一行警告、不拉", async () => {
    writeFileSync(join(project, ".workflow"), 'profile = "ghost"\n');
    let r = await run();
    assert.equal(r.status, "no-credentials");
    assert.match(r.logs[0], /没有 \[profiles\.ghost\]/);

    writeFileSync(join(project, ".workflow"), 'profile = "sandbox"\n');
    writeFileSync(join(home, ".config/workflow/config.toml"), 'current_profile = "sandbox"\n\n[profiles.sandbox]\nbase_url = "http://127.0.0.1:1"\n');
    r = await run();
    assert.equal(r.status, "no-credentials");
    assert.match(r.logs[0], /缺 base_url 或 token/);
    assert.deepEqual(calls, []);
  });

  test("环境变量最高优先，且 base 的 /api/v1 后缀只追加一次", () => {
    const creds = resolveCredentials({ env: { WORKFLOW_API_BASE: "https://env.example.test/api/v1", WORKFLOW_TOKEN: "wfp_env" }, cwd: project, home });
    assert.equal(creds.ok, true);
    assert.equal(creds.source, "env");
    assert.equal(creds.host, "env.example.test");
    assert.equal(creds.apiBase, "https://env.example.test/api/v1");
  });

  test("向上查找到含 .git 的目录为止：仓库外层的 .workflow 不算数", () => {
    writeFileSync(join(sandbox, ".workflow"), 'profile = "sandbox"\n');
    rmSync(join(project, ".workflow"));
    const creds = resolveCredentials({ env: env(), cwd: join(project, "sub", "dir"), home });
    assert.equal(creds.ok, false);
    assert.equal(creds.reason, "no-marker");
  });
});

describe("全量路径", () => {
  test("首次无快照：Room 列表 + 逐 Room 需求摘要，cursor 翻到空；写出规格字段", async () => {
    handler = fullHandler;
    const r = await run();
    assert.equal(r.status, "refreshed");
    assert.equal(r.mode, "full");
    assert.deepEqual(r.logs, []);

    const doc = readIndex();
    assert.equal(doc.api, 1);
    assert.equal(doc.host, "127.0.0.1");
    assert.equal(doc.refreshedAt, iso(NOW));
    assert.equal(doc.fullPulledAt, iso(NOW));
    assert.ok(Date.parse(doc.serverTime) > 0, "serverTime 应是 ISO 时间");
    assert.deepEqual(doc.rooms, { "RM-00001": { id: "room-1", name: "Room 1" }, "RM-00002": { id: "room-2", name: "Room 2" } });
    assert.deepEqual(Object.keys(doc.items).sort(), ["R-00001", "R-00002", "R-00003"]);
    assert.deepEqual(doc.items["R-00003"], { type: "requirement", room: "RM-00002", title: "三", status: "s2", updatedAt: "2026-09-10T11:00:00Z" });

    // Room 之间并发，到达顺序不固定：只断言集合与每个请求的形状
    assert.equal(calls[0].path, "/api/v1/rooms");
    assert.equal(calls[0].query.limit, "50");
    const reqCalls = calls.slice(1);
    assert.equal(reqCalls.length, 3);
    assert.ok(reqCalls.every((c) => c.path === "/api/v1/requirements" && c.query.view === "summary" && c.query.limit === "250"));
    assert.deepEqual(
      reqCalls.map((c) => `${c.query.roomId}:${c.query.cursor ?? ""}`).sort(),
      ["room-1:", "room-1:page2", "room-2:"],
    );
    assert.ok(calls.every((c) => c.auth === "Bearer wfp_sandbox00"), "必须带所选 profile 的 token，而非 current_profile 的");
  });

  test("fullPulledAt 超过 24 h：即使有快照也走全量对齐", async () => {
    handler = fullHandler;
    seedIndex({ fullPulledAt: iso(NOW - FULL_INTERVAL_MS - 1000) });
    const r = await run();
    assert.equal(r.mode, "full");
    assert.equal(calls[0].path, "/api/v1/rooms");
    assert.deepEqual(Object.keys(readIndex().items).sort(), ["R-00001", "R-00002", "R-00003"]);
  });
});

describe("增量路径", () => {
  test("按 displayKey 合并取 updatedAt 大者，墓碑删键，水位 = serverTime − 60 s，响应 serverTime 写回", async () => {
    const seeded = seedIndex();
    handler = (url) => {
      if (url.pathname !== "/api/v1/sync/changes") return { status: 500, body: {} };
      const cursor = url.searchParams.get("cursor");
      if (!cursor) {
        return {
          body: {
            serverTime: "2026-09-10T11:59:00.000Z",
            nextCursor: "c2",
            items: [
              { type: "requirement", id: "u1", displayKey: "R-00001", roomId: "room-1", title: "新标题", status: "s9", updatedAt: "2026-09-10T11:30:00Z", deletedAt: null },
              { type: "requirement", id: "u1", displayKey: "R-00001", roomId: "room-1", title: "更旧的", status: "s0", updatedAt: "2026-09-10T09:00:00Z", deletedAt: null },
              { type: "requirement", id: "u2", displayKey: "R-00002", roomId: "room-1", title: "会被删", status: "s0", updatedAt: "2026-09-10T11:40:00Z", deletedAt: "2026-09-10T11:40:00Z" },
            ],
          },
        };
      }
      return {
        body: {
          serverTime: "2026-09-10T11:59:00.000Z",
          nextCursor: "",
          items: [
            { type: "bug", id: "b1", displayKey: "B-00007", roomId: "room-1", title: "新缺陷", status: "open-ish", updatedAt: "2026-09-10T11:50:00Z", deletedAt: null },
          ],
        },
      };
    };

    const r = await run();
    assert.equal(r.status, "refreshed");
    assert.equal(r.mode, "incremental");
    assert.deepEqual(r.logs, []);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].path, "/api/v1/sync/changes");
    assert.equal(calls[0].query.updatedSince, iso(Date.parse(seeded.serverTime) - 60_000));
    assert.equal(calls[0].query.types, "requirement,work_item,bug");
    assert.equal(calls[1].query.cursor, "c2");

    const doc = readIndex();
    assert.equal(doc.serverTime, "2026-09-10T11:59:00.000Z");
    assert.equal(doc.fullPulledAt, seeded.fullPulledAt, "增量不改 fullPulledAt");
    assert.equal(doc.refreshedAt, iso(NOW));
    assert.deepEqual(doc.items["R-00001"], { type: "requirement", room: "RM-00001", title: "新标题", status: "s9", updatedAt: "2026-09-10T11:30:00Z" });
    assert.equal("R-00002" in doc.items, false, "deletedAt 非空必须删键");
    assert.deepEqual(doc.items["B-00007"], { type: "bug", room: "RM-00001", title: "新缺陷", status: "open-ish", updatedAt: "2026-09-10T11:50:00Z" });
  });

  test("变更里出现未知 Room：只重拉一次 Room 列表补映射", async () => {
    seedIndex();
    handler = (url) => {
      if (url.pathname === "/api/v1/rooms") return { body: ROOMS };
      if (url.pathname === "/api/v1/sync/changes") {
        return {
          body: {
            serverTime: "2026-09-10T11:59:00.000Z",
            nextCursor: "",
            items: [
              { type: "requirement", id: "x", displayKey: "R-00010", roomId: "room-2", title: "新室的单", status: "s", updatedAt: "2026-09-10T11:50:00Z" },
              { type: "requirement", id: "y", displayKey: "R-00011", roomId: "room-2", title: "同室第二张", status: "s", updatedAt: "2026-09-10T11:51:00Z" },
            ],
          },
        };
      }
      return { status: 500, body: {} };
    };
    const r = await run();
    assert.equal(r.status, "refreshed");
    assert.deepEqual(calls.map((c) => c.path), ["/api/v1/sync/changes", "/api/v1/rooms"]);
    const doc = readIndex();
    assert.equal(doc.items["R-00010"].room, "RM-00002");
    assert.equal(doc.items["R-00011"].room, "RM-00002");
    assert.deepEqual(doc.rooms["RM-00002"], { id: "room-2", name: "Room 2" });
  });

  test("增量返 410（水位早于墓碑保留期）：静默回退全量", async () => {
    seedIndex();
    handler = (url) => (url.pathname === "/api/v1/sync/changes" ? { status: 410, body: { title: "gone" } } : fullHandler(url));
    const r = await run();
    assert.equal(r.status, "refreshed");
    assert.equal(r.mode, "full");
    assert.deepEqual(r.logs, []);
    assert.deepEqual(calls.map((c) => c.path).slice(0, 2), ["/api/v1/sync/changes", "/api/v1/rooms"]);
    assert.equal(readIndex().fullPulledAt, iso(NOW));
  });

  test("增量返 404（端点未上线）：回退全量并在 stderr 留一行", async () => {
    seedIndex();
    handler = (url) => (url.pathname === "/api/v1/sync/changes" ? { status: 404, body: { title: "not found" } } : fullHandler(url));
    const r = await run();
    assert.equal(r.status, "refreshed");
    assert.equal(r.mode, "full");
    assert.deepEqual(r.logs, ["workflow index：增量端点 /sync/changes 未上线（404），回退全量"]);
  });
});

describe("TTL 与并发", () => {
  test("refreshedAt 在 15 分钟内：不发任何请求；--force 忽略 TTL", async () => {
    handler = fullHandler;
    // fullPulledAt 已过 24 h 但 refreshedAt 很新：TTL 先挡住；--force 越过 TTL 后按 24 h 规则走全量
    seedIndex({ refreshedAt: iso(NOW - TTL_MS + 1000), fullPulledAt: iso(NOW - FULL_INTERVAL_MS - 1000) });
    let r = await run();
    assert.equal(r.status, "fresh");
    assert.deepEqual(calls, []);

    r = await run({ force: true });
    assert.equal(r.status, "refreshed");
    assert.equal(r.mode, "full");
    assert.equal(calls[0].path, "/api/v1/rooms");
  });

  test("上次失败（stale.attemptedAt）也占 TTL：离线时不每次会话空等", async () => {
    handler = fullHandler;
    seedIndex({ stale: { attemptedAt: iso(NOW - 60_000), reason: "网络错误" } });
    const r = await run();
    assert.equal(r.status, "fresh");
    assert.deepEqual(calls, []);
  });

  test("写前重读：磁盘 refreshedAt 已被别的会话更新则放弃，不覆盖", async () => {
    const seeded = seedIndex();
    const otherSession = { ...seeded, refreshedAt: iso(NOW - 1000), items: { "R-09999": { type: "requirement", room: "RM-00001", title: "别的会话写的", status: "s", updatedAt: "2026-09-10T11:58:00Z" } } };
    handler = (url) => {
      if (url.pathname === "/api/v1/sync/changes") {
        writeFileSync(indexPath(), JSON.stringify(otherSession)); // 模拟并发会话在我们拉取期间落盘
        return { body: { serverTime: "2026-09-10T11:59:00.000Z", nextCursor: "", items: [] } };
      }
      return { status: 500, body: {} };
    };
    const r = await run();
    assert.equal(r.status, "abandoned");
    assert.deepEqual(readIndex(), otherSession);
  });
});

describe("离线 / 超时（退出码 0，沿用旧快照）", () => {
  test("端口不通：一行 stderr，有快照则标 stale 且 items 不动", async () => {
    const seeded = seedIndex();
    writeFileSync(join(home, ".config/workflow/config.toml"), '[profiles.sandbox]\nbase_url = "http://127.0.0.1:1"\ntoken = "wfp_sandbox00"\n');
    const r = await run();
    assert.equal(r.status, "stale");
    assert.equal(r.logs.length, 1);
    assert.match(r.logs[0], /^workflow index：离线沿用旧快照（网络错误：/);
    const doc = readIndex();
    assert.deepEqual(doc.items, seeded.items);
    assert.equal(doc.refreshedAt, seeded.refreshedAt);
    assert.equal(doc.stale.attemptedAt, iso(NOW));
    assert.match(doc.stale.reason, /网络错误/);
  });

  test("端口不通且没有快照：一行 stderr「未生成」，不写文件", async () => {
    writeFileSync(join(home, ".config/workflow/config.toml"), '[profiles.sandbox]\nbase_url = "http://127.0.0.1:1"\ntoken = "wfp_sandbox00"\n');
    const r = await run();
    assert.equal(r.status, "stale");
    assert.match(r.logs[0], /^workflow index：未生成（/);
    assert.equal(existsSync(indexPath()), false);
  });

  test("服务器挂起不回：按单请求超时中止，沿用旧快照", async () => {
    const seeded = seedIndex();
    handler = () => "hang";
    const r = await run();
    assert.equal(r.status, "stale");
    assert.match(r.logs[0], /请求超时：\/sync\/changes/);
    assert.deepEqual(readIndex().items, seeded.items);
  });

  test("总预算用尽：翻页到一半也不写半截索引", async () => {
    seedIndex({ fullPulledAt: iso(NOW - FULL_INTERVAL_MS - 1000) });
    let tick = NOW;
    handler = (url) => (url.pathname === "/api/v1/rooms" ? { body: ROOMS } : { body: { items: [], nextCursor: "" } });
    // 每次请求把「现在」推进 1 s；总预算 1.5 s → 第二个请求前预算已尽
    const r = await run({ now: () => (tick += 1000) });
    assert.equal(r.status, "stale");
    assert.match(r.logs[0], /总预算用尽/);
    assert.equal(readIndex().fullPulledAt, iso(NOW - FULL_INTERVAL_MS - 1000), "旧快照原样保留");
  });
});

describe("命令行入口", () => {
  test("断网时退出码 0、stdout 为空（SessionStart 的 stdout 会进上下文）、stderr 恰一行", () => {
    writeFileSync(join(home, ".config/workflow/config.toml"), '[profiles.sandbox]\nbase_url = "http://127.0.0.1:1"\ntoken = "wfp_sandbox00"\n');
    const r = spawnSync(process.execPath, [script, "--force"], { cwd: project, env: env(), encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr.trim().split("\n").length, 1);
    assert.match(r.stderr, /workflow index：未生成/);
    assert.doesNotMatch(r.stderr, /wfp_/, "token 不得出现在任何输出");
  });

  test("真实端到端：全量拉取后文件落在 XDG_CACHE_HOME 下，不在插件根", async () => {
    handler = fullHandler;
    // 打桩服务器跑在本进程里，子进程必须异步等（spawnSync 会把事件循环卡住，服务器答不了）
    const r = await new Promise((resolve) => {
      const child = spawn(process.execPath, [script], { cwd: project, env: env() });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
    assert.ok(existsSync(indexPath()));
    assert.equal(existsSync(join(repoRoot, "workflow")), false);
    assert.deepEqual(Object.keys(readIndex().items).sort(), ["R-00001", "R-00002", "R-00003"]);
  });
});
