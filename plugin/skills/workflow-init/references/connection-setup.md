# 接入 Workflow 并验证连接

本文件是 **workflow-init 阶段 2** 的正文。阶段 1（`init-scaffold`）不写 token、不写 `.workflow`；凭据与项目绑定只在这里处理。

## 完成判据（先看这个）

`GET $WORKFLOW_API_BASE/me` 返回 200，且 `GET $WORKFLOW_API_BASE/projects/current` 返回 200；从前者读用户，从后者读 `project` 与 `membership`，再向用户报告：**「以 <用户名> 连接到项目 <项目>，角色 <角色>」**。没走到这一步，接入就不算完成——中间任何分支做完都要回到这条验证。

这只证明身份、项目和角色连接正确。预检可写性看 `membership.moduleAccess`（PAT 已按 token scope 求交），**不看** `permissions`。`read_only` 六模块全是 `read`；`scopeMode=all` 与角色相同。不要为了测试 scope 创建或修改业务对象，真正写操作若返回 403 再按权限分诊。

## Step 0 — 静默探测（每次都先做，不问用户）

按 [workflow-ops/references/connection.md](../../workflow-ops/references/connection.md) 的**凭证解析顺序（三级）**取 `base_url` 与 token——三级规则、API 根地址规范化和可抄的 shell 片段都在那份共享文件里，本阶段不另写一份。

取到凭证 → 依次探测 `GET $WORKFLOW_API_BASE/me` 与 `GET $WORKFLOW_API_BASE/projects/current`。两者通过且项目与 profile 一致 → 直接按完成判据报告，结束本阶段。探测失败或全局 config 不存在 → 按下面分支走。

curl 携带 token 一律走环境变量，不把明文拼进命令行：

```bash
curl -sS -H "Authorization: Bearer $WORKFLOW_TOKEN" "$WORKFLOW_API_BASE/me"
curl -sS -H "Authorization: Bearer $WORKFLOW_TOKEN" "$WORKFLOW_API_BASE/projects/current"
```

## 项目绑定与多项目（`.workflow` 标记）

一台机器接多个项目时，插件全局只装一份、`config.toml` 每项目一节 profile，项目目录用 `.workflow` 标记文件声明「这个目录绑哪个 profile」：

- **位置**：项目仓库根（或当前工作目录）。查找规则：从当前目录向上逐级找，取最近的一个，到含 `.git` 的目录或文件系统根为止。
- **内容**：一行 TOML——`profile = "<profile 名>"`（双引号）；允许**整行** `#` 注释（不支持行内注释，会导致解析落空）。**顶层仅此一键**；另可有两个可选表：`[qa]` 供 workflow-qa 读取受测线上地址与凭据的**环境变量名**，`[agent]` 声明这个仓库的 Agent 标签（都见下）。整个文件**不含 token 也不含任何凭据**，可提交进版本库与全队共享（每人的 token 仍在各自全局 config 里）。
- **写入时机**：接入完成项目绑定时问用户「要不要把绑定写进当前项目（`.workflow` 文件）」，默认写。
- **解析落空 = 停止，不回落**：`.workflow` 存在但读不出 profile 名（写了行内注释、用了单引号、键名拼错）时，**必须停下让用户修**，绝不悄悄改用全局 `current_profile`——那正好会把数据写进另一个项目，是这套绑定机制要防的唯一一件事。

可选的 `[qa]` 表（只有用 workflow-qa 做线上验收时才需要，接入阶段不主动追问）：

```toml
profile = "<profile 名>"

[qa]
base_url = "https://<受测线上站点>"
entry_path = "/<登录或入口路径>"
username_env = "<用户名环境变量名>"
password_env = "<密码环境变量名>"
surfaces = ["web"]
```

**只写环境变量名，绝不写用户名或密码本身**——这个文件是要提交进版本库的。字段口径以 workflow-qa 的 `references/qa-environment.md` 为准。

可选的 `[agent]` 表（多个仓库的 Agent 往同一个 Workflow 项目里做单时建议配）：

```toml
profile = "<profile 名>"

[agent]
label = "client"
```

