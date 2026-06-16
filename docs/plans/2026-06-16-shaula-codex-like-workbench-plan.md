# Shaula Codex-like Workbench Improvement Plan

> Date: 2026-06-16
> Status: In progress / dogfood fixes landing
> Basis: User dogfood feedback, current Shaula workbench behavior, and Codex
> sidebar reference screenshots.

## 1. Core Judgment

这轮不是简单 UI 美化，而是 Shaula 从“能跑的 agent 工具”走向“可长期使用的
工作台”的一轮体验修正。

当前最核心的问题是：

- 新建对话可能不会稳定出现在左侧栏，影响用户对数据是否保存的信任；
- 左侧信息架构仍是 session/task 列表心智，缺少 Codex 式的 `Project -> Task`
  组织方式；
- 首屏黑屏、默认窗口太小、长输入占据页面、文件夹选择不顺手等问题一起降低
  了日常使用效率；
- 底部 `模型` 和 `授权` 概念重复，配置入口需要按用户心智收敛。

所以执行顺序应当是：

```text
先修会话可见性和持久化信任，再做 Codex-like 项目侧栏，然后处理窗口、输入、
文件夹选择、模型配置收敛和启动观感。
```

## 2. Product Direction

目标是让 Shaula 的主界面更像 Codex 的工作台：

- 左侧以项目为第一层，而不是只堆 session；
- 项目下放任务/对话；
- 新建任务有明确归属；
- 最近工作、搜索、项目展开/折叠、任务选中状态都清楚；
- 配置入口更少、更符合普通用户理解；
- 常用操作按钮更大、更容易点；
- 不把界面做成营销页或装饰型卡片。

默认概念：

```text
Project = 用户心智中的工作分组，可绑定默认本地目录
Task / Session = 项目内的一次对话或一次 agent 工作
```

## 3. User Feedback Captured

本轮反馈整理为以下改动项：

1. 加载时黑屏时间太久，需要判断是性能问题还是首屏初始化阻塞。
2. Electron 默认窗口太小，打开后应当更适合工作台使用。
3. 长文本任务提交后，回答开始时应默认折叠用户输入内容，避免占满页面。
4. 选择文件夹不方便，按钮太小，应接近 Windows 原生选择文件夹体验。
5. 左侧任务栏应像 Codex 一样支持项目分组：新建项目，项目内再新建任务。
6. `模型` 和 `授权` 对用户来说高度重叠，底部不应重复放两个入口。
7. 新建对话后，左侧栏可能消失或不显示，这是 P0 级数据/状态一致性问题。
8. 输入任务后，主对话区可能不显示这条对话，这是 P0 级消息写入/渲染一致性
   问题。
9. 点击某个历史对话后，主页面跳转非常慢，需要先显示切换中的本地状态。
10. 新建任务后左侧栏仍可能延迟显示，需要 optimistic session row。
11. 文件夹选择面板中每行都出现选择按钮，视觉噪音高，选择当前目录入口应更固定。
12. 新建项目和新建任务入口要更接近 Codex 的左侧菜单心智。
13. 系统整体慢，需要减少 session 切换和新建任务的等待感。
14. 任务运行时，Workbench 进度区域没有体现 agent 正在执行。
15. 运行中的任务缺少“终止任务”入口。
16. 左侧项目分组本身需要可折叠，不只是文件浏览器可折叠。
17. `新建项目` 和 `项目文件夹` 在当前实现里是同一件事，应合并成一个显眼的
    `当前项目` 入口，文案说明可切换或新建。
18. coding agent 的系统提示词应采用 `CLAUDE.md` 的原则：先思考、简单优先、
    外科手术式改动、按用户目标验证。
19. agent 自我介绍必须稳定为 `Shaula`，不能回答成 `Pi` 或 `pi-coding-agent`。

## 4. P0 - New Task And Submitted Message Must Stay Visible

### Problem

用户刚新建的对话在左侧栏消失。这个问题优先级高于视觉优化，因为它会让用户
怀疑任务是否真的创建、是否保存、是否还能找回。

用户输入任务后，主对话区还可能不显示这条对话。这比“列表没刷新”更严重：
用户已经完成提交动作，但界面没有把当前 conversation 建立出来，也没有给出
明确失败状态。

### Likely Causes To Investigate

