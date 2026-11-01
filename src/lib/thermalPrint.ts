import { BRAND_ADDRESS, BRAND_EN, BRAND_GSTIN, BRAND_PRIMARY_PHONE_DISPLAY } from './brand'
import { LOGO_BASE64 } from './logoBase64'
import { formatCurrency, formatInvoiceNo, getSizeFromUnit } from './retail'
import { printHtmlDocument } from './printHtml'

export interface ThermalReceiptData {
  invoiceNo: string
  date: string
  customerName?: string
  phone?: string
  items: Array<{
    name: string
    /** Size/variant shown in its own column. If omitted it is parsed from the name ("Shirt - 28" or "Shirt (28)"). */
    size?: string
    qty: number
    unit?: string
    price: number
    line_total?: number
  }>
  subtotal: number
  shipping: number
  couponDiscount?: number
  manualDiscount?: number
  totalGst?: number
  /** When either is set they replace the single GST row. */
  cgst?: number
  sgst?: number
  /** Extra lines under the Total (e.g. deposit paid / balance paid / remaining for advance orders). */
  paymentRows?: Array<{ label: string; value: number; sub?: boolean; accent?: boolean }>
  total: number
  storeName?: string
  storePhone?: string
  storeAddress?: string
  storeEmail?: string
}

const DASH_LINE = '<div style="white-space: nowrap; overflow: hidden; line-height: 1.2;">' + '-'.repeat(80) + '</div>'