`label` 就是交接纪要 `POST /handoffs` 的 `agentLabel`，标明**是哪个仓库的 Agent** 写的（`client` / `server` / `game` 之类的小写 slug，同一仓库内保持稳定）。它是展示用的来源标签，**不参与鉴权、不构成身份**，也不是凭据——正因如此才适合随文件提交给全队。解析优先级 env `WORKFLOW_AGENT_LABEL` → `[agent].label` → 都没有就在用到时问用户一次（口径见 [workflow-ops/references/connection.md](../../workflow-ops/references/connection.md) 第一节）。写 `.workflow` 时顺带问一句要不要写死这个标签，用户说不用就不写。

`.workflow` 是独立文件，**绝不合并进 `config.toml`**——`config.toml` 的格式合同一个键都不能加（见分支 C 的写盘规则），`[qa]` 与 `[agent]` 只属于 `.workflow`。

## 权限模式策略

读取 [workflow-ops/references/permission-modes.md](../../workflow-ops/references/permission-modes.md)。
权限不写入凭证文件：用户级策略在 `~/.config/workflow/policy.toml`，项目级降权覆盖在
`.workflow-policy`。缺失时默认 `auto`；未知模式或策略解析失败时停止所有线上写入。向用户报告
当前 profile、项目覆盖和最终生效模式；`full` 只能由用户级 profile 显式开启，项目文件不得升权。
策略模式不等于 PAT scope，不以探测性 POST 验证权限。项目级 `.workflow-policy` 只能降权；本地
`.workflow-drafts/` 是待上传 outbox，接入与 token 配置流程不得覆盖、清理或上传其中内容。

## 分支 A — 用户还没有账号

输出下面这份浏览器 checklist，并明说：**「这三步需要你在浏览器完成，做完回来告诉我」**。等待期间不轮询、不重复催。

1. 打开 https://workflow.games 注册（邮箱 + 验证码）。
2. 首次引导里：建组织 → 建项目 → 选**子域前缀**。提醒用户记下前缀——它就是 API 域名（`https://<前缀>.workflow.games`）。
3. 打开 `https://<前缀>.workflow.games/settings/integrations/tokens` 创建 API token。

## 分支 B — 有账号，还没有 token

给出建 token 页地址：`https://<子域前缀>.workflow.games/settings/integrations/tokens`。

**scopeMode 怎么选**（只有两档）：Agent 要做写操作（建需求、记 bug、流转）选 `all`；只做只读查询报表选 `read_only`。

三个必须提醒：

- **plainToken 只在创建时显示一次**，之后任何页面只能看到前缀。让用户创建后立刻复制。
- **建 token 需要项目管理权限。** 用户页面上没有这个入口时，给一段可直接转发给项目管理员的申请话术，例如：「我需要在项目 <项目名> 里创建一个 API token 给 AI Agent 使用（scopeMode 按用途选 all 或 read_only），请帮我在 设置 → 集成 → API Token 页创建，或给我项目管理权限。」
- **token 绑定「本人 × 单个项目」**：有效权限 = token scope ∩ 本人此刻在该项目的角色权限；换项目要在那个项目的设置页另建 token。

**token 的硬边界**（提前知道，省得撞 401/403 时误诊）：

- **PAT 不能管理 PAT**：token 的创建/列表/吊销只认浏览器会话，拿 token 调这些端点必 401。
- **`/admin` 与 `/orgs` 一律拒 PAT**：平台运营面和组织面是会话专属，token 再大权限也进不去。
- **跨项目聚合端点对 PAT 收敛到 token 所属项目**：比如查「我的项目」只会看到这枚 token 绑的那一个。

## 分支 C — 拿到 token，写配置

**不要请用户把 token 粘贴到会话里。** 常驻规则写死了「密钥 / 凭据不得入库、不得进 prompt、不得进日志」，「事后吊销」不能替代「一开始就不进来」——粘贴那一刻它已经在会话记录、在上游日志里了。

把下面这条命令给用户，**由用户在自己终端执行**（token 不经过会话）：

```bash
umask 177 && mkdir -p ~/.config/workflow && cat > ~/.config/workflow/config.toml <<'EOF'
current_profile = "<子域前缀>"

[profiles.<子域前缀>]
base_url = "https://<子域前缀>.workflow.games"
token = "wfp_xxxxxxxx..."
EOF
```

> ⚠️ 这条命令是**整文件覆盖**，只适用于该文件还不存在的首次配置。文件已存在（比如已配过别的项目 profile）时不要给用户这条命令——**也不要自己读出来合并后写回**：那会把已有 profile 的 token 一并读进会话。改为把下面的格式规则告诉用户，由**用户自己**在编辑器里追加一节 `[profiles.<名>]`。

