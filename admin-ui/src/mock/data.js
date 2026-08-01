// Mock 数据，字段结构对齐 arch.md 中的 documents / session_logs / chunks 表定义
// 接入真实后端时，将各 pages 中的 mock 引用替换为对 /api/ops/* 的 fetch 调用即可，
// 组件内部数据结构保持不变。

export const documents = [
  {
    doc_id: 'doc_10231',
    title: '售后手册 v2026-06',
    owner_email: 'zhangwei@company.com',
    business_line: '零售/售后',
    source_type: 'PDF',
    admission_score: 92,
    status: 'active',
    version: '2026-06',
    conflict: false,
    effective_from: '2026-06-01',
    effective_to: null,
    chunk_count: 128,
    updated_at: '2026-07-28 10:20'
  },
  {
    doc_id: 'doc_10188',
    title: '企业版产品功能说明',
    owner_email: 'liuyang@company.com',
    business_line: '企业版/产品',
    source_type: 'Word',
    admission_score: 78,
    status: 'active',
    version: '2026-05',
    conflict: false,
    effective_from: '2026-05-10',
    effective_to: null,
    chunk_count: 64,
    updated_at: '2026-07-20 09:02'
  },
  {
    doc_id: 'doc_10305',
    title: '退换货政策（旧版，待下线）',
    owner_email: 'zhangwei@company.com',
    business_line: '零售/售后',
    source_type: 'PDF',
    admission_score: 55,
    status: 'pending',
    version: '2025-11',
    conflict: true,
    effective_from: '2025-11-01',
    effective_to: '2026-06-01',
    chunk_count: 41,
    updated_at: '2026-07-30 14:11'
  },
  {
    doc_id: 'doc_10412',
    title: '发票与开票流程 Wiki',
    owner_email: 'chenxi@company.com',
    business_line: '财务',
    source_type: 'Confluence',
    admission_score: 84,
    status: 'active',
    version: '2026-07',
    conflict: false,
    effective_from: '2026-07-01',
    effective_to: null,
    chunk_count: 22,
    updated_at: '2026-07-31 08:40'
  },
  {
    doc_id: 'doc_09876',
    title: '华东地区物流时效说明（扫描件）',
    owner_email: 'wangfang@company.com',
    business_line: '物流',
    source_type: '扫描 PDF',
    admission_score: 61,
    status: 'pending',
    version: '2026-04',
    conflict: false,
    effective_from: '2026-04-15',
    effective_to: null,
    chunk_count: 18,
    updated_at: '2026-07-29 17:55'
  },
  {
    doc_id: 'doc_09650',
    title: '2025 促销活动规则（已过期）',
    owner_email: 'liuyang@company.com',
    business_line: '市场',
    source_type: 'PDF',
    admission_score: 70,
    status: 'expired',
    version: '2025-12',
    conflict: false,
    effective_from: '2025-12-01',
    effective_to: '2026-01-31',
    chunk_count: 30,
    updated_at: '2026-02-01 00:00'
  }
]

export const documentStatusLabel = {
  active: '已生效',
  pending: '待审核',
  rejected: '已驳回',
  expired: '已过期'
}