- 新建任务只进入当前页面状态，没有写入持久化 session/task index；
- 已写入，但左侧列表查询条件没有包含新任务；
- 新任务没有 project 归属，被分组过滤掉；
- 新任务 title 为空，渲染时被跳过；
- 排序、分页或搜索状态把新任务挤出当前列表；
- route 已切到新任务，但 sidebar 没有刷新；
- 新任务还没有第一条消息，现有逻辑把空 session 当作不可展示对象。
- 用户消息已提交到 runner/API，但没有写入当前 session messages；
- optimistic user message 没有先进入本地消息列表；
- SSE/stream 初始化失败后，用户消息被回滚或停留在 pending 状态；
- 当前 session id 和消息写入使用的 session id 不一致；
- message reducer 收到事件但没有触发 React state refresh；
- 失败路径没有生成可见错误气泡，导致用户以为消息消失。

### Target Behavior

任何新建任务必须立刻出现在左侧当前项目下。

即使任务还没有第一条消息，也要显示为：

```text
未命名任务
```

或：

```text
新任务
```

任何已提交的用户任务必须立刻出现在主对话区。模型是否开始回答、是否失败，
都不能影响用户已提交内容的可见性。

切换历史任务时，如果上下文还在加载，主页面应立即进入目标任务的加载态，
不能停留在旧任务或空白状态。

### Acceptance Criteria

- 点击新建任务后，左侧当前项目下立即出现该任务；
- 新建任务自动选中；
- 刷新页面后仍能看到该任务；
- 没有标题时显示稳定 fallback 标题；
- 没有项目归属时进入 `未归档` 或 `默认项目`；
- 搜索为空时一定能看到刚创建的任务；
- 输入任务并提交后，主对话区立即显示用户消息；
- 任务提交失败时，用户消息仍保留，并显示明确失败状态或重试入口；
- stream/SSE 失败不能让用户消息从 transcript 中消失；
- 当前路由、当前 session、消息写入 session 三者必须一致；
- 点击历史任务后立即选中并显示 `正在打开任务` loading 态；
- 刷新页面后，已提交的用户消息仍存在；
- 现有历史 session 不丢失。

## 5. P1 - Codex-like Project Sidebar

### Target Structure

左侧栏参考 Codex 的信息架构：

```text
New task
Search

Pinned / Recent optional

Project: Shaula
  - 帮我修左侧栏
  - 读一下主界面观感
  - shaula agent 帮我打开...

Project: 批改作业
  - 我先说一下我的想法
  - 能不能先把这些学生...

Project: 工作
  - 我要离开集团了...
  - 工作聊天记忆沉淀
```

### Project Model V1

第一版不要做过重的数据模型迁移。建议项目最小字段：

```text
id
name
defaultPath
createdAt
updatedAt
lastOpenedAt
```

任务/session 需要能引用：

```text
projectId
```

### Behavior

- 当前选中项目下，新建任务默认归入该项目；
- 没有选中项目时，新建任务进入 `未归档` 或默认项目；
- 项目可展开/折叠；
- 项目名旁边提供更多菜单；
- 项目内可新建任务；
- 任务列表显示标题、时间、消息数量或简短状态；
- 搜索可以搜全部项目下的任务；
- 首次迁移时，旧任务可按工作目录自动分组，无法判断的进入未归档。

### Non-goals For V1

- 不做团队共享项目；
- 不做远程同步；
- 不做复杂权限；
- 不重写所有 session 存储；
- 不强迫每个项目必须绑定文件夹。

## 6. P1 - Native Folder Selection

### Problem

当前选择文件夹不够顺手，按钮也偏小。对于桌面应用，用户期待接近 Windows
原生选择文件夹体验。

### Target

在 Electron 环境中使用原生目录选择：

```text
dialog.showOpenDialog({ properties: ["openDirectory"] })
```

### UI Changes

- 主要选择按钮高度提升到 40-44px；
- 文案使用 `选择文件夹` 或 `选择项目文件夹`；
- 显示当前项目路径；
- 支持最近使用目录；
- 可选增强：支持拖拽文件夹到项目区域。

### Acceptance Criteria

- 点击按钮打开 Windows 原生文件夹选择器；
- 选择后项目路径立即更新；
- 取消选择不清空原路径；
- 按钮易点击，不再是小型图标按钮；
- Web/dev 环境没有 Electron dialog 时，有明确 fallback。
- fallback 文件面板中，不在每个目录行重复放 `选择文件夹` 按钮；
- fallback 文件面板底部固定显示 `选择当前文件夹` / `引用当前文件夹`。

## 6.1 P1 - Running Progress And Abort

### Problem

用户安排任务后，右侧进度区域显示 `暂无进行中的任务`，但主对话区实际已经在
运行。这会让用户误判任务没有开始。

