# 单卡建单规范（最小正文）

**本文件是 ops 建需求 / 建任务的硬性口径，单一权威只在此处定义。** bug 的字段与正文口径见 [bug-fields.md](bug-fields.md)，本文件不重复。多卡、多专业、要生成完整 Agent 执行提示词的落单走 workflow-planning 的 12 节模板——两者分工：**ops 单卡 = 最小正文，planning 蓝图卡 = 完整执行提示词**，不混用。

## 一、裸标题不落库

只有 `title`、没有正文结构的单**不允许创建**。用户只丢来一句话时：

- 能从用户输入与当前上下文提炼出下面四节 → 提炼后随写入确认一并展示（G2 的确认里含正文，不是只报标题）。
- 提炼不出「验收」（不知道怎样算做完）→ **先问一句拿验收口径再建单**。这是唯一必须补齐的缺口；其余节确实没有信息时写「待补：<缺什么>」，不编造。
- 四节只装用户给过的事实与可查证的上下文，**不替用户发明需求内容**（与 bug-fields 的「用户没给的字段就是没给」同一纪律）。

## 二、需求 / 任务最小正文（四节）

`description` 至少四节，节标题固定：

```markdown
## 背景
为什么现在要做；来源（用户原话要点 / 上游单号 displayKey）。

## 目标
完成后可观察的结果，一两句。

## 验收
- 逐条可客观证明的条件，至少 1 条。

## 边界
明确不做什么；已知前置或依赖（引用 displayKey）；没有写「无」。
```

```bash
curl -sS -X POST "$WORKFLOW_API_BASE/requirements" \
  -H "Authorization: Bearer $WORKFLOW_TOKEN" \
  -H "content-type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data '{
    "title":"战斗结算面板",
    "description":"## 背景\n…\n\n## 目标\n…\n\n## 验收\n- …\n\n## 边界\n…",
    "reason":"按用户指令建单"
  }' | jq '{id, displayKey}'
```

建单类 POST 一律带 `Idempotency-Key`（`$IDEMPOTENCY_KEY` 取自 manifest，发出前落盘；禁止现场 `$(uuidgen)`）。响应只取 `id` / `displayKey`，不依赖回显的 `description`。

## 三、验收项落结构化（条件触发）

验收口径明确时，把「验收」节逐条同步创建为原生 acceptance-item（`POST /requirements/<uuid>/acceptance-items`）：先 `GET /projects/{projectId}/acceptance/types` 选 active 类型与 `systemSemantic=not_started` 的 active 初始状态（`statusId` 必填），`sourceKind=ai`、`sourceRef` 写来源（用户指令或上游单号）。类型查不到、不唯一或权限不足 → 验收留在正文并在交付时说明（G6），不猜一个 id 填进去。

## 四、字段口径

- `title`：写用户能识别的现象或成果，不写内部实现猜测。
- **不传 `status`**——后端按绑定工作流落初始态（与 bug 同一纪律）。
- `priority` / `risk` / `ownerId`：用户说了才填（后端缺省 P1 / medium / 创建人）；成员名 → UUID 按合同现查成员端点，解析不到就留空并说明。
- `roomId` / 里程碑：用户点名才归属。里程碑归属是建单读回后的第二步：`PUT /schedule/requirements/<uuid>/milestone`（`reason` 必填；预检 `membership.moduleAccess.milestones ≥ manage`；`204` 即成功，核对读 `GET /schedule/snapshot` 的 `milestones[].requirementIds`）。
- `module` / `category`：先看项目既有取值（列表或同室单据里现查）对齐惯例；没有惯例就留空，**不发明新词表**。

## 五、建单前查重

按 [search.md](search.md) 第一节执行；命中疑似重复先报用户，确认后改为在旧单上补评论/附件。