const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Splits "LUKER - 28" / "LUKER (28)" into name + size. */
function splitNameAndSize(name: string, size?: string): { name: string; size: string } {
  const clean = String(name || '').trim()
  if (size && size.trim()) {
    const sz = size.trim()
    const stripped = clean
      .replace(new RegExp(`\\s*-\\s*${sz.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '')
      .replace(new RegExp(`\\s*\\(\\s*${sz.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)$`, 'i'), '')
    return { name: stripped || clean, size: sz }
  }
  const dash = clean.match(/^(.*\S)\s+-\s+([^-]+)$/)
  if (dash) return { name: dash[1].trim(), size: dash[2].trim() }
  const paren = clean.match(/^(.*\S)\s*\(([^()]+)\)$/)
  if (paren) return { name: paren[1].trim(), size: paren[2].trim() }
  return { name: clean, size: '' }
}

const money = (n: number) => (Number(n) || 0).toFixed(2)

export function printThermalReceipt(data: ThermalReceiptData) {
  try {
    const parsedDate = (() => {
      const d = new Date(data.date)
      return isNaN(d.getTime()) ? new Date() : d
    })()
    const dateOnly = parsedDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    const timeOnly = parsedDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

    const formatCustomerPhone = (phone?: string): string => {
      if (!phone) return ''
      const trimmed = phone.trim()
      const digits = trimmed.replace(/\D/g, '')
      if (digits.length === 12 && digits.startsWith('91')) {
        return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
      }
      if (digits.length === 10) {
        return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
      }
      return trimmed
    }

    const html = `
      <!DOCTYPE html>
      <html lang="en" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" spellcheck="false">
        <head>
          <meta charset="UTF-8">
          <meta name="grammarly" content="off">
          <meta name="robots" content="noindex,nofollow">
          <title>Receipt - ${data.invoiceNo}</title>
        <style>
          @page {
            margin: 0;
            size: 80mm auto;
          }
          body {
            font-family: 'Courier New', Courier, monospace, sans-serif;
            font-size: 13px;
            color: #000;
            font-weight: 700;
            -webkit-text-stroke: 0.35px #000;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            margin: 0;
            padding: 4mm;
            width: 80mm;
            box-sizing: border-box;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .text-left { text-align: left; }
          .font-bold { font-weight: 900; }
          .mb-1 { margin-bottom: 4px; }
          .mb-2 { margin-bottom: 8px; }
          .mt-1 { margin-top: 4px; }
          .mt-2 { margin-top: 8px; }
          .border-bottom { border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 4px; }
          .border-top { border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 2px 0; vertical-align: top; color: #000; font-weight: 700; }
          th { font-weight: 900; }
          .item-name { font-size: 11px; padding-right: 4px; }
        </style>
      </head>
      <body>
        <div class="text-center mb-2">
          <!-- Logo artwork includes its own wording; crop to the stag/wings so the heading below isn't repeated -->
          <div style="width: 44mm; height: 21mm; overflow: hidden; margin: 0 auto 2px auto; position: relative;">
            <img src="${LOGO_BASE64}" style="position: absolute; left: 0; top: -4.3mm; width: 44mm; height: 44mm;" alt="Universal Look Logo" />
          </div>
          <div style="font-family: Arial, Helvetica, sans-serif; font-size: 22px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase; line-height: 1.1; margin-bottom: 4px;">${BRAND_EN}</div>
          <div style="font-size: 13px; line-height: 1.3;">${escapeHtml(data.storeAddress || BRAND_ADDRESS).replace(/\s+(Chennai)/i, '<br>$1')}</div>
          <div style="font-size: 13px; line-height: 1.3;">Phone: ${BRAND_PRIMARY_PHONE_DISPLAY}</div>
          <div style="font-size: 13px; line-height: 1.3;">GSTIN: ${BRAND_GSTIN}</div>
        </div>

        ${DASH_LINE}
        <div style="font-size: 13px; line-height: 1.3; margin: 4px 0;">
          <div>Invoice No: #${formatInvoiceNo(data.invoiceNo)}</div>
          ${data.customerName ? `<div>Customer Name: ${escapeHtml(data.customerName)}</div>` : ''}
          ${data.phone ? `<div>Tel: ${formatCustomerPhone(data.phone)}</div>` : ''}
          <div>Date: ${dateOnly}</div>
          <div>Time: ${timeOnly.toLowerCase()}</div>
        </div>
        ${DASH_LINE}

        <table style="width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr>
              <th style="width: 27%; text-align: left;">Item</th>
              <th style="width: 15%; text-align: left;">Size</th>
              <th style="width: 10%; text-align: right;">Qty</th>
              <th style="width: 23%; text-align: right;">Rate</th>
              <th style="width: 25%; text-align: right;">Amount</th>
            </tr>
          </thead>
        </table>
        ${DASH_LINE}
        <table style="width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 13px;">
          <tbody>
            ${data.items.map(item => {
              const lineTotal = item.line_total ?? (item.qty * item.price)
              const { name, size } = splitNameAndSize(item.name, item.size || getSizeFromUnit(item.unit))
              return `
                <tr>
                  <td style="width: 27%; text-align: left; word-break: break-word; padding-right: 2px;">${escapeHtml(name)}</td>
                  <td style="width: 15%; text-align: left; word-break: break-word;">${escapeHtml(size)}</td>
                  <td style="width: 10%; text-align: right;">${item.qty}</td>
                  <td style="width: 23%; text-align: right;">${money(item.price)}</td>
                  <td style="width: 25%; text-align: right;">${money(lineTotal)}</td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
        ${DASH_LINE}

        <table style="width: 100%; font-size: 13px; margin: 2px 0;">
          ${data.subtotal !== data.total ? `<tr><td class="text-right">Subtotal: ${formatCurrency(data.subtotal)}</td></tr>` : ''}
          ${(data.couponDiscount || 0) > 0 ? `<tr><td class="text-right">Coupon: -${formatCurrency(data.couponDiscount || 0)}</td></tr>` : ''}
          ${(data.manualDiscount || 0) > 0 ? `<tr><td class="text-right">Manual Disc.: -${formatCurrency(data.manualDiscount || 0)}</td></tr>` : ''}
          ${(data.cgst || 0) > 0 || (data.sgst || 0) > 0 ? `
            <tr><td class="text-right">CGST: +${formatCurrency(data.cgst || 0)}</td></tr>
            <tr><td class="text-right">SGST: +${formatCurrency(data.sgst || 0)}</td></tr>
          ` : (data.totalGst || 0) > 0 ? `<tr><td class="text-right">GST: +${formatCurrency(data.totalGst || 0)}</td></tr>` : ''}
          ${data.shipping > 0 ? `<tr><td class="text-right">Delivery: ${formatCurrency(data.shipping)}</td></tr>` : ''}
          <tr><td class="text-right" style="font-size: 17px; font-weight: 900;">Total Amount: ${formatCurrency(data.total)}</td></tr>
          ${(data.paymentRows || []).map(row => `
            <tr><td class="text-right" style="${row.accent ? 'font-weight: 900;' : ''}">${escapeHtml(row.label)}: ${formatCurrency(row.value)}</td></tr>
          `).join('')}
        </table>
        ${DASH_LINE}

        <div class="text-center mt-2" style="font-size: 13px;">
          <div class="font-bold">Thank you for shopping at UNIVERSAL LOOK!</div>
        </div>
      </body>
    </html>
  `

    printHtmlDocument(html)
  } catch (err) {
    console.warn('[thermalPrint] Failed to print receipt:', err)
  }
}
