// workflow-execute 与共享纪律（搜索/读单/建单规范/编排）的提示词契约。
//
// 存在的理由：拿单执行是多 Agent 编排下最容易走样的旅程——不流转就开工、做完不回写、
// 无凭证时靠全局 profile 兜底把数据写错项目、读半张单就下结论。下面每条断言都对应
// 一个实战里出现过的走样，不是风格检查。

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

const skill = read("skills/workflow-execute/SKILL.md");
const flow = read("skills/workflow-execute/references/execute-flow.md");
const handoff = read("skills/workflow-execute/references/handoff.md");
const searchRef = read("skills/workflow-ops/references/search.md");
const readCard = read("skills/workflow-ops/references/read-card.md");
const cardSpec = read("skills/workflow-ops/references/card-spec.md");
const orchestration = read("skills/workflow-ops/references/orchestration.md");
const opsSkill = read("skills/workflow-ops/SKILL.md");
const callTemplates = read("skills/workflow-ops/references/call-templates.md");

describe("workflow-execute 边界与闸门", () => {
  test("G5 例外范围写死：只覆盖本卡流转与证据回写，禁改描述/验收项/别人的卡", () => {
    // 不写死例外范围，「可以流转」会被扩大解释成「可以顺手落单、顺手验收自己」。
    assert.match(skill, /G5[\s\S]{0,80}授权例外/);
    assert.match(skill, /承接的这张卡自己的状态流转/);
    assert.match(skill, /证据回写/);
    assert.match(skill, /替未承接的卡流转/);
    assert.match(skill, /改单据 description/);
    assert.match(skill, /动验收项状态/);
    assert.match(skill, /验收自己的交付/);
  });

  test("拿单不是落单：发现该建新单时转出，不自建", () => {
    assert.match(skill, /拿单不是落单/);
    assert.match(skill, /不擅自建单/);
  });

  test("description 与 planning/ops/qa 三向分流，避免抢触发", () => {
    const fm = /^---\nname: workflow-execute\ndescription: ([^\n]+)\n---/.exec(skill);
    assert.ok(fm, "frontmatter 缺失或格式不对");
    for (const token of ["workflow-planning", "workflow-ops", "workflow-qa", "拿单", "开工", "回写"]) {
      assert.ok(fm[1].includes(token), `description 缺少「${token}」`);
    }
  });
});

describe("两种执行模式", () => {
  test("模式判定先于一切 API 调用，两种模式都有明确交回物", () => {
    assert.match(skill, /自持凭证直连/);
    assert.match(skill, /无凭证[\s\S]{0,20}调度方代写/);
    assert.match(skill, /不调任何 Workflow API/);
    assert.match(skill, /不要求用户或调度方把 token 贴进会话/);
  });

  test("硬规则：无 .workflow 绑定时禁止全局 current_profile 兜底写数据", () => {
    // 执行 Agent 常被派到临时目录；全局兜底写进去的是「碰巧配过的项目」。
    assert.match(skill, /没有 `\.workflow` 绑定/);
    assert.match(skill, /禁止[\s\S]{0,30}current_profile[\s\S]{0,60}写操作/);
    assert.match(skill, /即使 config 里只有一个 profile/);
  });

  test("无凭证交回报告六段齐全，状态 key 不猜", () => {
    for (const token of ["目标单", "建议流转", "证据评论正文", "附件清单", "交接纪要草稿", "Known gaps"]) {
      assert.ok(handoff.includes(token), `无凭证交回缺少「${token}」`);
    }
    assert.match(handoff, /不猜状态 key/);
  });
});

