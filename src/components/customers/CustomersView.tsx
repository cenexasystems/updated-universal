import React, { useEffect, useMemo, useState } from 'react'
import { Users, Search, MessageCircle, ChevronLeft, Ticket, Save, Download } from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { normalizePhoneForWhatsApp, toWhatsAppUrl, formatPhoneDisplay } from '../../lib/phone'
import { formatCurrency } from '../../lib/retail'
import { downloadCsv } from '../../lib/exportCsv'

interface OrderRow {
  id: string
  invoice_no: string
  customer_name: string | null
  phone: string | null
  created_at: string
  total: number | string | null
  status: string | null
  coupon_code: string | null
  items: unknown
}

interface CouponRow {
  id: number
  code: string
  percentage: number
  expiry_date: string | null
  min_order_value: number
}

interface Customer {
  key: string
  name: string
  phone: string
  visits: number
  totalSpent: number
  lastVisit: string
  orders: OrderRow[]
}

const TEMPLATE_KEY = 'universallook_coupon_template_v1'
const DEFAULT_TEMPLATE =
  'Hi {name}! 🎁\n\nThank you for shopping with Universal Look. Here is a special coupon just for you:\n\n🎟️ Code: {code}\n💰 {discount}\n{expiry}\nShow this code at billing to redeem.\n\n– Universal Look'

type SortKey = 'recent' | 'spent' | 'visits' | 'name'

const card = 'bg-white rounded-2xl border border-gray-200 shadow-sm'
const input = 'w-full h-10 px-3 bg-white border border-gray-200 rounded-xl text-[13px] font-bold text-[#111111] focus:outline-none focus:border-[#D4AF37]'

const readTemplate = () => { try { return localStorage.getItem(TEMPLATE_KEY) || DEFAULT_TEMPLATE } catch { return DEFAULT_TEMPLATE } }
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

const itemSummary = (items: unknown): string => {
  if (!Array.isArray(items)) return ''
  return items
    .map((i: Record<string, unknown>) => {
      const name = String(i.product_name || i.name || 'Item')
      const qty = Number(i.quantity ?? i.qty ?? 1)
      return qty > 1 ? `${name} ×${qty}` : name
    })
    .join(', ')
}

export const buildCouponMessage = (template: string, name: string, coupon: CouponRow | undefined, extra: string) => {
  const discount = coupon
    ? `${coupon.percentage}% OFF${coupon.min_order_value > 0 ? ` on orders above ${formatCurrency(coupon.min_order_value)}` : ''}`
    : ''
  const expiry = coupon?.expiry_date ? `⏳ Valid till ${fmtDate(coupon.expiry_date)}\n` : ''
  return template
    .replace(/\{name\}/g, name.trim() || 'Customer')
    .replace(/\{code\}/g, coupon?.code || '')
    .replace(/\{discount\}/g, discount)
    .replace(/\{expiry\}\n?/g, expiry)
    + (extra.trim() ? `\n\n${extra.trim()}` : '')
}