export const sessionLogs = [
  {
    session_id: 's_20260801_0031',
    turn_id: 3,
    uid: 'u_88231',
    query_raw: '生鲜坏了还能退吗',
    intent: 'after_sales_refund',
    faq_hit: false,
    chunk_ids: ['doc_10231#p3_c02', 'doc_10231#p3_c03'],
    prompt_version: 'prompt-v3',
    model_id: 'claude-sonnet-4-6',
    first_token_ms: 780,
    output_tokens: 210,
    nli_flags: [],
    csat: 5,
    transferred: false,
    created_at: '2026-08-01 09:12:03'
  },
  {
    session_id: 's_20260801_0027',
    turn_id: 1,
    uid: 'u_77120',
    query_raw: '企业版支持多少并发账号',
    intent: 'product_inquiry',
    faq_hit: false,
    chunk_ids: ['doc_10188#p1_c01'],
    prompt_version: 'prompt-v3',
    model_id: 'claude-sonnet-4-6',
    first_token_ms: 690,
    output_tokens: 150,
    nli_flags: [],
    csat: 4,
    transferred: false,
    created_at: '2026-08-01 08:55:41'
  },
  {
    session_id: 's_20260801_0019',
    turn_id: 5,
    uid: 'u_65310',
    query_raw: '你们这垃圾服务，物流丢件三天没人管！',
    intent: 'complaint',
    faq_hit: false,
    chunk_ids: [],
    prompt_version: 'prompt-v3',
    model_id: 'claude-sonnet-4-6',
    first_token_ms: 0,
    output_tokens: 0,
    nli_flags: [],
    csat: null,
    transferred: true,
    transfer_reason: '情绪识别为强烈负面',
    created_at: '2026-08-01 08:40:12'
  },
  {
    session_id: 's_20260801_0003',
    turn_id: 2,
    uid: 'u_12045',
    query_raw: '电子发票怎么申请，抬头能改吗',
    intent: 'invoice',
    faq_hit: false,
    chunk_ids: ['doc_10412#p1_c01', 'doc_10412#p2_c01'],
    prompt_version: 'prompt-v3',
    model_id: 'claude-sonnet-4-6',
    first_token_ms: 810,
    output_tokens: 190,
    nli_flags: [{ field: '开票时效', level: 'warn' }],
    csat: 3,
    transferred: false,
    created_at: '2026-08-01 08:12:55'
  },
  {
    session_id: 's_20260731_0442',
    turn_id: 1,
    uid: 'u_33012',
    query_raw: '登陆不上怎么办',
    intent: 'faq',
    faq_hit: true,
    chunk_ids: [],
    prompt_version: '-',
    model_id: '-',
    first_token_ms: 18,
    output_tokens: 0,
    nli_flags: [],
    csat: 5,
    transferred: false,
    created_at: '2026-07-31 22:03:10'
  }
]

export const retrievalTrace = [
  { span: 'safety_filter', latency_ms: 42, detail: '通过' },
  { span: 'faq_match', latency_ms: 16, detail: '未命中' },
  { span: 'intent_classify', latency_ms: 4, detail: 'after_sales_refund' },
  { span: 'cache_lookup', latency_ms: 21, detail: '未命中（阈值 0.93）' },
  { span: 'embed_query', latency_ms: 38, detail: 'text-embedding-3-small' },
  { span: 'vector_search', latency_ms: 112, detail: 'Top-50，PGVector' },
  { span: 'sparse_search', latency_ms: 0, detail: '跳过（API 模式无稀疏向量）' },
  { span: 'rrf_merge', latency_ms: 3, detail: '候选 50 条，k=60' },
  { span: 'rerank', latency_ms: 0, detail: '跳过（RERANK_PROVIDER=none）' },
  { span: 'prompt_assembly', latency_ms: 12, detail: '知识 3 片段，约 2100 tokens' },
  { span: 'llm_generate', latency_ms: 780, detail: 'claude-sonnet-4-6，首字 780ms' },
  { span: 'nli_check', latency_ms: 210, detail: '异步，未发现不一致（跳过，NLI_PROVIDER=none）' }
]

export const retrievedChunks = [
  {
    chunk_id: 'doc_10231#p3_c02',
    title: '售后手册 v2026-06',
    breadcrumb: '售后手册 > 退换货 > 生鲜类目',
    content: '生鲜商品自签收之日起 24 小时内可申请退款，超时需提供质量问题证明...',
    score: 0.91
  },
  {
    chunk_id: 'doc_10231#p3_c03',
    title: '售后手册 v2026-06',
    breadcrumb: '售后手册 > 退换货 > 生鲜类目',
    content: '退款审核时效为 1~2 个工作日，审核通过后原路退回...',
    score: 0.83
  },
  {
    chunk_id: 'doc_10305#p1_c01',
    title: '退换货政策（旧版，待下线）',
    breadcrumb: '退换货政策 > 生鲜条款',
    content: '生鲜商品签收后 48 小时内可申请退款（旧版，与现行政策冲突）...',
    score: 0.62
  }
]

