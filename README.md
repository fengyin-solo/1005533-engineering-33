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

## 灭菌验证环境复位（一条命令）

新同事克隆后，或上一轮残留的灭菌设备/程序/装载方式/探头数还挂在浏览器存储里时，执行：

```bash
# 仓库根目录
make reset
# 等价于
cd frontend && npm run reset:sterilize
```

这条命令把「回滚复位 + 铺种子数据」串成一步：

1. **起跑前先核对依赖**：Node >= 18、`package.json` 里的依赖是否装好，缺了自动安装；全程使用相对脚本自身的路径，不写绝对路径，克隆到任何目录都能跑。
2. **灭菌验证恢复示例数据**：按验证组核定台账 `frontend/src/data/sterilize-ledger.json`
   生成，装载方式、温度探头数一律取台账口径（各入口取回来是同一份）；验证人未签字的不推进。
3. **成品检验条数归零**。
4. **版本自增**：`src/data/reset-state.json` 的 `version` 每跑一次加一，localStorage
   键带版本（`pharma-cleanroom:entries:vN`），旧版本残留键会被自动清掉，**不用再手动清浏览器存储**。
5. 写完回读自检（条数、台账一致、探头精度、签字），任一不过非零退出。

灭菌验证流转规则（均在 `src/api/local-service.ts` 落地，页面不做业务判断）：

- 状态 `待验证 → 灭菌中 → 已验证 → 已失效` **顺次往下推进，倒序/越级一律挡回**；
  同一份验证重复提交只算一次。
- **按设备排期**：同一台灭菌设备同时只允许一批「灭菌中」。
- **装载方式/温度探头数按台账统一**：提交时与「灭菌设备+灭菌程序」在台账里的口径不一致，
  自动改成台账值并提示；设备+程序不在台账里直接挡回。
- **温度探头数精度不够退回校准**：必须是正整数，小数、非数字一律挡回。
- **验证人要签字**：提交/确认时以当前登录操作员作为签字人，为空则挡回。
- **确认验证后结果落到成品检验的待办**（待检验，检验编号 `FINI-<验证编号>`，幂等不重复）。

改动上述规则后跑 `cd frontend && npm run check:sterilize` 回归（24 条断言）。

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
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：跑 `make reset`（见下），或调用 `resetModule(模块)`；不必再手清 localStorage。
