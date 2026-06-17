# Shaula Product Coding Agent Optimization Plan

> Date: 2026-06-17
> Status: Execution plan
> Basis: World Cup prediction workbench dogfood, user feedback, subagent review.

## 1. Core Judgment

Shaula 当前最主要的问题不是模型不会写代码，而是 coding agent 缺少稳定的
产品型执行约束。

世界杯预测工作台任务暴露的问题是典型案例：agent 做出了可运行页面，但没有
把“预测工作台”的主视角、主产物、验收标准和视觉验收锁住，最后容易变成
“比赛列表 + 单场详情”的局部实现。

下一阶段主线应当是：

```text
任务契约 -> 主产物锁定 -> 产品信息架构 -> 视觉/证据验收 -> 交付说明
```

## 2. P0 - Task Contract Before Work

### Problem

普通 coding prompt 目前没有稳定的任务契约。Goal 模式已有
`execution-contract`，但普通任务只会记录 route decision，右侧 Workbench
无法展示本轮任务的目标、验收和证据要求。

### Target

每次普通任务开始时，Shaula 都生成轻量任务契约，并把它推到用户可见的
Workbench 进度里。

契约至少包含：

- objective；
- rubric/profile；
- required evidence；
- scope；
- non-goals；
- acceptance criteria。

### Acceptance Criteria

- 普通 prompt 开始后，Workbench 立即显示本轮任务目标；
- 即使模型还没开始输出，也能看到“确认任务契约 / 锁定主产物 / 执行 / 验证”；
- contract 被持久化到现有 `execution-contract` store；
- agent prompt 里包含任务契约和执行协议；
- active goal 不重复创建普通任务契约。

## 3. P0 - Main Artifact Lock

### Problem

当项目里有多个候选产物时，agent 容易乱改，例如：

- `ui-v0.html` 到 `ui-v5.html`；
- `apps/web`；
- 平行新建目录；
- 带空格或临时名的异常目录。

### Target

coding agent 必须先识别并说明当前主产物。第一版不新增复杂数据库，先通过
prompt protocol 和 progress artifacts 推动：

- 开工前要求 agent 锁定主产物；
- Workbench 从 progress artifacts 推导当前主产物；
- 没有产物时明确显示 `待锁定`。

### Acceptance Criteria

- Workbench 驾驶舱显示 `主产物`；
- 有 file/url/browser/screenshot artifact 时优先展示该产物；
- 没有 artifact 时显示待锁定状态；
- agent prompt 明确要求发现多个候选产物时先收敛，不继续散写。

## 4. P1 - Product IA Gate For Workbench/Dashboard Tasks

### Problem

“工作台 / dashboard / 管理台 / 分析平台”不是普通页面。直接写组件会把问题
变成局部 UI patch，而不是产品结构设计。

### Target

遇到产品型前端任务时，agent 先做信息架构判断：

- 首页第一眼看什么；
- 关键指标是什么；
- 用户下一步动作是什么；
- 详情页和总览页如何分离；
- 赛前预测、赛后复盘、历史数据如何分区。

### Acceptance Criteria

- prompt 协议要求产品型任务先设 IA；
- 两轮用户反馈“不对 / 还乱 / 没改好”后，agent 停止局部 patch，转入结构诊断；
- 交付时说明哪些验收项满足，哪些仍是占位或需要用户确认。

## 5. P1 - Visual QA For Frontend Work

### Problem

`typecheck/build` 通过不代表体验成立。前端任务需要看截图。

### Target

前端/UI 任务必须要求 browser observation：

- desktop 截图；
- 必要时 mobile 截图；
- 首屏焦点；
- 信息层级；
- 文本溢出；
- 是否像目标产品。

### Acceptance Criteria

- `coding.frontend-ui` contract 默认要求 `browser_observation`；
- prompt 协议要求 UI 任务跑浏览器检查；
- Workbench 显示浏览器状态和截图/URL artifact；
- 最终回复对照验收项说明完成依据。

## 6. P2 - File Governance

### Target

文件治理先通过 prompt 和交付协议落地，后续再做自动扫描。

规则：

- 不无说明地新建兄弟项目目录；
- 不留下异常目录名或临时目录；
- 多版本探索必须标记 active/archive/draft；
- 结束时说明用户应打开哪个文件或 URL 验证。

### Future Checks

- 检测异常目录名；
- 检测多个平行 HTML 版本；
- 检测多个候选 app entry；
- 未声明产物直接在 Workbench 警示。

## 7. Execution Order

1. 写入本计划文档。
2. 普通 prompt 生成 execution contract。
3. 普通 prompt 开始时推送初始 progress steps 和 contract artifact。
4. prompt 注入产品型 coding agent 执行协议。
5. Workbench 驾驶舱展示 contract/main artifact/required evidence。
6. 增加针对 contract/progress/Workbench 的回归测试。
7. 跑 typecheck、lint、目标 e2e。

## 8. Non-goals

- 本轮不重写完整项目/任务持久化模型；
- 不做公开发布；
- 不做复杂产物数据库；
- 不把 goal harness 重写成另一套；
- 不删除已有高级配置或历史 session。