同时，任务运行中没有明显的终止入口。输入错任务、模型卡住、工具执行过长时，
用户只能等待。

### Target

- agent 开始运行后，即使还没有结构化 `update_progress`，Workbench 也显示
  运行态 fallback；
- fallback 文案跟随 runtime phase：等待模型、思考、执行工具；
- 进度分组在任务运行时自动展开；
- Workbench 概览和进度详情中都提供 `终止任务`；
- 终止使用已有 abort action，不另建一套中断通道。

### Acceptance Criteria

- `agent_start` 后 Workbench 进度不再显示为空；
- 未上报结构化进度时，也能看到一条 running step；
- 点击 `终止任务` 后当前 run 立即退出 streaming UI 状态；
- 终止失败不会让 UI 卡死；
- 任务正常结束后进度状态被 settle，不继续显示 running。

## 7. P1 - Long Prompt Folding

### Problem

长文本任务提交后，用户输入内容占据大量页面空间，导致回答开始位置被挤下去。

### Target

当用户输入超过阈值时，默认折叠显示。

建议规则：

```text
超过 500-800 字，或超过 8-12 行，默认折叠
```

折叠态显示：

- 任务标题或前两行摘要；
- 字数/行数；
- `展开全文` 操作。

### Acceptance Criteria

- 长任务提交后，回答区域优先可见；
- 用户可以展开查看完整原文；
- 短输入不折叠；
- 折叠不影响复制、导出、历史读取；
- 移动端和窄窗口不发生文本溢出。

## 8. P1 - Default Window Size

### Problem

Electron 默认窗口偏小，不适合 agent 工作台。

### Target

建议默认窗口：

```text
width: 1200-1280
height: 800-860
```

建议最小窗口：

```text
minWidth: 960
minHeight: 680
```

### Acceptance Criteria

- 首次打开时能同时看到左侧栏、主对话区和关键底部输入；
- 窗口不会小到让按钮/输入区挤压；
- 保留用户上次窗口尺寸时，优先尊重用户上次设置；
- 老用户已有窗口状态不被强制覆盖，除非当前尺寸低于 min size。

## 9. P2 - Startup Black Screen Reduction

### Problem

加载时黑屏时间太久。不能先假设一定是性能问题，需要区分：

- Electron 主进程启动慢；
- Next server / renderer 首屏准备慢；
- provider/model/auth 初始化阻塞；
- session/project store 读取阻塞；
- 首屏没有 loading/skeleton，导致用户看到纯黑；
- 打包模式和 dev 模式表现不同。

### Investigation

增加启动打点：

```text
app ready
window created
renderer load start
renderer first paint
provider status loaded
sessions loaded
first interactive
```

### Target

- 避免纯黑屏；
- 首屏尽快显示品牌/骨架屏；
- 将慢初始化放到首屏之后异步完成；
- 黑屏是否由性能导致，用打点确认。

### Acceptance Criteria

- 启动时不再长时间显示纯黑；
- 本地 dev 和 packaged app 都有可观察打点；
- 如果 provider/auth 慢，不阻塞 shell 首屏；
- 打点能说明主要耗时来自哪里。

## 10. P2 - Merge Model And Authorization Entry Points

### Problem

底部同时有 `模型` 和 `授权`，用户容易理解为两个重复入口。实际上授权通常
是模型可用性的前置状态，不应和模型并列成两个独立主入口。

### Target

底部导航建议保留：

```text
模型
设置
```

或：

```text
模型与接入
设置
```

授权/API key/OAuth 状态放到模型入口内部。

### Model Panel Should Show

- provider；
- model；
- readiness status；
- key/login status；
- quota/resource issue；
- test result；
- advanced config entry。

### Acceptance Criteria

- 底部不再同时出现 `模型` 和 `授权` 两个重复入口；
- 用户能在模型面板内完成登录、填写 key、测试连通性；
- 不展示 API key 明文；
- quota/resource/model-not-found 等状态仍清楚可见。

## 11. P2 - Button Size And Control Density

### Target

常用操作按钮统一更容易点击：

- primary action: 42-44px；
- frequent secondary action: 40px；
- icon-only action: 保持紧凑，但必须有 tooltip / aria-label；
- 列表项高度不要过度膨胀，保持可扫描。

### Priority Surfaces

- 新建任务；
- 当前项目（切换/新建文件夹）；
- 模型测试/添加 key；
- 设置保存；
- 左侧项目更多菜单。

## 12. Suggested Execution Order

