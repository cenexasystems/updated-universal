import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Printer, Copy, Check } from 'lucide-react'
import { BarcodeLabel } from './BarcodeLabel'
import { BRAND_EN } from '../../lib/brand'
import { getAllLabelSizes, getStoredBarcodeSettings, saveStoredBarcodeSettings } from '../../lib/barcode'
import { buildStickerHtml, buildStickerCss } from '../../lib/stickerPrint'

export interface BarcodePrintModalProps {
  isOpen: boolean
  onClose: () => void
  productName: string
  variantName?: string
  barcodeValue: string
  price: number
  mrp?: number | null
  defaultQuantity?: number
}

type LabelSizePreset = {
  name: string
  widthMm: number
  heightMm: number
  labelsPerRow: number
  horizontalGapMm: number
  verticalGapMm: number
}

const getAvailablePresets = (): LabelSizePreset[] => {
  const sizes = getAllLabelSizes()
  return sizes.map((s) => ({
    name: `${s.name} (${s.widthMm}mm × ${s.heightMm}mm${s.labelsPerRow > 1 ? ` × ${s.labelsPerRow} across` : ''})`,
    widthMm: s.widthMm,
    heightMm: s.heightMm,
    labelsPerRow: s.labelsPerRow || 1,
    horizontalGapMm: s.horizontalGapMm || 0,
    verticalGapMm: s.verticalGapMm || 0,
  }))
}

