import AfterSalesRefundForm from './tickets/AfterSalesRefundForm.jsx'
import ComplaintForm from './tickets/ComplaintForm.jsx'
import InquiryForm from './tickets/InquiryForm.jsx'
import TechnicalIssueForm from './tickets/TechnicalIssueForm.jsx'

const FORM_MAP = {
  after_sales_refund: AfterSalesRefundForm,
  complaint:          ComplaintForm,
  inquiry:            InquiryForm,
  technical_issue:    TechnicalIssueForm,
}

const TYPE_LABELS = {
  after_sales_refund: '售后退款',
  complaint:          '投诉建议',
  inquiry:            '问题咨询',
  technical_issue:    '技术问题',
}

function parsePrefill(raw) {
  if (!raw) return {}
  try {
    return JSON.parse(atob(raw))
  } catch {
    return {}
  }
}

export default function TicketNew() {
  const params = new URLSearchParams(window.location.search)
  const type = params.get('type') || 'inquiry'
  const sessionId = params.get('session') || null
  const prefill = parsePrefill(params.get('prefill'))
  const Form = FORM_MAP[type] ?? InquiryForm
  const label = TYPE_LABELS[type] ?? '提交工单'

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 w-full max-w-md p-6">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-slate-800">{label}</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            填写表单后提交，客服将尽快与您联系
          </p>
          {Object.keys(prefill).length > 0 && (
            <p className="text-xs text-indigo-400 mt-1">部分信息已由 AI 预填，请核对后提交</p>
          )}
        </div>
        <Form sessionId={sessionId} prefill={prefill} />
      </div>
    </div>
  )
}