1. 修复新建任务左侧消失问题。
2. 修复输入任务后主对话区不显示用户消息的问题。
3. 给任务/session 增加稳定 fallback 标题和 project 归属规则。
4. 新增轻量 Project 数据结构和左侧 Codex-like 项目分组。
5. 实现新建项目、项目内新建任务、未归档分组。
6. 接入 Electron 原生文件夹选择器，并放大相关按钮。
7. 实现长任务输入默认折叠。
8. 调整 Electron 默认窗口尺寸和最小尺寸。
9. 合并模型/授权入口，模型面板内承载接入状态。
10. 增加启动打点和 skeleton，定位并减少黑屏。
11. 做桌面视觉检查和回归测试。

## 12.1 Current Implementation Notes

本轮已落地的子集：

- 新建任务 / cold agent 创建后，左侧 session 列表先做 optimistic insert；
- 历史 session 切换先创建 loading runner，并立即显示 `正在打开任务`；
- 用户长输入提交后默认折叠；
- Electron 默认窗口尺寸增大，并保留 loading skeleton；
- 左侧入口改成更接近 Codex 的 `新建任务 / 当前项目` 工作台心智；
- Workbench 进度增加 runtime fallback 和 `终止任务`；
- 文件浏览器移除目录行级 `选文件夹` 按钮，改为底部固定选择当前目录；
- Playwright 支持通过 `PLAYWRIGHT_REUSE_EXISTING=1` 复用已启动 dev server。
- 左侧 `新建项目` 与 `当前项目` 合并为一个显眼的 `当前项目` 选择器；
- 左侧文件区从 `Explorer` 改成中文 `文件` 折叠面板；
- 顶部独立 `模型账号授权` 按钮已删除，授权只保留在模型接入流程内部。
- 左侧项目入口收敛为一个 `当前项目` 选择器，承担切换和新建项目两种动作，
  避免 `新建项目` 与 `项目文件夹` 重复；
- 左侧项目/session 分组 header 可展开/折叠，折叠后隐藏该项目下的任务列表；
- `终止任务` 从顶部移回 Composer 发送区，运行时紧跟 `补充当前 / 排队继续`
  这些发送动作，Workbench 进度区继续保留备用终止入口；
- coding agent 的系统提示词注入 Shaula 身份和 `CLAUDE.md` 式执行原则，要求
  回答身份时使用 `Shaula`，不要自称 `Pi` 或 `pi-coding-agent`。

## 13. Verification Plan

### Unit / Store Tests

- project store create/update/list；
- session create 后必须进入 sidebar source；
- user message submit 后必须进入当前 session transcript；
- empty title fallback；
- projectId missing fallback；
- search across projects；
- model/auth readiness state mapping。

### E2E Tests

- 新建任务后左侧立即出现并选中；
- 刷新后任务仍存在；
- 输入任务后主对话区立即显示该用户消息；
- 模型响应失败时用户消息仍可见，并出现失败/重试状态；
- 通过 `当前项目` 入口切换或新建项目后，可在项目内新建任务；
- 左侧项目分组可折叠和展开，折叠后任务列表不占用空间；
- 长输入提交后默认折叠；
- 文件夹选择 Electron path 更新；
- 运行任务时 Composer 发送动作后方 `终止任务` 可见，可终止有 live agent id 的任务；
- 模型入口能显示授权/ready 状态。

### Manual / Visual Checks

- Windows packaged app 首次打开；
- 默认窗口尺寸；
- 黑屏/首屏 skeleton；
- 左侧项目展开/折叠；
- 任务列表长标题；
- 窄窗口文本不重叠；
- 底部入口不重复。

## 14. Open Decisions

需要在实现前确认或用默认策略推进：

- `未归档` 还是 `默认项目` 作为无归属任务的 fallback；
- 旧 session 是否按 cwd 自动迁移到项目；
- 项目是否必须绑定本地文件夹；
- 项目是否有默认模型；
- 搜索结果是保留项目分组，还是用扁平结果列表；
- 是否保留底部 `Explorer` 入口，或把文件浏览整合到项目区域。

建议默认：

```text
无归属任务进入“未归档”。
旧 session 第一版不做破坏性迁移，只做读取时分组。
项目可以没有文件夹，但有文件夹时作为默认 cwd。
项目默认不绑定模型，先继承全局模型。
搜索结果保留项目来源信息。
```

## 15. Non-goals

- 不在这一轮做云同步或多设备同步；
- 不做账号体系；
- 不做团队权限；
- 不公开发布或推送；
- 不把高级 provider 配置删除，只是从底部主入口里收敛；
- 不在没有数据打点前武断下结论说黑屏一定是性能问题。