describe("执行流程纪律", () => {
  test("找单三条路：单号精确定位 / workbench / ownerId·activeUserId 过滤", () => {
    assert.match(flow, /\/search/);
    assert.match(flow, /\/me\/workbench/);
    assert.match(flow, /ownerId=/);
    assert.match(flow, /activeUserId=/);
    // workbench 有截断标志，不能拿一页当全量。
    assert.match(flow, /workItemsTruncated/);
  });

  test("先梳理再开工：决策清单讨论完才流转，且不为走形式空转", () => {
    // 走样两个方向都要堵：跳过讨论直接开工（自作主张），和没有决策点也硬问一轮（空转）。
    assert.match(skill, /梳理需求、拿到决策再动手/);
    assert.match(skill, /全部决策点有答复之前不开工/);
    assert.match(flow, /## 4\. 梳理需求与决策讨论/);
    const clarifyIdx = flow.indexOf("## 4. 梳理需求与决策讨论");
    const startIdx = flow.indexOf("## 5. 开工流转");
    assert.ok(clarifyIdx > 0 && startIdx > clarifyIdx, "梳理讨论必须排在开工流转之前");
    assert.match(flow, /先自查再问/);
    assert.match(flow, /每项给出建议选项/);
    assert.match(flow, /不自作主张替用户拍板/);
    assert.match(flow, /不为走形式空转/);
  });

  test("并行子 Agent 纪律：互斥所有权、共享热点不并行、子 Agent 不碰凭证与回写", () => {
    assert.match(skill, /并行/);
    assert.match(flow, /互斥所有权/);
    assert.match(flow, /共享热点（同一文件、同一接口、同一资源）不并行/);
    assert.match(flow, /子 Agent 不接触 Workflow 凭证、不做任何单据侧动作/);
    // 子 Agent 说完成不算数：主执行者要亲自跑整体验证（G7 的并行版）。
    assert.match(flow, /子 Agent 声称的「完成」不算证据/);
    assert.match(flow, /不硬凑并行/);
  });

  test("旧单未完成时优先消费接口，无法解耦才阻塞", () => {
    assert.match(skill, /接口已存在但上游实现未完成时可以按接口\/stub 并行/);
    assert.match(skill, /readiness=conditional.*blocked/);
    assert.match(skill, /`basis=interface`.*版本化接口\/公共产物可引用/);
    assert.match(skill, /`basis=implementation`.*前置未满足/);
    assert.match(flow, /旧单未完成但本卡已有版本化接口时.*并行/);
    assert.match(flow, /接口引用缺失、版本漂移/);
    assert.match(flow, /`basis=implementation` 且只能等最终实现、理由成立时才阻塞/);
  });

  test("开工必先流转：现查 transitions，被 guard 挡住转述不硬闯", () => {
    assert.match(skill, /不流转就开工/);
    assert.match(flow, /\/transitions/);
    assert.match(flow, /blockedReason/);
    assert.match(flow, /不硬闯/);
    // 待认领态先认领。
    assert.match(flow, /slots\/<slotKey>\/claim/);
  });

  test("回写固定顺序：遗留补单 → 附件 → 证据评论 → 交接纪要 → 流转状态，每步读回", () => {
    assert.match(flow, /先补单、再有证据、再有结论、最后才流转/);
    const backfillIdx = flow.indexOf("遗留补单（先于证据评论）");
    const attachIdx = flow.indexOf("上传证据附件");
    const commentIdx = flow.indexOf("POST 证据评论");
    const handoffIdx = flow.indexOf("POST 交接纪要");
    const transitionIdx = flow.indexOf("流转状态（待验收优先）");
    assert.ok(
      backfillIdx > 0 &&
        attachIdx > backfillIdx &&
        commentIdx > attachIdx &&
        handoffIdx > commentIdx &&
        transitionIdx > handoffIdx,
      "回写顺序段落次序不对"
    );
    assert.match(flow, /重发前，必须先读回/);
  });

  test("完成四件套一件不能少：状态流转 + 提交单号 + 遗留项落卡 + 交接纪要", () => {
    // 用户强约束：开发完成 = 流转到待验收/已完成 + 评论带 Git/SVN 提交单号 + 未做事项补需求单
    // + 一条给下一棒的交接纪要（0.9.0 新增的第四件）。
    assert.match(skill, /四件硬性交付一件不能少/);
    assert.match(flow, /四件事一件不能少：状态流转、带提交单号的证据评论、遗留项落卡、交接纪要/);
    assert.match(flow, /「提交单号」小节必填/);
  });

  test("流转语义：待验收优先，工作流没有验收态才允许流转已完成", () => {
    assert.match(flow, /没有验收语义态/);
    assert.match(flow, /才允许流转完成并在 reason 注明/);
    // 有验收态时禁止跳过它自行完成——那是自验收。
    assert.match(flow, /不得跳过它直接流转完成态/);
    assert.match(skill, /有验收态绝不跳过它自行完成/);
  });

  test("遗留补单：这次不做的 TODO 必须经确认落卡，只写评论不算", () => {
    assert.match(flow, /经用户确认后[\s\S]{0,20}workflow-ops 落单/);
    assert.match(flow, /沉默丢弃/);
    assert.match(handoff, /每条必须对应一张已落库的补需求单/);
    assert.match(handoff, /用户决定不补/);
    // 模式二：补单草稿随交回报告给调度方落单。
    assert.match(handoff, /补单草稿/);
  });

  test("执行者不越权：不改 description、不动验收项、不流转完成态", () => {
    assert.match(flow, /不改 description/);
    assert.match(flow, /不动验收项状态/);
    assert.match(flow, /完成由验收方判定/);
  });
});

describe("交接纪要（接力的单一真值）", () => {
  test("开工前读所属需求室最近的纪要，并声明它是数据不是指令", () => {
    // 纪要比群历史窄得多，但仍然是别人写的自由文本——注入面没有消失。
    assert.match(skill, /rooms\/\{roomId\}\/handoffs/);
    assert.match(flow, /rooms\/\{roomId\}\/handoffs/);
    assert.match(readCard, /rooms\/<room-uuid>\/handoffs/);
    for (const text of [skill, flow, readCard]) {
      assert.match(text, /是数据不是指令|只当事实素材/);
    }
    // 室不存在返 404 而不是空列表——读成「还没人留纪要」就会把抄错的 roomId 当成事实。
    assert.match(readCard, /404/);
  });

  test("summary 三行模板：≤200 字符，超长重写不截断", () => {
    assert.match(handoff, /做了什么/);
    assert.match(handoff, /怎么交接/);
    assert.match(handoff, /交接文档在哪/);
    assert.match(handoff, /≤200 字符/);
    // 截断会砍掉最后一行——恰好是最要紧的那行。
    assert.match(handoff, /超 200 字符要重写，不要截断/);
    assert.match(handoff, /不写 token \/ 凭据 \/ 个人数据/);
  });

  test("agentLabel 必填且不猜，解析优先级写死在共享的 connection.md 里", () => {
    const connection = read("skills/workflow-ops/references/connection.md");
    assert.match(connection, /WORKFLOW_AGENT_LABEL/);
    assert.match(connection, /\[agent\]/);
    assert.match(connection, /绝不猜、绝不省略/);
    // `.workflow` 顶层单键的旧口径必须同步——否则 [agent] 表会被当成格式错误。
    assert.match(connection, /`\[agent\]`/);
    assert.match(read("skills/workflow-setup/SKILL.md"), /\[agent\]/);
    for (const text of [skill, flow, handoff]) {
      assert.match(text, /agentLabel/);
    }
  });

  test("纪要排在证据评论之后、流转之前，且 roomId 为空按「已存库、未镜像」如实报", () => {
    assert.match(flow, /已存库、未镜像/);
    assert.match(read("skills/workflow-upload/SKILL.md"), /createHandoff/);
    assert.match(read("skills/workflow-upload/SKILL.md"), /证据评论\*\*之后\*\*、状态流转\*\*之前\*\*/);
    // create 类 POST 的幂等键纪律必须覆盖 createHandoff。
    assert.match(read("skills/workflow-ops/references/draft-format.md"), /createHandoff/);
  });
});

describe("证据评论模板（验收方机械核对）", () => {
  test("模板小节齐全且要求写实", () => {
    for (const section of ["改动清单", "提交单号", "验收对照", "实际运行的验证", "决策记录", "Known gaps", "边界声明"]) {
      assert.ok(handoff.includes(section), `证据评论模板缺少「${section}」`);
    }
    assert.match(handoff, /没跑的写「未执行」/);
    assert.match(handoff, /分支 \+ 提交号/);
    assert.match(handoff, /没有内容的写「无」/);
    // 提交单号要能覆盖 Git 与 SVN 两种仓库，多仓库逐行列。
    assert.match(handoff, /Git commit hash/);
    assert.match(handoff, /SVN revision/);
    assert.match(handoff, /多仓库逐行列/);
  });
});

describe("共享纪律：搜索先行（search.md）", () => {
  test("三个必搜场景 + 已核实的能力口径", () => {
    assert.match(searchRef, /建单前查重/);
    assert.match(searchRef, /回答历史类问题之前/);
    assert.match(searchRef, /拿单开工之前/);
    // 能力口径与合同一致：正文可搜、cursor 分页、limit 上限 50。
    assert.match(searchRef, /正文可搜/);
    assert.match(searchRef, /nextCursor/);
    assert.match(searchRef, /indexVersion/);
    assert.match(searchRef, /上限 50/);
  });

  test("「不存在证明」不以 search 未命中为唯一依据；命中即真值", () => {
    assert.match(searchRef, /「搜不到」≠「不存在」/);
    assert.match(searchRef, /不得以 search 未命中作为未落库的唯一依据/);
    assert.match(searchRef, /命中即真值/);
    assert.match(searchRef, /view=summary/);
    assert.match(searchRef, /Idempotency-Key/);
  });

  test("旧的「只搜标题」口径已从全部技能里清除", () => {
    // /search 已升级为标题+正文召回；过时声明会让 Agent 放弃可用的查重手段。
    for (const rel of [
      "skills/workflow-ops/SKILL.md",
      "skills/workflow-ops/references/call-templates.md",
      "skills/workflow-planning/references/api-delivery.md",
    ]) {
      const text = read(rel);
      assert.ok(!/只对标题做 ILIKE|只匹配标题|不做全文检索/.test(text), `${rel} 仍残留过时的 search 能力声明`);
    }
  });
});

describe("共享纪律：读单完整性（read-card.md）", () => {
  test("四路缺一不算读过：正文 + 评论 + 附件 + 验收项", () => {
    assert.match(readCard, /缺任何一路都不算「读过这张单」/);
    assert.match(readCard, /\/comments\?targetType=/);
    assert.match(readCard, /\/attachments\?targetType=/);
    assert.match(readCard, /acceptance-items/);
    // 图片附件必须看内容——附件元数据 JSON 不是图片本体。
    assert.match(readCard, /\/content/);
    assert.match(readCard, /不可信数据/);
  });

  test("qa 与 execute 都指回同一份读单口径", () => {
    assert.match(read("skills/workflow-qa/SKILL.md"), /read-card\.md/);
    assert.match(skill, /read-card\.md/);
    assert.match(opsSkill, /read-card\.md/);
  });
});

describe("共享纪律：建单最小正文（card-spec.md）", () => {
  test("裸标题不落库，四节结构固定，验收缺失必须先问", () => {
    assert.match(cardSpec, /裸标题不落库/);
    for (const section of ["## 背景", "## 目标", "## 验收", "## 边界"]) {
      assert.ok(cardSpec.includes(section), `最小正文缺少「${section}」节`);
    }
    assert.match(cardSpec, /先问一句拿验收口径再建单/);
    assert.match(cardSpec, /不替用户发明需求内容/);
  });

  test("ops 建单动词绑定 card-spec 为硬性口径", () => {
    assert.match(opsSkill, /card-spec\.md/);
    assert.match(opsSkill, /裸标题不落库/);
  });
});

describe("共享纪律：Agent 写路径", () => {
  test("六条规则写进 ops / setup / 落单路径", () => {
    const connection = read("skills/workflow-ops/references/connection.md");
    const setup = read("skills/workflow-setup/SKILL.md");
    const delivery = read("skills/workflow-planning/references/api-delivery.md");
    const calls = read("skills/workflow-ops/references/call-templates.md");
    for (const text of [opsSkill, connection, setup, delivery]) {
      assert.match(text, /moduleAccess/);
      assert.match(text, /不看.*permissions|不看 `permissions`/);
    }
    for (const text of [opsSkill, callTemplates, cardSpec, delivery]) {
      assert.match(text, /Idempotency-Key/);
    }
    assert.match(opsSkill, /命中即真值/);
    assert.match(searchRef, /命中即真值/);
    assert.match(callTemplates, /schedule\/snapshot/);
    assert.match(opsSkill, /204/);
    assert.match(opsSkill, /deepLink.*相对路径|相对路径.*deepLink/);
  });

  test("幂等键先落盘，响应读取失败不得当发送失败重发", () => {
    const connection = read("skills/workflow-ops/references/connection.md");
    const draft = read("skills/workflow-ops/references/draft-format.md");
    const gates = read("skills/workflow-ops/references/gates.md");
    assert.match(draft, /idempotencyKey/);
    assert.match(connection, /响应读取失败 \/ 连接中断/);
    assert.match(connection, /写操作默认不重试/);
    assert.match(gates, /本批标题各恰好 1 条且条数 == 预期/);
    assert.match(gates, /只核自称创建的那张不算过闸/);
    assert.doesNotMatch(callTemplates, /Idempotency-Key: \$\(uuidgen\)/);
  });
});

describe("共享纪律：编排元数据与 Room 盘点（orchestration.md）", () => {
  test("编码优先级：真字段 > 标题前缀 > 正文约定", () => {
    assert.match(orchestration, /真字段 > 标题前缀 > 正文约定/);
    // 已核实的真字段过滤维度。
    assert.match(orchestration, /roomId/);
    assert.match(orchestration, /ownerId/);
    assert.match(orchestration, /activeUserId/);
  });

  test("平台无向引用与需求依赖方向分离，不臆造额外关系 API", () => {
    assert.match(orchestration, /需求级有向依赖关系没有独立 API/);
    assert.match(orchestration, /bindRequirementReference/);
    assert.match(orchestration, /source[\\/]target/);
    assert.match(orchestration, /平台需求建议/);
    // module 列表不可过滤——不许臆造查询参数。
    assert.match(orchestration, /不要臆造 module 查询参数/);
  });

  test("Room 盘点：overview 总账 + 三路明细 + cursor 翻到空为止", () => {
    assert.match(orchestration, /\/rooms\/<uuid>\/overview/);
    assert.match(orchestration, /acceptance-items/);
    assert.match(orchestration, /includeTransitions=true/);
    assert.match(orchestration, /nextCursor/);
  });
});

describe("ops 扩充：重开与层级", () => {
  test("重开路径完整：现查逆向边 + reason 写波及来源 + 评论关联来源单", () => {
    assert.match(opsSkill, /重开 \/ 变更波及/);
    assert.match(opsSkill, /波及来源/);
    assert.match(callTemplates, /变更波及/);
    assert.match(callTemplates, /变更重开/);
    // 被 guard 挡住时转述，不 PATCH status 绕道。
    assert.match(opsSkill, /不硬闯、不 PATCH status 绕道/);
  });

  test("对象层级含里程碑与 Room，里程碑状态派生不手改", () => {
    assert.match(opsSkill, /里程碑/);
    assert.match(opsSkill, /自动派生/);
    assert.match(callTemplates, /schedule\/milestones/);
    assert.match(callTemplates, /schedule\/requirements\/<uuid>\/milestone/);
  });
});

describe("上下文预算", () => {
  test("execute 主线（SKILL + 流程 + 交回 + 读单 + 搜索）不超过 37KB", () => {
    // 0.5.0 新增三块硬纪律（开工前梳理讨论、并行子 Agent、完成三件套）后上调到 32KB；
    // 0.9.0 加入第四件硬性交付（交接纪要：写模板 + 读单第六路 + agentLabel 纪律）后
    // 上调到 37KB——加之前先按「逼近上限先删冗余」压过一轮，重复口径改成指针。
    // 预算本身保留：它防的是无意识膨胀，不是禁止有意识的新纪律。
    const total = [skill, flow, handoff, readCard, searchRef].reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0);
    assert.ok(total < 37000, `执行主线上下文 ${total} 字节，超出 37KB 预算`);
  });
});
