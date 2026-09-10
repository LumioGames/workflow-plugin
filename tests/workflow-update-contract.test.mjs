// workflow-update 的提示词契约。
//
// 存在的理由：这个技能的失败模式不是「答得不好」，而是**拿错渠道的版本号判自己**。
// 插件有两条分发渠道，版本真值不是同一个：宿主托管（Claude Code marketplace）看公开仓的
// plugin.json，手动安装（Codex / 官网脚本）看官网 version.json。两条渠道的发布节奏可以脱节，
// 2026-08-29 实测官网 version.json 停在 0.3.0 而 marketplace 已发 0.6.0——此时若让宿主托管
// 安装去读 version.json，会得出「线上 0.3.0 < 本地 0.5.0，无需更新」的反向结论，用户永远升不上去。
//
// 因此本文件锁死一条结构性纪律：**先判安装形态，再查版本**；且宿主托管分支明确不读 version.json。
// 次序断言（分流段落必须出现在 version.json 之前）是这里的核心，不是风格检查。

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

const skill = read("skills/workflow-update/SKILL.md");
const command = read("commands/update.md");

describe("分流先于查版本", () => {
  test("安装形态分流段落出现在抓取 version.json 之前", () => {
    // 量的是**抓取动作**（version.json?cb=）而不是任何一次提及：开篇点名两条渠道的版本真值
    // 恰恰是这次修复的重点，不该被自己的测试判违规。真正的红线是「先分流，后抓」。
    const routing = skill.search(/##\s*1\.\s*判断安装形态/);
    const probe = skill.indexOf("version.json?cb=");
    assert.ok(routing !== -1, "SKILL.md 缺少「## 1. 判断安装形态」——分流必须是第一节");
    assert.ok(probe !== -1, "SKILL.md 不再抓 version.json?cb=？手动安装渠道的探针不能删");
    assert.ok(
      routing < probe,
      `分流段落（${routing}）必须出现在抓取 version.json（${probe}）之前，否则宿主托管安装会先被官网渠道的版本号误导`,
    );
  });

  test("开篇即声明两条渠道版本真值不同", () => {
    const opening = skill.slice(0, skill.search(/##\s*1\./));
    assert.match(opening, /先判安装形态/, "开篇必须先立「先判形态」的规矩");
    assert.match(opening, /版本真值/, "开篇必须点明两条渠道的版本真值不同");
  });

  test("源码态最先判,且排在 A / B 之前", () => {
    // 插件仓库自己的工作副本:技能目录向上两级就是仓库根,那里有 plugin.json 与
    // .claude-plugin/plugin.json。不先判源码态的话,开发者会被指去跑宿主的 update 命令。
    const routing = skill.slice(skill.search(/##\s*1\./), skill.search(/##\s*2\./));
    assert.match(routing, /先命中先算/, "三条判定必须声明先后,不能并列");
    const source = routing.search(/\*\*0\.\s*源码态\*\*/);
    const hosted = routing.search(/\*\*A\.\s*宿主托管安装\*\*/);
    const manual = routing.search(/\*\*B\.\s*手动安装\*\*/);
    assert.ok(source !== -1, "缺少源码态判定");
    assert.ok(source < hosted && hosted < manual, "顺序必须是 源码态 → 宿主托管 → 手动安装");
    assert.match(routing, /\.git|tests\//, "源码态要给出可判定的特征");
  });

  test("手动安装的路径特征优先于宿主托管的清单特征", () => {
    // 项目里恰好放一份 plugin.json,不该把 ~/.codex/skills 下的手动安装改判成宿主托管。
    const routing = skill.slice(skill.search(/##\s*1\./), skill.search(/##\s*2\./));
    assert.match(routing, /B 的路径特征优先于 A 的清单特征/);
    assert.match(routing, /不在 B 列出的手动安装目录里/, "A 的清单特征必须显式让位给 B");
  });

  test("两个分支都给出可判定的路径特征", () => {
    assert.match(skill, /~\/\.claude\/plugins\/cache/, "宿主托管的判定特征丢了");
    assert.match(skill, /\.claude-plugin\/plugin\.json/, "插件清单判定特征丢了");
    assert.match(skill, /~\/\.codex\/skills/, "手动安装的判定特征丢了");
  });
});

describe("宿主托管分支", () => {
  const hosted = skill.slice(skill.search(/##\s*2\./), skill.search(/##\s*3\./));

  test("明确不读 version.json，并说明为什么", () => {
    assert.match(hosted, /不读\s*`?version\.json`?/, "必须显式写「不读 version.json」");
    assert.match(hosted, /滞后/, "必须说明官网清单可能滞后于 marketplace 发布，否则下次还会有人接回去");
  });

  test("版本真值指向 marketplace 清单而非官网探针", () => {
    assert.match(hosted, /marketplace/i);
    assert.match(hosted, /plugin\.json/);
  });

  test("给出宿主自己的更新机制与重启提醒", () => {
    assert.match(hosted, /claude plugin marketplace update/, "缺少刷新 marketplace 的命令");
    assert.match(hosted, /claude plugin update/, "缺少更新插件的命令");
    assert.match(hosted, /重启/, "宿主更新后需重启才生效，不写用户会以为没升级成功");
  });

  test("不自改宿主管理的插件目录", () => {
    assert.match(hosted, /不自改插件目录/);
  });
});

describe("手动安装分支", () => {
  const manual = skill.slice(skill.search(/##\s*3\./), skill.search(/##\s*4\./));

  test("读本地 VERSION，源码态直接结束", () => {
    assert.match(manual, /`VERSION`/);
    assert.match(manual, /源码态/);
  });

  test("查线上版本必须带 cb 参数绕缓存", () => {
    assert.match(manual, /version\.json\?cb=/);
    assert.match(manual, /必须带\s*`?cb`?\s*参数/);
  });

  test("语义化逐段比较，三个分支齐全", () => {
    assert.match(manual, /语义化版本逐段比大小/);
    assert.match(manual, /线上\s*\*\*==\*\*\s*本地/);
    assert.match(manual, /线上\s*\*\*<\*\*\s*本地/);
    assert.match(manual, /线上\s*\*\*>\*\*\s*本地/);
  });

  test("线上更旧时绝不更新——降级红线仍在", () => {
    assert.match(manual, /绝不("|「|")?更新/, "「线上 < 本地 绝不更新」这条降级红线不得删除");
    assert.match(manual, /降级不是升级/);
  });
});

describe("安全边界不得放宽", () => {
  const safety = skill.slice(skill.search(/##\s*安全边界/));

  test("只从 workflow.games 域下载", () => {
    assert.match(safety, /只从\s*`?workflow\.games`?\s*域下载/);
  });

  test("技能包只允许 Markdown 与 VERSION，遇可执行文件中止", () => {
    assert.match(safety, /`\.md`\s*与\s*`VERSION`/);
    assert.match(safety, /立即中止并告警/);
  });

  test("不触碰凭证文件", () => {
    assert.match(safety, /config\.toml/);
    assert.match(safety, /绝不触碰/);
  });

  test("宿主托管形态不下载任何文件", () => {
    assert.match(safety, /不下载任何文件/, "宿主托管只调宿主命令，这条边界要写明");
  });
});

describe("命令入口与技能同口径", () => {
  test("update 命令描述的次序是「先分流、后查版本」", () => {
    const routing = command.search(/分流|安装形态/);
    const probe = command.indexOf("version.json");
    assert.ok(routing !== -1, "commands/update.md 必须提到分流");
    if (probe !== -1) {
      assert.ok(
        routing < probe,
        "commands/update.md 里分流必须写在 version.json 之前——命令与技能次序不一致会让 Agent 按旧序执行",
      );
    }
  });
});
