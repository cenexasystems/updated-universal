import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, CheckCircle2, Clock3, Download, Eye, FileText, MessageCircle, PackageCheck, Printer, RefreshCw, Search, X, Trash2 } from 'lucide-react'
import { formatCurrency } from '../lib/retail'
import SplitPaymentInputs from '../components/common/SplitPaymentInputs'
import { emptySplitInput, formatPaymentLabel, splitInputToDetails, splitTotal, type SplitInputValue } from '../lib/payments'
import { invoicePdfFile } from '../lib/invoicePdf'
import { printThermalReceipt } from '../lib/thermalPrint'
import { buildAdvanceDepositWhatsAppMessage, buildProfessionalWhatsAppMessage, publicInvoiceUrl } from '../lib/whatsappMessage'
import { formatPhoneDisplay, toWhatsAppUrl } from '../lib/phone'
import { advanceReceiptPdf, downloadFile, printAdvanceReceipt } from '../lib/advanceReceipt'
import { useAdminAuthStore, useProductStore } from '../store/store'
import {
  addAdvanceEvent, completeAdvanceOrder, createAdvanceOrder, getAdvanceOrderHistory, listAdvanceOrders, updateAdvanceStatus, deleteAdvanceOrder,
  type AdvanceOrder, type AdvancePayment, type AdvancePaymentMethod, type AdvanceStatus, type AdvanceTimeline,
} from '../services/advanceOrderService'

