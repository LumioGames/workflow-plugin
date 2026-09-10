// inject-rules（SessionStart 注入）的行为测试。
//
// 存在的理由：注入脚本是「规则每次会话在场」的唯一通道，它漏读一个文件、把索引正文整段
// 塞进上下文、或者读不到 settings.json 就崩，都会静默地把整套规则打回原形。全部用临时
// HOME / XDG_CACHE_HOME / 插件根打桩，不碰真实用户目录。

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAdditionalContext,
  buildIndexLine,
  buildRulesContext,
  detectLegacyPlugin,
} from "../tools/inject-rules.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "tools/inject-rules.mjs");

const HOST = "sandbox.example.test";
let sandbox;
let pluginRoot;
let home;
let cacheHome;
let project;

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function writeIndex(doc) {
  writeJson(join(cacheHome, "workflow/index", `${HOST}.json`), doc);
}

function baseEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CACHE_HOME: cacheHome,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    ...extra,
  };
}

function runScript({ cwd = project, env = baseEnv() } = {}) {
  const stdout = execFileSync(process.execPath, [script], { cwd, env, encoding: "utf8" });
  return JSON.parse(stdout);
}

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "inject-rules-"));
  pluginRoot = join(sandbox, "plugin");
  home = join(sandbox, "home");
  cacheHome = join(sandbox, "cache");
  project = join(sandbox, "project");

  mkdirSync(join(pluginRoot, "rules"), { recursive: true });
  writeFileSync(join(pluginRoot, "rules/system.md"), "# System Rules\n\n- 子 Agent 不得再派生子 Agent。\n");
  writeFileSync(join(pluginRoot, "rules/dispatch.md"), "# Dispatch Rules\n\n- 状态不是枚举。\n");
  writeFileSync(join(pluginRoot, "rules/README.md"), "# 这是 README，不注入\n");
  writeFileSync(join(pluginRoot, "rules/.fingerprint.json"), "{\"lines\":[]}\n");

  mkdirSync(join(home, ".config/workflow"), { recursive: true });
  writeFileSync(
    join(home, ".config/workflow/config.toml"),
    `current_profile = "other"\n\n[profiles.other]\nbase_url = "https://other.example.test"\ntoken = "wfp_other0000"\n\n[profiles.sandbox]\nbase_url = "https://${HOST}"\ntoken = "wfp_sandbox00"\n`,
  );

  mkdirSync(join(project, ".git"), { recursive: true });
  writeFileSync(join(project, ".workflow"), 'profile = "sandbox"\n');
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("规则文件遍历", () => {
  test("注入 rules/*.md，排除 README.md 与点开头文件，顺序按文件名稳定", () => {
    const text = buildRulesContext(pluginRoot);
    assert.match(text, /# Dispatch Rules/);
    assert.match(text, /# System Rules/);
    assert.ok(text.indexOf("# Dispatch Rules") < text.indexOf("# System Rules"), "dispatch 应排在 system 前（字典序）");
    assert.doesNotMatch(text, /这是 README/);
    assert.doesNotMatch(text, /fingerprint/);
  });

  test("rules/ 不存在时返回空串，不抛", () => {
    assert.equal(buildRulesContext(join(sandbox, "nope")), "");
  });
});

describe("索引一行", () => {
  test("有索引文件：报路径、总数、各 Room 计数、多久前刷新，且不带正文", () => {
    const now = Date.parse("2026-09-10T10:00:00Z");
    writeIndex({
      api: 1,
      host: HOST,
      serverTime: "2026-09-10T09:50:00Z",
      fullPulledAt: "2026-09-10T09:50:00Z",
      refreshedAt: "2026-09-10T09:53:00Z",
      rooms: { "RM-00001": { id: "r1", name: "A" }, "RM-00002": { id: "r2", name: "B" } },
      items: {
        "R-00001": { type: "requirement", room: "RM-00001", title: "标题一", status: "x", updatedAt: "2026-09-01T00:00:00Z" },
        "R-00002": { type: "requirement", room: "RM-00001", title: "标题二", status: "x", updatedAt: "2026-09-01T00:00:00Z" },
        "B-00001": { type: "bug", room: "RM-00002", title: "标题三", status: "x", updatedAt: "2026-09-01T00:00:00Z" },
      },
    });
    const line = buildIndexLine({ env: baseEnv(), cwd: project, home, now: () => now });
    assert.match(line, new RegExp(`线上单据索引在 .*workflow/index/${HOST.replace(/\./g, "\\.")}\\.json：3 张（RM-00001 2 / RM-00002 1），7 分钟前刷新`));
    assert.match(line, /只用来找单号和 Room，状态以线上为准/);
    assert.doesNotMatch(line, /标题一/, "索引正文不得注入");
    assert.doesNotMatch(line, /离线沿用/);
  });

  test("索引带 stale 标记：追加「离线沿用」与原因", () => {
    const now = Date.parse("2026-09-10T10:00:00Z");
    writeIndex({
      api: 1,
      host: HOST,
      serverTime: "2026-09-10T09:50:00Z",
      fullPulledAt: "2026-09-10T09:50:00Z",
      refreshedAt: "2026-09-10T09:50:00Z",
      rooms: {},
      items: {},
      stale: { attemptedAt: "2026-09-10T09:58:00Z", reason: "网络错误：fetch failed" },
    });
    const line = buildIndexLine({ env: baseEnv(), cwd: project, home, now: () => now });
    assert.match(line, /0 张（空）/);
    assert.match(line, /离线沿用：最近一次刷新（2 分钟前）失败——网络错误：fetch failed/);
  });

  test("没有 .workflow：说「未生成」与原因，不读任何索引", () => {
    const bare = join(sandbox, "bare");
    mkdirSync(join(bare, ".git"), { recursive: true });
    const line = buildIndexLine({ env: baseEnv(), cwd: bare, home });
    assert.equal(line, "线上单据索引未生成（当前目录没有 .workflow 标记）。");
  });

  test("有 .workflow 但索引文件不存在：提示可用 /workflow:index", () => {
    rmSync(join(cacheHome, "workflow"), { recursive: true, force: true });
    const line = buildIndexLine({ env: baseEnv(), cwd: project, home });
    assert.match(line, /^线上单据索引未生成（尚未刷新或刷新失败；\/workflow:index 可手动刷新）。$/);
  });
});

describe("lumioagentspec 共存警告", () => {
  test("settings.json 的 enabledPlugins 里 lumio@lumioagentspec 为 true → 警告", () => {
    const h = join(sandbox, "home-enabled");
    writeJson(join(h, ".claude/settings.json"), { enabledPlugins: { "lumio@lumioagentspec": true, "workflow@workflow-plugin": true } });
    assert.equal(detectLegacyPlugin({ home: h }), true);
  });

  test("enabledPlugins 里为 false 但 installed_plugins.json 仍有 lumioagentspec → 警告", () => {
    const h = join(sandbox, "home-installed");
    writeJson(join(h, ".claude/settings.json"), { enabledPlugins: { "lumio@lumioagentspec": false } });
    writeJson(join(h, ".claude/plugins/installed_plugins.json"), { version: 2, plugins: { "lumio@lumioagentspec": [{ scope: "user" }] } });
    assert.equal(detectLegacyPlugin({ home: h }), true);
  });

  test("两个文件都没有 lumioagentspec → 不警告；文件缺失或损坏 → 静默不警告", () => {
    const clean = join(sandbox, "home-clean");
    writeJson(join(clean, ".claude/settings.json"), { enabledPlugins: { "workflow@workflow-plugin": true } });
    writeJson(join(clean, ".claude/plugins/installed_plugins.json"), { version: 2, plugins: { "workflow@workflow-plugin": [] } });
    assert.equal(detectLegacyPlugin({ home: clean }), false);

    const broken = join(sandbox, "home-broken");
    mkdirSync(join(broken, ".claude"), { recursive: true });
    writeFileSync(join(broken, ".claude/settings.json"), "{ not json");
    assert.equal(detectLegacyPlugin({ home: broken }), false);
    assert.equal(detectLegacyPlugin({ home: join(sandbox, "home-missing") }), false);
  });
});

describe("脚本端到端（作为 SessionStart hook 运行）", () => {
  test("stdout 是 hookSpecificOutput JSON：含两份规则、索引一行、共存警告", () => {
    writeIndex({
      api: 1,
      host: HOST,
      serverTime: "2026-09-10T09:50:00Z",
      fullPulledAt: "2026-09-10T09:50:00Z",
      refreshedAt: new Date().toISOString(),
      rooms: { "RM-00001": { id: "r1", name: "A" } },
      items: { "R-00001": { type: "requirement", room: "RM-00001", title: "标题一", status: "x", updatedAt: "2026-09-01T00:00:00Z" } },
    });
    writeJson(join(home, ".claude/settings.json"), { enabledPlugins: { "lumio@lumioagentspec": true } });

    const out = runScript();
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.ok(ctx.startsWith("<workflow-rules>\n以下是 Workflow 插件的常驻规则，每次会话强制在场；插件根目录 "), ctx.slice(0, 120));
    assert.ok(ctx.trimEnd().endsWith("</workflow-rules>"));
    assert.match(ctx, /# System Rules/);
    assert.match(ctx, /# Dispatch Rules/);
    assert.match(ctx, /线上单据索引在 .*：1 张（RM-00001 1），0 分钟前刷新/);
    assert.match(ctx, /⚠ 检测到 lumioagentspec 插件仍启用：其功能已并入 workflow 1\.0\.0，请卸载或禁用，否则两套规则同时在场/);
    assert.doesNotMatch(ctx, /标题一/);
    assert.doesNotMatch(ctx, /wfp_/, "token 不得出现在注入内容里");
  });

  test("没装旧插件时不出警告；buildAdditionalContext 与脚本输出一致", () => {
    writeJson(join(home, ".claude/settings.json"), { enabledPlugins: { "workflow@workflow-plugin": true } });
    const out = runScript();
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.doesNotMatch(ctx, /lumioagentspec/);
    const direct = buildAdditionalContext({ pluginRoot, env: baseEnv(), cwd: project, home });
    assert.equal(direct, ctx);
  });
});
