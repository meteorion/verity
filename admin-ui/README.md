# Verity RAG 智能客服管理后台

对应 `../doc/design.md`（设计文档合集）/ `../doc/plan.md` 中「知识运营后台」「运营后台 API」的前端实现，覆盖六大模块：

| 模块 | 文件 | 对应后端接口（规划） |
| --- | --- | --- |
| 知识库管理 | `src/pages/KnowledgeBase.jsx` | `GET/POST /api/ops/documents`、`/api/ops/documents/{id}/disable` |
| 对话测试/调试 | `src/pages/Playground.jsx` | `POST /v1/chat`（非流式调试模式） |
| 会话监控 | `src/pages/Sessions.jsx` | `session_logs` 表查询接口（待补充） |
| 数据统计 | `src/pages/Analytics.jsx` | `GET /api/ops/metrics` |
| 模型/参数配置 | `src/pages/ModelConfig.jsx` | Provider 环境变量与灰度配置接口（待补充） |
| 用户与权限 | `src/pages/Users.jsx` | IDP / 用户角色管理接口（待补充） |

当前所有页面使用 `src/mock/data.js` 中的模拟数据，字段结构已对齐后端 `documents` / `session_logs` / `chunks` 表与 `/api/ops/*` 响应格式。接入真实后端时，只需将各 page 中对 mock 数据的引用替换为 `fetch`/`axios` 请求，UI 与交互逻辑无需改动。

## 本地运行

```bash
cd doc/admin-ui
npm install
npm run dev
```

默认通过 Vite 代理将 `/api/ops` 与 `/v1` 转发到 `http://localhost:8000`（即 `app` 服务），可在 `vite.config.js` 中修改。

## 技术栈

- React 18 + Vite
- Tailwind CSS（原子类，未引入组件库，便于后续替换为 shadcn/ui 等）
- 无状态管理库依赖，页面内部用 `useState`/`useMemo` 管理交互态；接入真实接口时可按需引入 React Query 做数据请求缓存

## 目录结构

```
admin-ui/
├── src/
│   ├── App.jsx              # 整体布局：侧边栏 + 顶栏 + 路由（tab 切换，未引入 react-router）
│   ├── components/
│   │   ├── Icon.jsx          # 轻量内联 SVG 图标
│   │   ├── Sidebar.jsx       # 六大模块导航
│   │   └── ui.jsx            # Card / Table / Badge / MetricCard 等共享组件
│   ├── mock/data.js          # 模拟数据，字段对齐后端 schema
│   └── pages/                # 六大功能模块页面
└── ...
```

## 已知待办

- 当前为纯前端交互原型（mock 数据），需接入真实 `/api/ops/*` 与 `/v1/chat` 接口
- 对话测试模块的流式输出为模拟延时，接入真实后端后应改为 SSE 消费
- 会话监控与用户权限模块尚无对应后端接口，需与后端约定分页、鉴权字段
