# reviewer 触发提示词模板

全部合入后触发一次 `agents/reviewer.md`。材料先落成文件（diff 文件、brief、report），prompt 里只给路径；reviewer 没有 Bash，读不到 git，所以 diff 必须由主 loop 生成。

## 生成 diff 文件

```bash
BASE=<派遣前记下的基线提交>
OUT=<workspace>/review-$(git rev-parse --short "$BASE")..$(git rev-parse --short HEAD).diff
{
  echo "## commits"; git log --oneline "$BASE..HEAD"
  echo; echo "## stat"; git diff --stat "$BASE..HEAD"
  echo; echo "## diff"; git diff -U10 "$BASE..HEAD"
} > "$OUT"
```

每次再审用新的范围生成新文件，不复用旧文件。

## 派遣

```text
Subagent: reviewer
  description: "审查 <单号列表> 合入后的完整 diff"
  prompt: |
    【审查级别】快审（默认）/ 深审 + 一句理由：<…>

    【材料】
    - 单号与单正文：<单号> → <BRIEF_FILE>（多张单逐行列）
    - 完整 diff：<DIFF_FILE>（含提交列表、stat、带上下文的 diff；基线 <sha> → HEAD <sha>）
    - 交回物：<单号> → <REPORT_FILE>（逐行列）
    - 项目规范入口：项目文档根 `.spec` 下 `knowledge/README.md`（按需下钻）

    【范围外】<仍在途的并行文件集>——diff 中出现一律不审。

    【worker 报告里的观察与 P2 级顾虑】<主 loop 从各 report 汇总的清单，或「无」>

    【全局约束】<从单正文 / 设计文档逐字抄来的硬性要求：确切数值、格式、组件间关系；
    不写流程规则——那些在 reviewer 自己的正文里>

    按 agents/reviewer.md 审：只读 diff 文件与被改文件，不跑命令，不改任何东西，
    不流转、不建单。输出审查报告（结论 / findings 按 P0–P2 附 文件:行号 / 证据核验结果 /
    方案疑虑）。材料不齐就报「材料不齐」并列出缺什么。
```

## 派审纪律

- **不预判 findings**：prompt 里不写「不要报 X」「不把 X 当缺陷」「最多 P2」「单上就是这么要求的」——出现这些句子就停下，你在替 reviewer 定结论。
- **不让它复跑测试**：worker 的 report 已带验证输出；深审也只是把 report 里贴的输出与 diff 对照推演，不是重跑。
- **findings 与单正文冲突时是用户的决定**：把 finding 和单上原文一起摆给用户问哪个算数；不因为「单上要求的」就丢弃 finding，也不在没问之前派一个与单矛盾的修复。
- **有 P0 / P1 → 一个 fix worker 带完整清单**（派遣照 implementer-prompt.md，brief 换成 findings 清单 + 原单号），合入后用新范围再生成 diff 文件、再审一次。
- **写回由主 loop 做**：P0 / P1 起 bug 单、P2 与证据核验写评论，经 workflow-ops / workflow-upload 读回；reviewer 报告里若出现「我已流转 / 我已建单」= 越权，不采信。