export const CustomersView: React.FC = () => {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [coupons, setCoupons] = useState<CouponRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [selected, setSelected] = useState<string | null>(null)
  const [couponId, setCouponId] = useState<number | ''>('')
  const [template, setTemplate] = useState(readTemplate)
  const [dirty, setDirty] = useState(false)
  const [extra, setExtra] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!isSupabaseConfigured) { setError('Customer data requires a live connection'); setLoading(false); return }
      // Page through orders so large histories aren't cut off at the API row limit
      const all: OrderRow[] = []
      const PAGE = 1000
      for (let from = 0; from < 20000; from += PAGE) {
        const { data, error: err } = await supabase.from('orders')
          .select('id, invoice_no, customer_name, phone, created_at, total, status, coupon_code, items')
          .neq('order_type', 'online_request')
          .order('created_at', { ascending: false })
          .range(from, from + PAGE - 1)
        if (err) { if (!cancelled) setError(err.message); break }
        all.push(...((data || []) as OrderRow[]))
        if (!data || data.length < PAGE) break
      }
      const { data: cps } = await supabase.from('coupons')
        .select('id, code, percentage, expiry_date, min_order_value')
        .eq('is_active', true).order('created_at', { ascending: false })
      if (cancelled) return
      setOrders(all)
      const now = Date.now()
      const live = ((cps || []) as CouponRow[]).filter(c => !c.expiry_date || new Date(c.expiry_date).getTime() > now)
      setCoupons(live)
      setCouponId(live[0]?.id ?? '')
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const customers = useMemo<Customer[]>(() => {
    const map = new Map<string, Customer>()
    for (const o of orders) {
      const key = normalizePhoneForWhatsApp(o.phone || '')
      if (key.length < 10) continue // walk-ins without a usable number can't be contacted
      const cancelled = (o.status || '').toLowerCase() === 'cancelled'
      let c = map.get(key)
      if (!c) {
        c = { key, name: '', phone: key, visits: 0, totalSpent: 0, lastVisit: o.created_at, orders: [] }
        map.set(key, c)
      }
      c.orders.push(o)
      // orders arrive newest-first, so the first real name seen is the most recent
      if (!c.name && o.customer_name && !/^(walk-in )?customer$/i.test(o.customer_name.trim())) c.name = o.customer_name.trim()
      if (!cancelled) { c.visits += 1; c.totalSpent += Number(o.total || 0) }
    }
    return [...map.values()]
  }, [orders])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    const list = customers.filter(c =>
      !q
      || c.name.toLowerCase().includes(q)
      || (qDigits.length >= 3 && c.phone.includes(qDigits))
      || c.orders.some(o =>
        o.invoice_no.toLowerCase().includes(q)
        || (o.coupon_code || '').toLowerCase().includes(q)
        || itemSummary(o.items).toLowerCase().includes(q)))
    const sorters: Record<SortKey, (a: Customer, b: Customer) => number> = {
      recent: (a, b) => b.lastVisit.localeCompare(a.lastVisit),
      spent: (a, b) => b.totalSpent - a.totalSpent,
      visits: (a, b) => b.visits - a.visits,
      name: (a, b) => (a.name || '~').localeCompare(b.name || '~'),
    }
    return list.sort(sorters[sort])
  }, [customers, search, sort])

  const current = customers.find(c => c.key === selected) || null
  const coupon = coupons.find(c => c.id === couponId)

  const send = (c: Customer) => {
    window.open(toWhatsAppUrl(c.phone, buildCouponMessage(template, c.name, coupon, extra)), '_blank', 'noopener')
  }
  const saveTemplate = () => { try { localStorage.setItem(TEMPLATE_KEY, template) } catch { /* ignore */ } setDirty(false) }

  const exportCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const rows = [['Customer', 'Mobile', 'Visits', 'Total Spent', 'Last Visit'],
      ...visible.map(c => [c.name || 'Customer', `\t+${c.phone}`, c.visits, c.totalSpent.toFixed(2), fmtDate(c.lastVisit)])]
    void downloadCsv('customers.csv', rows.map(r => r.map(esc).join(',')).join('\n'))
  }

  const couponPanel = (
    <div className={`${card} p-4 md:p-5`}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-[#FDF6E3] flex items-center justify-center text-[#B38018]"><Ticket size={18} /></div>
        <div className="flex-1">
          <h3 className="text-[15px] font-black text-[#111111]">Send coupon</h3>
          <p className="text-[11px] text-gray-500">Opens WhatsApp with your message ready to send.</p>
        </div>
        <button type="button" onClick={saveTemplate} disabled={!dirty}
          className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] font-black bg-[#111111] text-[#D4AF37] disabled:bg-gray-200 disabled:text-gray-400">
          <Save size={14} /> Save
        </button>
      </div>

      <p className="text-[10px] font-black text-[#6B7280] mb-1">SELECT COUPON</p>
      {coupons.length ? (
        <select className={`${input} mb-4`} value={couponId} onChange={e => setCouponId(Number(e.target.value))}>
          {coupons.map(c => <option key={c.id} value={c.id}>{c.code} — {c.percentage}% OFF</option>)}
        </select>
      ) : (
        <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">No active coupons. Create one in the Coupons tab first.</p>
      )}

      <p className="text-[10px] font-black text-[#6B7280] mb-1">CUSTOMIZE MESSAGE</p>
      <textarea rows={7} value={template} onChange={e => { setTemplate(e.target.value); setDirty(true) }}
        className="w-full p-3 border border-gray-200 rounded-xl text-[13px] font-semibold text-[#111111] focus:outline-none focus:border-[#D4AF37]" />
      <p className="text-[10px] text-gray-500 mt-1 mb-3">
        Use <b>{'{name}'}</b>, <b>{'{code}'}</b>, <b>{'{discount}'}</b> and <b>{'{expiry}'}</b>.
      </p>

      <p className="text-[10px] font-black text-[#6B7280] mb-1">EXTRA NOTE (THIS SEND ONLY)</p>
      <input className={`${input} mb-4`} value={extra} onChange={e => setExtra(e.target.value)} placeholder="e.g. New arrivals this weekend!" />

      <div className="rounded-xl bg-[#F3F9F1] border border-green-200 p-4">
        <p className="text-[10px] font-black text-[#6B7280] mb-2">MESSAGE PREVIEW</p>
        <p className="text-[13px] text-[#111111] whitespace-pre-wrap">
          {buildCouponMessage(template, current?.name || visible[0]?.name || 'Aarav', coupon, extra)}
        </p>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-[#FDF6E3] flex items-center justify-center text-[#B38018]"><Users size={22} /></div>
        <div className="flex-1">
          <h2 className="text-xl font-black text-[#111111]">Customers</h2>
          <p className="text-[12px] font-medium text-gray-500">Purchase history &amp; coupon sender ({customers.length} customers)</p>
        </div>
        <button type="button" onClick={exportCsv} disabled={!visible.length}
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-green-50 text-green-700 text-[11px] font-black disabled:opacity-40"><Download size={13} /> Export CSV</button>
      </div>

      {error && <p className="text-[12px] font-bold text-red-600">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        <div className={`${card} p-3 md:p-4 ${current ? 'hidden lg:block' : ''}`}>
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className={`${input} pl-9`} placeholder="Search name, mobile, invoice, product or coupon…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className={`${input} sm:w-44`} value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="Sort customers">
              <option value="recent">Most recent</option>
              <option value="spent">Highest spend</option>
              <option value="visits">Most visits</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>

          {loading ? <p className="text-[12px] text-gray-500 p-3">Loading…</p>
            : !visible.length ? <p className="text-[12px] text-gray-500 p-3">No customers found.</p>
            : (
              <div className="divide-y divide-gray-100">
                {visible.slice(0, 200).map(c => (
                  <div key={c.key} className={`flex items-center gap-3 py-2.5 px-2 rounded-lg cursor-pointer hover:bg-gray-50 ${selected === c.key ? 'bg-[#FDF6E3]' : ''}`}
                    onClick={() => setSelected(c.key)}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-black text-[#111111] truncate">{c.name || 'Customer'}</p>
                      <p className="text-[11px] text-gray-500">{formatPhoneDisplay(c.phone)} · {c.visits} visit{c.visits === 1 ? '' : 's'} · last {fmtDate(c.lastVisit)}</p>
                    </div>
                    <p className="text-[13px] font-black text-[#111111] shrink-0">{formatCurrency(c.totalSpent)}</p>
                    <button type="button" aria-label={`Send coupon to ${c.name || c.phone}`} disabled={!coupon}
                      onClick={e => { e.stopPropagation(); send(c) }}
                      className="flex items-center gap-1 px-3 h-8 rounded-lg bg-[#059669] text-white text-[10px] font-black uppercase disabled:opacity-40 shrink-0">
                      <MessageCircle size={13} /> Coupon
                    </button>
                  </div>
                ))}
                {visible.length > 200 && <p className="text-[11px] text-gray-500 p-3">Showing first 200 of {visible.length}. Use search to narrow down.</p>}
              </div>
            )}
        </div>

        <div className="space-y-4">
          {current && (
            <div className={`${card} p-4 md:p-5`}>
              <button type="button" onClick={() => setSelected(null)} className="lg:hidden flex items-center gap-1 text-[12px] font-black text-[#B38018] mb-3"><ChevronLeft size={14} /> All customers</button>
              <h3 className="text-[16px] font-black text-[#111111]">{current.name || 'Customer'}</h3>
              <p className="text-[12px] text-gray-500 mb-3">{formatPhoneDisplay(current.phone)}</p>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {[['Visits', String(current.visits)], ['Spent', formatCurrency(current.totalSpent)],
                  ['Avg bill', formatCurrency(current.visits ? current.totalSpent / current.visits : 0)]].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-gray-50 border border-gray-100 p-2 text-center">
                    <p className="text-[9px] font-black text-[#6B7280] uppercase">{k}</p>
                    <p className="text-[13px] font-black text-[#111111]">{v}</p>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => send(current)} disabled={!coupon}
                className="w-full h-10 mb-4 flex items-center justify-center gap-1.5 rounded-xl bg-[#059669] text-white text-[12px] font-black uppercase disabled:opacity-40">
                <MessageCircle size={14} /> Send coupon on WhatsApp
              </button>
              <p className="text-[10px] font-black text-[#6B7280] mb-1">PURCHASE HISTORY ({current.orders.length})</p>
              <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
                {current.orders.map(o => (
                  <div key={o.id} className="py-2">
                    <div className="flex justify-between gap-2 text-[12px]">
                      <span className="font-black text-[#111111]">{o.invoice_no} · {fmtDate(o.created_at)}</span>
                      <span className="font-black">{formatCurrency(Number(o.total || 0))}</span>
                    </div>
                    <p className="text-[11px] text-gray-500 truncate">{itemSummary(o.items) || '—'}</p>
                    {(o.coupon_code || (o.status || '').toLowerCase() === 'cancelled') && (
                      <p className="text-[10px] font-bold text-[#B38018]">
                        {o.coupon_code ? `Coupon ${o.coupon_code}` : ''}{o.coupon_code && (o.status || '').toLowerCase() === 'cancelled' ? ' · ' : ''}
                        {(o.status || '').toLowerCase() === 'cancelled' ? 'Cancelled' : ''}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {couponPanel}
        </div>
      </div>
    </div>
  )
}
