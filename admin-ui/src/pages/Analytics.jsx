import { metrics } from '../mock/data.js'
import { Card, MetricCard, ProgressBar } from '../components/ui.jsx'

// 数据统计看板，指标口径对齐 design.md §8 评估体系 与 plan.md §12 验收指标追踪表
// 真实接入：GET /api/ops/metrics

export default function Analytics() {
  const maxSessions = Math.max(...metrics.dailyVolume.map((d) => d.sessions))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {metrics.overview.map((m) => (
          <MetricCard key={m.label} {...m} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card title="每日会话量与转人工量（近 7 日）">
          <div className="flex items-end gap-3 h-40">
            {metrics.dailyVolume.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1">
                <div className="w-full flex flex-col justify-end" style={{ height: '128px' }}>
                  <div
                    className="w-full bg-indigo-100 rounded-t"
                    style={{ height: `${(d.sessions / maxSessions) * 100}%` }}
                    title={`会话数 ${d.sessions}`}
                  >
                    <div
                      className="w-full bg-indigo-500 rounded-t"
                      style={{ height: `${(d.transferred / d.sessions) * 100}%` }}
                      title={`转人工 ${d.transferred}`}
                    />
                  </div>
                </div>
                <span className="text-xs text-slate-400">{d.date}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-100 inline-block" /> 全部会话</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" /> 转人工</span>
          </div>
        </Card>

        <Card title="意图分布">
          <div className="space-y-3">
            {metrics.intentDistribution.map((i) => (
              <div key={i.intent}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-600">{i.intent}</span>
                  <span className="text-slate-400">{i.pct}%</span>
                </div>
                <ProgressBar value={i.pct} tone="indigo" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="分层评测指标">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {metrics.secondary.map((m) => (
            <MetricCard key={m.label} {...m} />
          ))}
        </div>
      </Card>

      <Card title="成本与效率">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="border border-slate-100 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">单会话平均 Token</p>
            <p className="text-lg font-semibold text-slate-800">≈ 20,400</p>
            <p className="text-xs text-slate-400 mt-1">相较全文投喂基准（≈80,000）节省约 74%</p>
          </div>
          <div className="border border-slate-100 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">FAQ 短路占比</p>
            <p className="text-lg font-semibold text-slate-800">18%</p>
            <p className="text-xs text-slate-400 mt-1">零 LLM 调用直出</p>
          </div>
          <div className="border border-slate-100 rounded-lg p-3">
            <p className="text-xs text-slate-400 mb-1">语义缓存命中率</p>
            <p className="text-lg font-semibold text-amber-600">11%</p>
            <p className="text-xs text-slate-400 mt-1">目标 ≥ 15%，低于预期，建议排查阈值标定</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