写盘规则（**格式是硬合同，逐字遵守**——这是 Workflow 各工具共用的凭证文件，多余或写错的键会让其他读取方直接报错拒载）：

- 路径 `~/.config/workflow/config.toml`，权限 **0600**。
- 顶层只有一个键：`current_profile = "<profile 名>"`。
- 每个 profile 一节：`[profiles.<名>]`，节内**只允许** `base_url` 与 `token` 两个键。
- 所有值必须**双引号**包裹；`base_url` 是站点根（如 `https://<前缀>.workflow.games`），**不带** `/api/v1` 后缀。
- **禁止添加任何私有/额外字段**（注释行 `#` 可以有）。
- 文件已存在时**由用户自己合并**：保留已有 profile，只新增/更新目标 profile，不整文件覆盖。你不读这个文件——判断配置是否生效靠下面的 API 探测，不靠读凭证。
- profile 名默认用子域前缀。

**写完 config.toml，接着写 `.workflow` 绑定**：问用户「要不要把绑定写进当前项目（`.workflow` 文件）」，默认写——在项目仓库根写入一行 `profile = "<profile 名>"`（规范见「项目绑定与多项目」）；同时问一句要不要写上 `[agent].label`（这个仓库的 Agent 标签，交接纪要要用），不写也不影响连接。然后进入验证。

## 验证与分诊

写盘后立刻探测 `GET $WORKFLOW_API_BASE/me` 和 `GET $WORKFLOW_API_BASE/projects/current`，按结果分诊：

- **任一端点 401** → token 失效或写入不完整。**不要让用户把 token 发到会话里核对**——请用户自己检查 `~/.config/workflow/config.toml` 里那一行：是否有 `wfp_` 前缀、是否混进了换行或空格、是否被双引号包住。仍不通就重建一枚 token，仍由用户自己写盘。
- **`/me` 200、业务端点 403** → token 绑定项目、token scope 或用户实时角色权限不满足。先核对子域/profile，再问 token 是否为 `read_only`、角色是否被调小；**不建议**借他人 token 绕权限。
- **`/projects/current` 204** → API Host 是中央面/运营面，不是项目子域；修正 profile 的 `base_url` 后重试。
- **`/projects/current` 404** → Host 指向的项目不存在或尚未开通；核对子域前缀和项目状态。
- **`/projects/current` 返回的 `project.subdomainPrefix` ≠ profile 的 `base_url` 子域或目标项目** → 凭证、Host 与目录绑定打架：先问用户要在哪个项目干活；改 `.workflow` 指向正确 profile，或为目标项目走分支 B/C 补一枚 token，绝不带着错绑定继续写数据。
- **`membership.moduleAccess` 达不到目标动作，或 `publicDemo=true`** → 当前连接只读或角色 / token 受限。建需求要 `requirements ≥ edit`，归属里程碑要 `milestones ≥ manage`。报告实际 `moduleAccess`，请项目管理员调整角色或换 `scopeMode=all` 的 token；**不看** `permissions`，不绕过服务端权限。
- **config 里多个 profile、当前目录又没有 `.workflow`** → 歧义，不得静默挑一个：问用户「这个目录绑哪个项目」，答后写 `.workflow` 再继续。
- **`.workflow` 存在但解析不出 profile** → 停止并回显该文件内容，让用户改成 `profile = "<名>"`（双引号、不带行内注释）；期间不得回落全局 `current_profile`。
- **域名解析失败** → 回显 `base_url` 让用户核对子域前缀拼写。

多项目 = 每项目一枚 token + 一节 `[profiles.<名>]` + 一个 `.workflow` 标记（见「项目绑定与多项目」）；切换项目靠所在目录的 `.workflow` 指向，不靠改全局 `current_profile`。

## 纪律

- **token 全程不进会话**：不请用户粘贴、不请用户重发、不自己读 `config.toml` 取值。写盘由用户在自己终端完成，你只做 API 探测与分诊。
- 一切输出（汇报、日志、报错）只用 **`wfp_` + 前 8 位**指代 token，绝不回显完整值。
- curl 用环境变量携带 token，不把 token 明文拼进命令行参数。