export const metrics = {
  overview: [
    { label: '自助解决率', value: 58, unit: '%', tone: 'green', hint: 'P2 目标 ≥ 55%' },
    { label: 'Recall@5', value: 0.87, unit: '', tone: 'green', hint: '金标回归集，目标 ≥ 0.85' },
    { label: '首字延迟 P95', value: 1.2, unit: 's', tone: 'green', hint: '目标 ≤ 1.5s' },
    { label: 'CSAT', value: 4.2, unit: '/5', tone: 'slate', hint: 'P3 目标 ≥ 4.0' }
  ],
  secondary: [
    { label: '人工抽检准确率', value: 90, unit: '%', hint: '目标 ≥ 88%' },
    { label: '引用正确率', value: 93, unit: '%', hint: '目标 ≥ 90%' },
    { label: '有害/错误回答率', value: 0.4, unit: '%', tone: 'green', hint: '目标 < 1%' },
    { label: '转人工率', value: 14, unit: '%', hint: '近 7 日均值' },
    { label: '语义缓存命中率', value: 11, unit: '%', hint: '目标 ≥ 15%' },
    { label: '单会话 Token 成本节省', value: 74, unit: '%', tone: 'green', hint: '相较全文投喂基准' }
  ],
  dailyVolume: [
    { date: '07-26', sessions: 812, transferred: 118 },
    { date: '07-27', sessions: 845, transferred: 121 },
    { date: '07-28', sessions: 790, transferred: 95 },
    { date: '07-29', sessions: 902, transferred: 130 },
    { date: '07-30', sessions: 960, transferred: 140 },
    { date: '07-31', sessions: 887, transferred: 108 },
    { date: '08-01', sessions: 431, transferred: 61 }
  ],
  intentDistribution: [
    { intent: '知识咨询', pct: 46 },
    { intent: '业务查询', pct: 24 },
    { intent: 'FAQ 精准命中', pct: 18 },
    { intent: '投诉/转人工', pct: 8 },
    { intent: '闲聊', pct: 4 }
  ]
}

export const providerConfig = {
  embedding: { provider: 'api', model: 'text-embedding-3-small', dim: 1536 },
  rerank: { provider: 'none', model: '-' },
  nli: { provider: 'none', model: '-' },
  llm: { provider: 'anthropic', model: 'claude-sonnet-4-6', fallback: 'gpt-4o' }
}

export const paramConfig = {
  chunk_size: 600,
  chunk_overlap: 80,
  vector_top_k: 50,
  bm25_top_k: 50,
  rrf_k: 60,
  rerank_top_k: 6,
  relevance_threshold: 0.35,
  temperature: 0.2,
  max_tokens: 800,
  semantic_cache_threshold: 0.93,
  history_turns: 5
}

export const promptVersions = [
  { version: 'prompt-v3', created_at: '2026-07-25', status: 'active', note: '强化金额/时效逐字引用规则' },
  { version: 'prompt-v2', created_at: '2026-07-02', status: 'archived', note: '加入转人工话术模板' },
  { version: 'prompt-v1', created_at: '2026-06-10', status: 'archived', note: '初始版本，P1 上线' }
]

export const users = [
  { uid: 'u_admin_01', name: '系统管理员', email: 'admin@company.com', roles: ['admin'], last_login: '2026-08-01 09:00' },
  { uid: 'u_ops_02', name: '知识运营-张伟', email: 'zhangwei@company.com', roles: ['ops', 'agent'], last_login: '2026-08-01 08:40' },
  { uid: 'u_ops_03', name: '知识运营-刘洋', email: 'liuyang@company.com', roles: ['ops'], last_login: '2026-07-31 18:10' },
  { uid: 'u_agent_04', name: '坐席-王芳', email: 'wangfang@company.com', roles: ['agent'], last_login: '2026-08-01 09:05' },
  { uid: 'u_dev_05', name: '算法工程师-陈曦', email: 'chenxi@company.com', roles: ['admin', 'ops'], last_login: '2026-07-30 21:30' }
]

export const roleAclMap = [
  { role: 'customer', desc: '终端用户，仅可检索 acl 含 public 的知识', scope: 'public' },
  { role: 'agent', desc: '人工坐席，可检索 agent + public 知识，可查看会话全文', scope: 'agent, public' },
  { role: 'ops', desc: '知识运营，可管理文档准入、下架、生效期', scope: '知识运营后台全部权限' },
  { role: 'admin', desc: '系统管理员，可配置模型参数、用户与权限', scope: '系统全部权限' }
]