export const BarcodePrintModal: React.FC<BarcodePrintModalProps> = ({
  isOpen,
  onClose,
  productName,
  variantName,
  barcodeValue,
  price,
  mrp,
  defaultQuantity = 1,
}) => {
  const presets = getAvailablePresets()
  const [quantity, setQuantity] = useState<string>(String(defaultQuantity || 1))
  const [selectedPreset, setSelectedPreset] = useState<LabelSizePreset>(presets[0] || { name: 'Thermal Standard', widthMm: 50, heightMm: 25, labelsPerRow: 1, horizontalGapMm: 0, verticalGapMm: 0 })
  const [copied, setCopied] = useState(false)
  const [printerType, setPrinterType] = useState<'label' | 'regular'>(() => {
    return getStoredBarcodeSettings().printerType || 'label'
  })

  const handlePrinterTypeChange = (type: 'label' | 'regular') => {
    setPrinterType(type)
    const current = getStoredBarcodeSettings()
    saveStoredBarcodeSettings({ ...current, printerType: type })
  }

  // Close on Escape key & lock body scrolling when open
  useEffect(() => {
    if (!isOpen) return
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleCopyBarcode = () => {
    navigator.clipboard.writeText(barcodeValue)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handlePrint = () => {
    try {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
      iframe.setAttribute('aria-hidden', 'true')
      iframe.setAttribute('tabindex', '-1')
      iframe.setAttribute('data-gramm', 'false')
      iframe.setAttribute('data-gramm_editor', 'false')
      iframe.setAttribute('data-enable-grammarly', 'false')
      iframe.setAttribute('spellcheck', 'false')
      document.body.appendChild(iframe)

      const doc = iframe.contentWindow?.document
      if (!doc) {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
        return
      }

      const fullTitle = `${productName}${variantName ? ` (${variantName})` : ''}`
      const isThermal = printerType === 'label'

    // Build standalone HTML for the printed stickers with strict thermal proportions
    const parsedQty = parseInt(quantity.trim(), 10)
    const validQuantity = !isNaN(parsedQty) && parsedQty > 0 ? parsedQty : 1
    // Sticker design lives in lib/stickerPrint so every print path stays identical
    const singleStickerHtml = buildStickerHtml(
      { brand: BRAND_EN, title: fullTitle, barcodeValue, price, mrp },
      selectedPreset.widthMm,
      selectedPreset.heightMm,
    )

    const columns = isThermal ? Math.max(1, selectedPreset.labelsPerRow || 1) : 1
    const gapMm = selectedPreset.horizontalGapMm || 0
    // Page = one full roll row: all labels across + the blank die-cut space below the row
    const rowGapMm = isThermal ? selectedPreset.verticalGapMm || 0 : 0
    const pageHeightMm = selectedPreset.heightMm + rowGapMm

    const totalStickers = Math.max(1, validQuantity)
    const rows: string[] = []
    for (let i = 0; i < totalStickers; i += columns) {
      const rowCount = Math.min(columns, totalStickers - i)
      const rowHtml = Array.from({ length: rowCount }).map(() => singleStickerHtml).join('')
      
      if (isThermal) {
        // Wrap each row in a discrete page container to force hardware gap sensor alignment
        rows.push(`<div class="page-wrapper"><div class="sticker-row">${rowHtml}</div></div>`)
      } else {
        rows.push(`<div class="sticker-row">${rowHtml}</div>`)
      }
    }
    const allStickersHtml = rows.join('')

    const bodyContent = isThermal
      ? allStickersHtml
      : `<div class="a4-container">${allStickersHtml}</div>`

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print Barcode - ${barcodeValue}</title>
          <style>
            @page {
              ${
                isThermal
                  ? `size: ${(selectedPreset.widthMm * columns + gapMm * (columns - 1)).toFixed(2)}mm ${pageHeightMm.toFixed(2)}mm; margin: 0;`
                  : `size: A4 portrait; margin: 10mm;`
              }
            }
            @media print {
              ${
                isThermal
                  ? `
                  html, body {
                    margin: 0 !important;
                    padding: 0 !important;
                  }
                  .page-wrapper {
                    width: ${(selectedPreset.widthMm * columns + gapMm * (columns - 1)).toFixed(2)}mm !important;
                    height: ${pageHeightMm.toFixed(2)}mm !important;
                    overflow: hidden !important;
                    page-break-after: always !important;
                    break-after: page !important;
                  }
                  .page-wrapper:last-child {
                    page-break-after: auto !important;
                    break-after: auto !important;
                  }
                  `
                  : ''
              }
            }
            * {
              box-sizing: border-box;
              margin: 0;
              padding: 0;
            }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .a4-container {
              display: flex;
              flex-wrap: wrap;
              align-content: flex-start;
              gap: 3mm 4mm;
            }
            .page-wrapper {
              display: block;
            }
            .sticker-row {
              display: flex;
              flex-direction: row;
              align-items: flex-start;
              justify-content: ${isThermal ? 'space-between' : 'flex-start'};
              gap: ${isThermal ? '0' : gapMm + 'mm'};
              width: ${(selectedPreset.widthMm * columns + gapMm * (columns - 1)).toFixed(2)}mm;
              height: ${isThermal ? selectedPreset.heightMm + 'mm' : 'auto'};
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }
            ${buildStickerCss(selectedPreset.widthMm, selectedPreset.heightMm, !isThermal)}
          </style>
        </head>
        <body data-gramm="false">
          ${bodyContent}
        </body>
      </html>
    `

    doc.open()
    doc.write(html)
    doc.close()

    const cleanup = () => {
      try {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe)
        }
      } catch {}
    }

    setTimeout(() => {
      try {
        if (iframe.contentWindow) {
          iframe.contentWindow.onbeforeunload = null
          iframe.contentWindow.onunload = null
          iframe.contentWindow.onafterprint = cleanup
          iframe.contentWindow.focus()
          iframe.contentWindow.print()
        }
      } catch (err) {
        console.warn('[BarcodePrintModal] Failed to execute print:', err)
      } finally {
        setTimeout(cleanup, 2500)
      }
    }, 200)
  } catch (err) {
    console.warn('[BarcodePrintModal] Failed to execute print:', err)
  }
}

  return createPortal(
    <div className="fixed inset-0 top-0 left-0 right-0 bottom-0 w-screen h-screen h-[100dvh] z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4 overflow-hidden animate-in fade-in duration-150">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-none sm:rounded-3xl max-w-2xl sm:max-w-3xl w-full h-screen h-[100dvh] sm:h-auto sm:max-h-[92vh] border-0 sm:border border-[#F3F4F6] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-[#111111] px-4 py-3 sm:px-6 sm:py-4 border-b border-[#D4AF37]/30 flex items-center justify-between text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#262626] border border-[#D4AF37] flex items-center justify-center text-[#D4AF37]">
              <Printer size={16} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black tracking-wide text-white">
                Print Barcode Labels ({BRAND_EN})
              </h2>
              <p className="text-[11px] text-[#B38018] font-semibold">
                Generate physical retail stickers for this SKU
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body - Scrollable */}
        <div className="p-4 pb-28 sm:p-6 space-y-4 sm:space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Barcode Info Card */}
          <div className="bg-[#FBFAF6] border border-[#F3F4F6] rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-[#B48811]">
                Product / SKU
              </span>
              <h3 className="text-base sm:text-lg font-black text-[#111111] leading-tight">{productName}</h3>
              {variantName && (
                <div className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold">
                  Variant: {variantName}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-gray-200 shadow-sm shrink-0">
              <span className="font-mono text-sm font-black text-black">
                {barcodeValue}
              </span>
              <button
                type="button"
                onClick={handleCopyBarcode}
                className="text-gray-400 hover:text-gray-700 transition-colors p-1 cursor-pointer"
                title="Copy Barcode Value"
              >
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          {/* Configuration Form Card */}
          <div className="bg-[#FBFAF6] border border-[#F3F4F6]/70 rounded-2xl p-4 space-y-4">
            {/* Row 1: Target Printer & Preset */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Target Printer Type */}
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-gray-700 mb-1.5">
                  Target Printer
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-white border border-[#F3F4F6] shadow-sm">
                  <button
                    type="button"
                    onClick={() => handlePrinterTypeChange('label')}
                    className={`py-2 px-2.5 rounded-lg text-xs font-black transition-all text-center cursor-pointer ${
                      printerType === 'label'
                        ? 'bg-[#111111] text-[#D4AF37] shadow-sm'
                        : 'text-gray-600 hover:text-black hover:bg-gray-100'
                    }`}
                  >
                    Thermal (Roll)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrinterTypeChange('regular')}
                    className={`py-2 px-2.5 rounded-lg text-xs font-black transition-all text-center cursor-pointer ${
                      printerType === 'regular'
                        ? 'bg-[#111111] text-[#D4AF37] shadow-sm'
                        : 'text-gray-600 hover:text-black hover:bg-gray-100'
                    }`}
                  >
                    Desktop (A4)
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  {printerType === 'label'
                    ? `Roll label printer (${(selectedPreset.labelsPerRow || 1) > 1 ? `${selectedPreset.labelsPerRow} labels across per page` : '1 label per page'} · ${Math.ceil(Math.max(1, parseInt(quantity, 10) || 1) / Math.max(1, selectedPreset.labelsPerRow || 1))} page${Math.ceil(Math.max(1, parseInt(quantity, 10) || 1) / Math.max(1, selectedPreset.labelsPerRow || 1)) === 1 ? '' : 's'})`
                    : 'A4 sheet printer (Canon G2010, HP, Epson)'}
                </p>
              </div>

              {/* Label Sizing Preset */}
              <div>
                <label htmlFor="barcode-preset-select" className="block text-xs font-black uppercase tracking-wider text-gray-700 mb-1.5">
                  Label Sizing Preset
                </label>
                <select
                  id="barcode-preset-select"
                  name="barcodePreset"
                  value={selectedPreset.name}
                  onChange={(e) => {
                    const preset = presets.find((p) => p.name === e.target.value)
                    if (preset) setSelectedPreset(preset)
                  }}
                  className="w-full py-2.5 px-3 rounded-xl border-2 border-[#F3F4F6] bg-white font-bold text-xs sm:text-sm text-gray-900 outline-none focus:border-[#111111] shadow-sm cursor-pointer"
                >
                  {presets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Dimensions: {selectedPreset.widthMm}mm × {selectedPreset.heightMm}mm
                  {printerType === 'label' && ((selectedPreset.labelsPerRow || 1) > 1 || selectedPreset.verticalGapMm > 0)
                    ? ` · gap across ${selectedPreset.horizontalGapMm}mm · gap between rows ${selectedPreset.verticalGapMm}mm`
                    : ''}
                </p>
              </div>
            </div>

            {/* Row 2: Quantity Stepper & Quick Pills */}
            <div className="pt-3 border-t border-[#F3F4F6]/50">
              <label htmlFor="barcode-print-quantity" className="block text-xs font-black uppercase tracking-wider text-gray-700 mb-2">
                Number of Labels to Print
              </label>
              <div className="flex flex-wrap items-center gap-3">
                {/* Stepper with explicit unshrinkable buttons */}
                <div className="inline-flex items-center rounded-xl border-2 border-[#F3F4F6] bg-white overflow-hidden shadow-sm shrink-0">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => String(Math.max(1, (parseInt(q, 10) || 1) - 1)))}
                    className="w-10 h-10 shrink-0 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-black font-black text-lg flex items-center justify-center transition-colors cursor-pointer select-none"
                  >
                    -
                  </button>
                  <input
                    id="barcode-print-quantity"
                    name="printQuantity"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="1"
                    value={quantity}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/[^0-9]/g, '')
                      setQuantity(clean)
                    }}
                    className="w-20 sm:w-24 text-center font-black text-lg py-1.5 bg-white text-black outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => String((parseInt(q, 10) || 0) + 1))}
                    className="w-10 h-10 shrink-0 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-black font-black text-lg flex items-center justify-center transition-colors cursor-pointer select-none"
                  >
                    +
                  </button>
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[1, 5, 10, 20, 50, 100].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setQuantity(String(num))}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                        quantity === String(num)
                          ? 'bg-[#111111] text-[#D4AF37] shadow-sm'
                          : 'bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 shadow-sm'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Live Preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-black uppercase tracking-wider text-gray-600">
                Sticker Print Preview
              </label>
              <span className="text-[11px] font-bold text-[#B48811]">
                {quantity || 1} {quantity === '1' ? 'Label' : 'Labels'} • {selectedPreset.widthMm} × {selectedPreset.heightMm} mm ({printerType === 'label' ? 'Roll' : 'A4 Sheet'})
              </span>
            </div>
            <div className="bg-[#FBFAF6] border-2 border-dashed border-[#F3F4F6] rounded-2xl py-6 px-4 flex items-center justify-center min-h-[140px] overflow-x-auto">
              {printerType === 'label' ? (() => {
                const cols = Math.max(1, selectedPreset.labelsPerRow || 1)
                const qtyNum = Math.max(1, parseInt(quantity, 10) || 1)
                const totalRows = Math.ceil(qtyNum / cols)
                const rowsShown = Math.min(2, totalRows)
                return (
                  <div className="flex flex-col items-center" data-testid="roll-preview">
                    {Array.from({ length: rowsShown }).map((_, r) => {
                      const inRow = Math.min(cols, qtyNum - r * cols)
                      return (
                        <React.Fragment key={r}>
                          {r > 0 && (
                            <div className="flex w-full items-center gap-2 text-[9px] font-black uppercase tracking-wider text-[#9CA3AF]" style={{ margin: `${Math.max(1.5, selectedPreset.verticalGapMm)}mm 0` }}>
                              <span className="flex-1 border-t border-dashed border-[#9CA3AF]" />
                              <span>✂ cut / feed</span>
                              <span className="flex-1 border-t border-dashed border-[#9CA3AF]" />
                            </div>
                          )}
                          <div className="flex items-start" style={{ gap: `${selectedPreset.horizontalGapMm}mm` }}>
                            {Array.from({ length: inRow }).map((__, c) => (
                              <BarcodeLabel
                                key={c}
                                productName={productName}
                                variantName={variantName}
                                barcodeValue={barcodeValue}
                                price={price}
                                mrp={mrp}
                                storeName={BRAND_EN}
                                widthMm={selectedPreset.widthMm}
                                heightMm={selectedPreset.heightMm}
                              />
                            ))}
                          </div>
                        </React.Fragment>
                      )
                    })}
                    <p className="mt-2 text-[10px] font-bold text-gray-500">
                      Each row prints as one page{totalRows > rowsShown ? ` · ${totalRows} pages in total` : ''}
                    </p>
                  </div>
                )
              })() : (
              <BarcodeLabel
                productName={productName}
                variantName={variantName}
                barcodeValue={barcodeValue}
                price={price}
                mrp={mrp}
                storeName={BRAND_EN}
                widthMm={selectedPreset.widthMm}
                heightMm={selectedPreset.heightMm}
              />
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 z-20 bg-[#FBFAF6] px-4 py-3 sm:px-6 sm:py-3.5 border-t border-[#F3F4F6] flex items-center justify-between pb-[calc(env(safe-area-inset-bottom)+0.75rem)] gap-2 sm:static sm:z-auto sm:shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold text-xs sm:text-sm hover:bg-gray-100 transition-colors cursor-pointer shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 sm:gap-2 px-4 py-2 sm:px-6 sm:py-2.5 rounded-xl bg-[#111111] border border-[#D4AF37] text-[#D4AF37] font-black hover:bg-[#262626] transition-all shadow-md cursor-pointer hover:scale-[1.02] text-xs sm:text-sm shrink-0"
          >
            <Printer size={16} />
            Print {quantity || '1'} {quantity === '1' ? 'Sticker' : 'Stickers'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
