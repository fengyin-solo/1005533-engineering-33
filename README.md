# 制药企业洁净区与批生产记录管理平台

面向洁净区环境监测、批生产记录编录、物料放行、偏差与变更控制、灭菌与清洁验证、成品检验与年度质量回顾的一体化药品生产质量管理工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 复位演示数据

```bash
make reset-demo        # 仓库根目录；或 cd frontend && npm run reset:demo
```

数据在浏览器 `localStorage` 里，命令行够不到，所以这条命令的做法是：先核对依赖
（Node ≥ 18、npm 可用，`node_modules` 缺失就先装），再推进
`frontend/src/data/seed-version.ts` 里的种子版本号，最后跑一遍类型检查确认跑通。
前端下次打开发现版本号变了，就按复位配方回滚，不用手动清浏览器存储：

- **灭菌验证**恢复示例数据（STER-0001 ~ STER-0003）；
- **成品检验**条数归零，之后每确认一份灭菌验证，结果会重新落到成品检验的待办；
- 其余模块的数据原样保留。

## 业务规则

- 状态顺次往下推进，倒序挡回：只能沿 `statuses` 顺序往前走，回退会被拒绝。
- 同一份记录重复提交只算一次：目标状态与当前一致时不重复生效、不重复落待办。
- 灭菌验证的装载方式与温度探头数以 `frontend/src/data/sterilize-ledger.ts` 台账为准
  （验证组核定口径），记录与台账不一致时按台账统一，列表、导出等入口取回的是同一份。
- 温度探头精度不够（台账精度差于 0.5℃）时验证退回校准，状态不推进、记录标异常。
- 确认验证要求验证人已签字；确认后结果落到成品检验待办（待检验）。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 批生产记录 | `batchrecord` | 批生产记录 | 批号、产品名称、生产工序 |
| 洁净区环境监测 | `cleanroom` | 环境监测记录 | 监测点位、洁净级别、悬浮粒子数 |
| 物料放行 | `materialrelease` | 物料放行单 | 物料批号、物料名称、供应商 |
| 偏差处理 | `deviation` | 偏差记录 | 偏差编号、偏差类型、发生工序 |
| 变更控制 | `changecontrol` | 变更申请 | 变更编号、变更类别、涉及工序 |
| 清洁验证 | `cleanvalidate` | 清洁验证记录 | 验证编号、设备名称、清洁规程 |
| 灭菌验证 | `sterilize` | 灭菌验证记录 | 验证编号、灭菌设备、灭菌程序 |
| 培养基模拟灌装 | `mediafill` | 模拟灌装记录 | 灌装编号、灌装规格、灌装批量 |
| 工艺用水监测 | `watermonitor` | 水质监测记录 | 取样点、水系统类别、电导率 |
| 更衣确认 | `gowning` | 更衣确认记录 | 确认编号、洁净级别、更衣步骤 |
| 成品检验 | `finishedqc` | 成品检验报告 | 检验编号、产品批号、检验项目 |
| 留样管理 | `retainsample` | 留样记录 | 留样编号、对应批号、留样数量 |
| 稳定性考察 | `stability` | 稳定性考察记录 | 考察编号、考察批号、考察条件 |
| 产品召回 | `recall` | 召回记录 | 召回编号、涉及批号、召回级别 |
| 供应商审计 | `supplieraudit` | 供应商审计记录 | 审计编号、供应商名称、物料类别 |
| 人员培训 | `training` | 培训记录 | 培训编号、培训主题、受训岗位 |
| 年度质量回顾 | `annualreview` | 年度回顾报告 | 回顾编号、回顾年度、涉及产品 |
| 质量投诉 | `complaint` | 投诉记录 | 投诉编号、投诉来源、涉及产品 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`；灭菌验证的核定口径在 `frontend/src/data/sterilize-ledger.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断；灭菌验证的专属规则
  （台账统一、退回校准、落成品检验待办）在 `frontend/src/api/sterilize-rules.ts`，由
  `local-service.ts` 调用。
- 想回到初始数据：跑 `make reset-demo`（推荐），或清掉浏览器里 `pharma-cleanroom:entries`
  这一项，或调用 `resetModule(模块)`。