// Custom Malaysian Ringgit icon
const RMIcon = ({ size = 20, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-label="Malaysian Ringgit">
    <rect x="2" y="2" width="20" height="20" rx="4" />
    <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="bold" stroke="none" fill="currentColor" fontFamily="Arial, sans-serif">₹</text>
  </svg>
)

type DateFilter = 'all' | 'today' | 'week' | 'month'
type StatusFilter = 'all' | 'pending' | 'ready' | 'completed' | 'cancelled'

const STATUS_LABELS: Record<AdvanceStatus, string> = {
  pending_deposit: 'Pending Deposit', ready_for_delivery: 'Ready for Delivery', waiting_final_payment: 'Waiting for Final Payment', completed: 'Completed', cancelled: 'Cancelled',
}
const STATUS_STYLES: Record<AdvanceStatus, string> = {
  pending_deposit: 'bg-amber-50 text-amber-700 border-amber-200', ready_for_delivery: 'bg-gray-50 text-gray-700 border-gray-200',
  waiting_final_payment: 'bg-gray-50 text-gray-700 border-gray-200', completed: 'bg-emerald-50 text-emerald-700 border-emerald-200', cancelled: 'bg-red-50 text-red-700 border-red-200',
}
const initialForm = { customerName: '', phone: '', address: '', productName: '', category: '', description: '', totalAmount: '', depositAmount: '', expectedDeliveryDate: '', status: 'pending_deposit' as AdvanceStatus, remarks: '', reference_number: '', paymentMethod: 'cash' as AdvancePaymentMethod }
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

type AdvanceOrdersProps = {
  onOrderCompleted?: (order?: AdvanceOrder) => void
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) { return <label htmlFor={htmlFor} className="block"><span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-[#6B7280]">{label}</span>{children}</label> }
const inputClass = 'w-full rounded-xl border border-[#F3F4F6] bg-white px-3.5 py-2.5 text-sm text-[#1F1F1F] outline-none transition focus:border-[#6B7280] focus:ring-2 focus:ring-gray-100'

export default function AdvanceOrders({ onOrderCompleted }: AdvanceOrdersProps = {}) {
  const role = useAdminAuthStore(state => state.role)
  const products = useProductStore(state => state.products)
  const [orders, setOrders] = useState<AdvanceOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [selected, setSelected] = useState<AdvanceOrder | null>(null)
  const [timeline, setTimeline] = useState<AdvanceTimeline[]>([])
  const [payments, setPayments] = useState<AdvancePayment[]>([])
  const [paymentOrder, setPaymentOrder] = useState<AdvanceOrder | null>(null)
  const [paymentForm, setPaymentForm] = useState({ method: 'cash' as AdvancePaymentMethod, remarks: '' })
  const [depositSplit, setDepositSplit] = useState<SplitInputValue>(emptySplitInput())
  const [finalSplit, setFinalSplit] = useState<SplitInputValue>(emptySplitInput())

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setOrders(await listAdvanceOrders()) } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load advance orders') } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const handleDeleteOrder = async (orderId: string, orderName: string) => {
    if (role === 'staff') return // staff cannot delete advance orders
    if (!window.confirm(`Are you sure you want to delete advance order "${orderName}"? This action cannot be undone.`)) return
    try {
      await deleteAdvanceOrder(orderId)
      setOrders(orders => orders.filter(o => o.id !== orderId))
      setNotice('Order deleted successfully')
      setTimeout(() => setNotice(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete order')
    }
  }

  // Close modals or drawer on Escape key
  useEffect(() => {
    if (!selected && !createOpen && !paymentOrder) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selected) setSelected(null)
        else if (paymentOrder) setPaymentOrder(null)
        else if (createOpen) setCreateOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selected, createOpen, paymentOrder])

  // Prevent background scroll when modal or drawer is open
  useEffect(() => {
    const isAnyOpen = !!(selected || createOpen || paymentOrder)
    if (isAnyOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [selected, createOpen, paymentOrder])

  const openDetails = async (order: AdvanceOrder) => {
    setSelected(order); setTimeline([]); setPayments([])
    try { const history = await getAdvanceOrderHistory(order.id); setTimeline(history.timeline); setPayments(history.payments) } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load order details') }
  }

  const analytics = useMemo(() => ({
    total: orders.length,
    pending: orders.filter(o => o.status === 'pending_deposit' || o.status === 'waiting_final_payment').length,
    deposits: orders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.deposit_amount, 0),
    outstanding: orders.filter(o => !['completed', 'cancelled'].includes(o.status)).reduce((sum, o) => sum + o.remaining_balance, 0),
    ready: orders.filter(o => o.status === 'ready_for_delivery').length,
    completed: orders.filter(o => o.status === 'completed').length,
  }), [orders])

  const filtered = useMemo(() => orders.filter(order => {
    const query = search.trim().toLowerCase()
    const searchable = [order.deposit_id, order.customer_name, order.phone, order.product_name, STATUS_LABELS[order.status]].join(' ').toLowerCase()
    if (query && !searchable.includes(query)) return false
    if (statusFilter === 'pending' && !['pending_deposit', 'waiting_final_payment'].includes(order.status)) return false
    if (statusFilter === 'ready' && order.status !== 'ready_for_delivery') return false
    if (statusFilter === 'completed' && order.status !== 'completed') return false
    if (statusFilter === 'cancelled' && order.status !== 'cancelled') return false
    if (dateFilter !== 'all') {
      const created = new Date(order.created_at); const now = new Date()
      if (dateFilter === 'today' && dateKey(created) !== dateKey(now)) return false
      if (dateFilter === 'week' && created < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)) return false
      if (dateFilter === 'month' && (created.getMonth() !== now.getMonth() || created.getFullYear() !== now.getFullYear())) return false
    }
    return true
  }), [orders, search, statusFilter, dateFilter])

  const create = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    const total = Number(form.totalAmount); const deposit = Number(form.depositAmount)
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(deposit) || deposit <= 0 || deposit >= total) { setError('Deposit must be greater than RM0 and less than the total order amount.'); setSaving(false); return }
    if (form.paymentMethod === 'split' && Math.abs(splitTotal(splitInputToDetails(depositSplit)) - deposit) >= 0.01) { setError(`Split amounts must add up to the deposit of ${formatCurrency(deposit)}.`); setSaving(false); return }
    try {
      const created = await createAdvanceOrder({ ...form, splitDetails: form.paymentMethod === 'split' ? splitInputToDetails(depositSplit) : undefined, totalAmount: total, depositAmount: deposit, referenceNumber: form.reference_number, createdByName: role || 'Staff', products: [{ name: form.productName, category: form.category, description: form.description, quantity: 1, base_price: total, line_total: total, unit: 'piece', unit_type: 'unit', source: 'advance_order' }] })
      setOrders(current => [created, ...current]); setForm(initialForm); setDepositSplit(emptySplitInput()); setCreateOpen(false); setNotice(`${created.deposit_id} created. Deposit is tracked separately and has not been added to revenue.`)

      // Redirect to WhatsApp with advance deposit receipt
      const advanceMsg = buildAdvanceDepositWhatsAppMessage({
        customerName: created.customer_name,
        depositId: created.deposit_id,
        productName: created.product_name,
        totalAmount: created.total_amount,
        depositAmount: created.deposit_amount,
        remainingBalance: created.remaining_balance,
        expectedDeliveryDate: created.expected_delivery_date,
        paymentMethod: form.paymentMethod === 'split' ? formatPaymentLabel('split', splitInputToDetails(depositSplit)) : form.paymentMethod,
      })
      window.open(toWhatsAppUrl(created.phone, advanceMsg), '_blank', 'noopener,noreferrer')
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to create advance order') } finally { setSaving(false) }
  }

  const changeStatus = async (order: AdvanceOrder, status: AdvanceStatus) => {
    if (order.status === 'cancelled') {
      setError('A cancelled order cannot be modified.')
      return
    }
    if (order.status === 'completed' || order.invoice_number || order.completed_order_id) {
      setError('This order is already completed and has an official invoice.')
      return
    }
    if (status === 'completed') { setPaymentOrder(order); return }
    try { const updated = await updateAdvanceStatus(order.id, status); setOrders(rows => rows.map(row => row.id === order.id ? updated : row)); if (selected?.id === order.id) void openDetails(updated) } catch (err) { setError(err instanceof Error ? err.message : 'Unable to update status') }
  }

  const finalAmountFor = (order: AdvanceOrder) => order.remaining_balance

  const receivePayment = async (event: FormEvent) => {
    event.preventDefault(); if (!paymentOrder) return; setSaving(true); setError('')
    try {
      const finalAmount = paymentOrder.remaining_balance
      if (paymentForm.method === 'split' && Math.abs(splitTotal(splitInputToDetails(finalSplit)) - finalAmount) >= 0.01) {
        setError(`Split amounts must add up to the final amount of ${formatCurrency(finalAmount)}.`); setSaving(false); return
      }
      const remarksWithCoupon = paymentForm.remarks
      const result = await completeAdvanceOrder(
        paymentOrder.id, 
        paymentForm.method, 
        finalAmount,
        null,
        0,
        0,
        remarksWithCoupon,
        paymentForm.method === 'split' ? splitInputToDetails(finalSplit) : undefined
      )
      const completed: AdvanceOrder = { ...paymentOrder, status: 'completed', remaining_balance: finalAmount, completed_at: result.completed_at, completed_order_id: result.order_id, invoice_number: result.invoice_no, final_payment_method: paymentForm.method, split_details: result.split_details }
      setOrders(rows => rows.map(row => row.id === completed.id ? completed : row)); onOrderCompleted?.(completed); setPaymentOrder(null); setPaymentForm({ method: 'cash', remarks: '' }); setFinalSplit(emptySplitInput()); setNotice(`${result.invoice_no} generated once. The full ${formatCurrency(completed.total_amount)} is now recognized as revenue.`)

      // Redirect to WhatsApp with final invoice URL + Instagram + Feedback form
      whatsappInvoice(completed)
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to complete payment') } finally { setSaving(false) }
  }

  const productRows = (order: AdvanceOrder) => order.products.length ? order.products : [{ name: order.product_name, quantity: 1, base_price: order.total_amount, line_total: order.total_amount, unit: 'piece', unit_type: 'unit' }]
  const invoiceFile = (order: AdvanceOrder) => invoicePdfFile({ invoiceNo: order.invoice_number || order.deposit_id, date: order.completed_at || new Date().toISOString(), customerName: order.customer_name, phone: order.phone, address: order.address, items: productRows(order), subtotal: order.total_amount, shipping: 0, total: order.total_amount, paymentMode: order.final_payment_method || 'Paid' })
  const printFinal = (order: AdvanceOrder) => printThermalReceipt({ invoiceNo: order.invoice_number || order.deposit_id, date: order.completed_at || new Date().toISOString(), customerName: order.customer_name, phone: order.phone, items: productRows(order).map(item => ({ name: String(item.name || 'Product'), qty: Number(item.quantity || 1), unit: String(item.unit || 'piece'), price: Number(item.base_price || 0), line_total: Number(item.line_total || 0) })), subtotal: order.total_amount, shipping: 0, total: order.total_amount })
  
  const whatsappDepositReceipt = (order: AdvanceOrder) => {
    const message = buildAdvanceDepositWhatsAppMessage({
      customerName: order.customer_name,
      depositId: order.deposit_id,
      productName: order.product_name,
      totalAmount: order.total_amount,
      depositAmount: order.deposit_amount,
      remainingBalance: order.remaining_balance,
      expectedDeliveryDate: order.expected_delivery_date,
    })
    window.open(toWhatsAppUrl(order.phone, message), '_blank', 'noopener,noreferrer')
  }

  const whatsappInvoice = (order: AdvanceOrder) => {
    const invNum = order.invoice_number || order.deposit_id
    const message = buildProfessionalWhatsAppMessage({
      customerName: order.customer_name,
      phone: order.phone,
      invoiceNumber: invNum,
      invoiceUrl: publicInvoiceUrl(invNum),
    })
    window.open(toWhatsAppUrl(order.phone, message), '_blank', 'noopener,noreferrer')
  }

  const addEvent = async (order: AdvanceOrder, eventType: string, label: string) => {
    try { await addAdvanceEvent(order.id, eventType, label); await openDetails(order); setNotice(`${label} added to ${order.deposit_id}.`) } catch (err) { setError(err instanceof Error ? err.message : 'Unable to add timeline event') }
  }

  const cards = [
    ['Total Deposits', analytics.total, FileText, 'text-[#111111] bg-[#F9FAFB] border border-[#E5E7EB]'], ['Pending Deposit Orders', analytics.pending, Clock3, 'text-amber-700 bg-amber-50 border border-amber-200'],
    ['Total Deposit Amount', formatCurrency(analytics.deposits), RMIcon, 'text-[#B38018] bg-amber-50 border border-amber-200'], ['Outstanding Balance', formatCurrency(analytics.outstanding), RMIcon, 'text-red-700 bg-red-50 border border-red-200'],
    ['Ready For Collection', analytics.ready, PackageCheck, 'text-gray-700 bg-gray-50 border border-gray-200'], ['Completed Deposit Orders', analytics.completed, CheckCircle2, 'text-emerald-700 bg-emerald-50 border border-emerald-200'],
  ] as const

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.18em] text-[#B38018]">Separate from sales</p><h2 className="text-2xl font-black text-[#111111]">Advance Orders</h2><p className="mt-1 text-sm text-gray-500">Deposits never count as revenue. Full order value is recognized only after final payment.</p></div><div className="flex gap-2"><button onClick={() => void load()} className="rounded-xl border border-gray-200 bg-white p-3 text-gray-600 hover:text-[#111111] transition-colors cursor-pointer" title="Refresh"><RefreshCw size={18}/></button></div></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value, Icon, color]) => <div key={label} className="rounded-2xl border border-[#F3F4F6] bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-[11px] font-black uppercase tracking-wide text-gray-500">{label}</p><p className="mt-2 text-2xl font-black text-gray-900">{value}</p></div><div className={`rounded-xl p-3 ${color}`}><Icon size={21}/></div></div></div>)}</div>
    <div className="rounded-2xl border border-[#F3F4F6] bg-white p-4 shadow-sm"><div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]"><label className="relative"><Search className="absolute left-3 top-3 text-[#9CA3AF]" size={17}/><input className={`${inputClass} pl-10`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search Deposit ID, customer, phone, product or status"/></label><div className="flex flex-wrap gap-2">{(['all','pending','ready','completed','cancelled'] as StatusFilter[]).map(value => <button key={value} onClick={() => setStatusFilter(value)} className={`rounded-lg px-3 py-2 text-xs font-black capitalize transition-all cursor-pointer ${statusFilter === value ? 'bg-[#111111] text-[#D4AF37] shadow-xs' : 'bg-slate-100 text-gray-600 hover:bg-slate-200'}`}>{value}</button>)}</div><select className={inputClass} value={dateFilter} onChange={e => setDateFilter(e.target.value as DateFilter)}><option value="all">All Dates</option><option value="today">Today</option><option value="week">This Week</option><option value="month">This Month</option></select></div></div>
    <div className="overflow-hidden rounded-2xl border border-[#F3F4F6] bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-gray-200 text-[10px] font-black uppercase tracking-wider text-gray-600">
            <tr>
              {['Deposit ID / Created','Customer','Product','Total / Deposit / Balance','Delivery','Status','Actions'].map(h => (
                <th key={h} className="px-4 py-3.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-500">Loading advance orders...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-500">No advance orders match these filters.</td></tr>
            ) : (
              filtered.map(order => (
                <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <p className="font-black text-[#111111]">{order.deposit_id}</p>
                    <p className="text-[11px] text-gray-500">
                      {new Date(order.created_at).toLocaleDateString('en-IN')} • {new Date(order.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <p className="font-bold text-gray-900">{order.customer_name}</p>
                    <p className="text-xs text-gray-500">{formatPhoneDisplay(order.phone)}</p>
                  </td>
                  <td className="max-w-[180px] px-4 py-3.5 align-middle">
                    <p className="truncate font-semibold text-gray-900">{order.product_name}</p>
                    <p className="truncate text-xs text-gray-500">{order.category || 'Uncategorised'}</p>
                  </td>
                  <td className="px-4 py-3.5 text-xs align-middle whitespace-nowrap">
                    <p className="text-gray-700">Total: <b>{formatCurrency(order.total_amount)}</b></p>
                    <p className="text-[#111111]">Paid: <b>{formatCurrency(order.deposit_amount)}</b></p>
                    <p className="text-red-600 font-bold">Balance: <b>{formatCurrency(order.remaining_balance)}</b></p>
                  </td>
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                      <CalendarDays size={14} className="text-gray-400 shrink-0" />
                      <span>{new Date(`${order.expected_delivery_date}T00:00:00`).toLocaleDateString('en-IN')}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <select
                      value={order.status}
                      disabled={order.status === 'completed' || order.status === 'cancelled' || !!order.invoice_number || !!order.completed_order_id}
                      onChange={e => void changeStatus(order, e.target.value as AdvanceStatus)}
                      className={`rounded-xl border px-2.5 py-1.5 text-xs font-black outline-none shadow-xs transition-colors cursor-pointer disabled:opacity-80 disabled:cursor-not-allowed ${STATUS_STYLES[order.status]}`}
                    >
                      <option value="pending_deposit">Pending Deposit</option>
                      <option value="waiting_final_payment">Waiting for Final Payment</option>
                      <option value="completed">Completed (receive payment)</option>
                      <option value="ready_for_delivery">Ready to Collect</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </td>
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {/* Receive Balance Button (strictly when no invoice exists, not completed, not cancelled, and pending/ready) */}
                      {!order.invoice_number &&
                        !order.completed_order_id &&
                        order.status !== 'completed' &&
                        order.status !== 'cancelled' &&
                        ['pending_deposit', 'waiting_final_payment', 'ready_for_delivery'].includes(order.status) && (
                        <button
                          type="button"
                          onClick={() => setPaymentOrder(order)}
                          className="flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 text-xs font-black shadow-xs transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                          title="Receive Remaining Balance"
                        >
                          <span>Receive Balance</span>
                        </button>
                      )}

                      {/* View Details Icon */}
                      <button
                        type="button"
                        onClick={() => void openDetails(order)}
                        className="w-8 h-8 rounded-lg bg-[#F9FAFB] hover:bg-gray-100 text-[#111111] flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title="View Details"
                      >
                        <Eye size={15}/>
                      </button>

                      {/* Delete Icon (admin only) */}
                      {role !== 'staff' && (
                        <button
                          type="button"
                          onClick={() => handleDeleteOrder(order.id, order.customer_name)}
                          className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-red-100 text-red-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                          title="Delete Order"
                        >
                          <Trash2 size={15}/>
                        </button>
                      )}

                      {/* Print Receipt / Invoice */}
                      <button
                        type="button"
                        onClick={() => order.status === 'completed' ? printFinal(order) : printAdvanceReceipt(order)}
                        className="w-8 h-8 rounded-lg bg-amber-50 hover:bg-amber-100 text-[#B38018] flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title={order.status === 'completed' ? "Print Final Receipt" : "Print Advance Receipt"}
                      >
                        <Printer size={15}/>
                      </button>

                      {/* Download PDF Receipt / Invoice */}
                      <button
                        type="button"
                        onClick={() => downloadFile(order.status === 'completed' ? invoiceFile(order) : advanceReceiptPdf(order))}
                        className="w-8 h-8 rounded-lg bg-[#F9FAFB] hover:bg-gray-100 text-[#111111] flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title={order.status === 'completed' ? "Download PDF Invoice" : "Download PDF Receipt"}
                      >
                        <Download size={15}/>
                      </button>

                      {/* WhatsApp Share */}
                      <button
                        type="button"
                        onClick={() => order.status === 'completed' ? whatsappInvoice(order) : whatsappDepositReceipt(order)}
                        className="w-8 h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title={order.status === 'completed' ? "Share Final Invoice via WhatsApp" : "Share Advance Receipt via WhatsApp"}
                      >
                        <MessageCircle size={15}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>

    {createOpen && createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
        <form onSubmit={create} className="max-h-full w-full max-w-4xl overflow-hidden overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl border border-[#F3F4F6]">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-black text-[#111111]">Create Advance Order</h3>
              <p className="text-xs text-amber-700">Creates an advance receipt only - no revenue or final invoice.</p>
            </div>
            <button type="button" onClick={() => setCreateOpen(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700 transition cursor-pointer">
              <X size={18} />
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Customer Name *" htmlFor="adv-customer-name"><input id="adv-customer-name" name="customerName" autoComplete="name" required className={inputClass} value={form.customerName} onChange={e=>setForm({...form,customerName:e.target.value})}/></Field>
            <Field label="Phone Number *" htmlFor="adv-phone-number"><input id="adv-phone-number" name="phone" autoComplete="tel" required className={inputClass} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
            <Field label="Address" htmlFor="adv-address"><textarea id="adv-address" name="address" autoComplete="street-address" className={inputClass} value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></Field>
            <Field label="Product Name *" htmlFor="adv-product-name"><input id="adv-product-name" name="productName" required list="advance-products" className={inputClass} value={form.productName} onChange={e=>{const product=products.find(p=>p.name===e.target.value);setForm({...form,productName:e.target.value,category:product?.category||form.category})}}/><datalist id="advance-products">{products.map(p=><option key={p.id} value={p.name}/>)}</datalist></Field>
            <Field label="Category" htmlFor="adv-category"><input id="adv-category" name="category" className={inputClass} value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></Field>
            <Field label="Description" htmlFor="adv-description"><textarea id="adv-description" name="description" className={inputClass} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></Field>
            <Field label="Total Order Amount *" htmlFor="adv-total-amount"><input id="adv-total-amount" name="totalAmount" required min="0.01" step="0.01" type="number" className={inputClass} value={form.totalAmount} onChange={e=>setForm({...form,totalAmount:e.target.value})}/></Field>
            <Field label="Deposit Amount Received *" htmlFor="adv-deposit-amount"><input id="adv-deposit-amount" name="depositAmount" required min="0" step="0.01" type="number" className={inputClass} value={form.depositAmount} onChange={e=>setForm({...form,depositAmount:e.target.value})}/></Field>
            <Field label="Remaining Balance (automatic)"><div className="rounded-xl bg-[#F9FAFB] px-4 py-3 font-black text-[#111111] border border-[#F3F4F6]">{formatCurrency(Math.max(0, Number(form.totalAmount||0)-Number(form.depositAmount||0)))}</div></Field>
            <Field label="Deposit Payment Method" htmlFor="adv-payment-method"><select id="adv-payment-method" name="paymentMethod" className={inputClass} value={form.paymentMethod} onChange={e=>setForm({...form,paymentMethod:e.target.value as AdvancePaymentMethod})}><option value="cash">Cash</option><option value="upi">QR</option><option value="card">Card</option><option value="split">Split (Cash + QR)</option></select></Field>
            {form.paymentMethod === 'split' && (<div className="md:col-span-2"><SplitPaymentInputs idPrefix="adv-deposit-split" total={Number(form.depositAmount) || 0} value={depositSplit} onChange={setDepositSplit} /></div>)}
            <Field label="Expected Delivery Date *" htmlFor="adv-delivery-date"><input id="adv-delivery-date" name="deliveryDate" required type="date" className={inputClass} value={form.expectedDeliveryDate} onChange={e=>setForm({...form,expectedDeliveryDate:e.target.value})}/></Field>
            <Field label="Order Status" htmlFor="adv-status"><select id="adv-status" name="orderStatus" disabled className={inputClass} value="pending_deposit"><option value="pending_deposit">Pending Deposit</option></select></Field>
            <div className="md:col-span-2"><Field label="Reference Number" htmlFor="adv-reference-number"><input id="adv-reference-number" name="referenceNumber" className={inputClass} value={form.reference_number} onChange={e=>setForm({...form,reference_number:e.target.value})} placeholder="e.g. PO-001, booking ref (optional)"/></Field></div>
            <div className="md:col-span-2"><Field label="Remarks" htmlFor="adv-remarks"><textarea id="adv-remarks" name="remarks" className={inputClass} value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})} placeholder="e.g. special instructions, colour, size notes"/></Field></div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={()=>setCreateOpen(false)} className="rounded-xl border border-gray-200 px-5 py-2.5 font-bold cursor-pointer hover:bg-gray-50 transition text-gray-700">Cancel</button>
            <button disabled={saving} className="rounded-xl bg-[#111111] hover:bg-[#262626] px-5 py-2.5 font-black text-[#D4AF37] border border-[#D4AF37]/50 shadow-md disabled:opacity-50 cursor-pointer transition">{saving?'Creating...':'Create & Save Advance Receipt'}</button>
          </div>
        </form>
      </div>,
      document.body
    )}

    {paymentOrder && createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
        <form onSubmit={receivePayment} className="w-full max-w-md max-h-full overflow-hidden overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl border border-[#F3F4F6]">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-emerald-600 font-mono">{paymentOrder.deposit_id}</p>
              <h3 className="text-xl font-black text-[#111111]">Receive Remaining Payment</h3>
            </div>
            <button type="button" onClick={()=>setPaymentOrder(null)} className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700 transition cursor-pointer">
              <X size={16}/>
            </button>
          </div>
          <div className="mb-6 rounded-2xl bg-emerald-50 py-5 text-center">
            <p className="text-[11px] font-black uppercase tracking-widest text-emerald-600">Remaining Amount</p>
            <p className="mt-1 text-4xl font-black text-emerald-800">{formatCurrency(paymentOrder.remaining_balance)}</p>
          </div>
          <div className="space-y-4">
            <Field label="Payment Method">
              <select className={inputClass} value={paymentForm.method} onChange={e=>setPaymentForm({...paymentForm,method:e.target.value as AdvancePaymentMethod})}>
                <option value="cash">Cash</option>
                <option value="upi">QR</option>
                <option value="card">Card</option>
                <option value="split">Split (Cash + QR)</option>
              </select>
            </Field>
            {paymentForm.method === 'split' && (
              <SplitPaymentInputs idPrefix="adv-final-split" total={finalAmountFor(paymentOrder)} value={finalSplit} onChange={setFinalSplit} />
            )}
            <Field label="Payment Notes">
              <textarea className={inputClass} value={paymentForm.remarks} onChange={e=>setPaymentForm({...paymentForm,remarks:e.target.value})} placeholder="Notes about this payment (optional)"/>
            </Field>
            <p className="mt-2 rounded-xl bg-amber-50 p-3 text-[11px] font-semibold text-amber-800">Confirmation marks the order Completed, creates one official invoice, and recognizes the full {formatCurrency(paymentOrder.total_amount)} as revenue.</p>
            <button disabled={saving} className="mt-5 w-full rounded-xl bg-emerald-600 py-3.5 font-black text-white shadow-lg shadow-emerald-600/30 transition-transform active:scale-95 disabled:opacity-50 cursor-pointer hover:bg-emerald-700">
              {saving?'Processing...':'Confirm Final Payment'}
            </button>
          </div>
        </form>
      </div>,
      document.body
    )}

    {selected && createPortal(
      <div className="fixed inset-0 z-[9999] flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
        {/* Backdrop click dismiss */}
        <div className="absolute inset-0" onClick={() => setSelected(null)} />

        {/* Drawer Panel covering full view height */}
        <div className="relative z-10 h-full w-full max-w-xl bg-white shadow-2xl flex flex-col border-l border-[#F3F4F6] animate-in slide-in-from-right duration-200">
          {/* Sticky Drawer Header */}
          <div className="shrink-0 px-6 py-4 border-b border-[#D4AF37]/30 bg-[#111111] text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#262626] border border-[#D4AF37]/50 flex items-center justify-center text-[#D4AF37] shrink-0">
                <FileText size={18} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-[#B38018] tracking-wider font-mono">{selected.deposit_id}</span>
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${STATUS_STYLES[selected.status]}`}>
                    {STATUS_LABELS[selected.status]}
                  </span>
                </div>
                <h3 className="text-base font-black text-white tracking-wide">Order Details</h3>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer shrink-0"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          </div>

          {/* Scrollable Drawer Body */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-6">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Customer', selected.customer_name],
                ['Phone', formatPhoneDisplay(selected.phone)],
                ['Address', selected.address || '-'],
                ['Product', selected.product_name],
                ['Category', selected.category || '-'],
                ['Total', formatCurrency(selected.total_amount)],
                ['Deposit Paid', formatCurrency(selected.deposit_amount)],
                ['Remaining Balance', formatCurrency(selected.remaining_balance)],
                ['Delivery Date', new Date(`${selected.expected_delivery_date}T00:00:00`).toLocaleDateString('en-IN')],
                ['Created Date', new Date(selected.created_at).toLocaleDateString('en-IN')],
                ['Created Time', new Date(selected.created_at).toLocaleTimeString('en-IN')],
                ['Created By', selected.created_by_name || '-'],
                ['Current Status', STATUS_LABELS[selected.status]],
                ['Invoice Number', selected.invoice_number || 'Not generated'],
                ['Reference No', selected.reference_number || '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                  <p className="text-[10px] font-black uppercase text-gray-500">{k}</p>
                  <p className="mt-1 break-words text-sm font-bold text-gray-900">{v}</p>
                </div>
              ))}
            </div>

            {selected.remarks && (
              <div className="rounded-xl border border-gray-200 bg-[#F9FAFB] p-3.5">
                <p className="text-[10px] font-black uppercase text-[#111111]">Remarks</p>
                <p className="mt-1 text-sm text-gray-900 font-medium">{selected.remarks}</p>
              </div>
            )}

            {selected.description && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
                <p className="text-[10px] font-black uppercase text-gray-500">Description</p>
                <p className="mt-1 text-sm text-gray-800">{selected.description}</p>
              </div>
            )}

            <div>
              <h4 className="text-sm font-black text-gray-900">Quick Timeline Updates</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  ['order_confirmed', 'Order Confirmed'],
                  ['order_packed', 'Order Packed'],
                  ['ready_for_delivery', 'Ready for Delivery'],
                  ['customer_contacted', 'Customer Contacted'],
                  ['delivered', 'Delivered'],
                ].map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => void addEvent(selected, type, label)}
                    className="rounded-lg border border-gray-200 bg-[#F9FAFB] hover:bg-gray-100 px-3 py-2 text-xs font-black text-[#111111] transition cursor-pointer"
                  >
                    + {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-black text-gray-900">Payment History</h4>
              <div className="mt-2 space-y-2">
                {payments.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No payments recorded yet.</p>
                ) : (
                  payments.map((payment) => (
                    <div key={payment.id} className="flex justify-between items-center rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-sm">
                      <span className="font-bold capitalize text-emerald-900">{payment.payment_type} — {formatPaymentLabel(payment.payment_method, payment.split_details)}</span>
                      <span className="font-black text-emerald-800">{formatCurrency(Number(payment.amount))}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-black text-gray-900">Order Timeline</h4>
              <div className="mt-3 border-l-2 border-gray-200 pl-4 space-y-4">
                {timeline.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No timeline events recorded.</p>
                ) : (
                  timeline.map((event) => (
                    <div key={event.id} className="relative pb-2 before:absolute before:-left-[21px] before:top-1.5 before:h-2.5 before:w-2.5 before:rounded-full before:bg-[#111111]">
                      <p className="text-sm font-black text-gray-900">{event.label}</p>
                      <p className="text-xs text-gray-500">{new Date(event.created_at).toLocaleString('en-IN')}</p>
                      {event.remarks && <p className="mt-1 text-xs text-gray-600 bg-white/70 p-2 rounded-lg border border-gray-100">{event.remarks}</p>}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Sticky Drawer Footer */}
          <div className="shrink-0 px-6 py-4 border-t border-gray-200 bg-slate-50 flex items-center justify-between gap-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => downloadFile(selected.status === 'completed' ? invoiceFile(selected) : advanceReceiptPdf(selected))}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-100 cursor-pointer transition shadow-xs"
                title={selected.status === 'completed' ? 'Download PDF Invoice' : 'Download PDF Receipt'}
              >
                <Download size={14} /> PDF
              </button>
              <button
                type="button"
                onClick={() => selected.status === 'completed' ? whatsappInvoice(selected) : whatsappDepositReceipt(selected)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold hover:bg-emerald-100 cursor-pointer transition shadow-xs"
                title="Share via WhatsApp"
              >
                <MessageCircle size={14} /> WhatsApp
              </button>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="px-5 py-2 rounded-xl bg-[#111111] hover:bg-[#262626] text-[#D4AF37] text-xs font-black cursor-pointer transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
  </div>
}
