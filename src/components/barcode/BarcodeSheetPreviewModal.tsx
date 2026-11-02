import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Printer } from 'lucide-react'
import { type BarcodeQueueItem, type LabelSizeConfig } from '../../lib/barcode'
import { BRAND_EN } from '../../lib/brand'
import { BarcodeLabel } from './BarcodeLabel'

interface BarcodeSheetPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  items: BarcodeQueueItem[]
  sizeConfig: LabelSizeConfig
  onPrint: () => void
  /** Same toggles the printed sticker honours (all on by default). */
  showCompanyName?: boolean
  showItemName?: boolean
  showSalePrice?: boolean
}

export const BarcodeSheetPreviewModal: React.FC<BarcodeSheetPreviewModalProps> = ({
  isOpen,
  onClose,
  items,
  sizeConfig,
  onPrint,
  showCompanyName = true,
  showItemName = true,
  showSalePrice = true,
}) => {

  // Expand all selected queue items into individual labels based on `noOfLabels`
  const individualLabels: BarcodeQueueItem[] = []
  items
    .filter((it) => it.selected)
    .forEach((it) => {
      const count = Math.max(1, it.noOfLabels || 1)
      for (let i = 0; i < count; i++) {
        individualLabels.push(it)
      }
    })

  // The preview shows the real sticker (same layout as the printed one), scaled up for readability
  const previewZoom = Math.min(1.6, 230 / (sizeConfig.widthMm * 3.7795))

  // Lock body scrolling and close on Escape
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

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4 overflow-hidden animate-in fade-in duration-150">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-none sm:rounded-3xl max-w-4xl w-full h-[100dvh] max-h-[100dvh] sm:h-auto sm:max-h-[92vh] border-0 sm:border border-gray-200 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-[#111111] text-white shrink-0">
          <div>
            <h3 className="text-sm sm:text-base font-black tracking-wide text-white">Print Preview</h3>
            <p className="text-[11px] sm:text-xs text-[#B38018] font-semibold">
              {individualLabels.length} Labels (1 Barcode Per Page • {sizeConfig.name} • {sizeConfig.widthMm} × {sizeConfig.heightMm} mm)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Preview Sheet Body */}
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 bg-gray-100/70 flex justify-center"
        >
          <div className="flex flex-wrap items-center justify-center gap-4 w-full">
            {individualLabels.map((label, idx) => (
              <div key={`${label.id}-${idx}`} className="flex flex-col items-center">
                <span className="text-[10px] font-bold text-gray-500 mb-1.5 font-mono">
                  Page {idx + 1}
                </span>
                <div style={{ zoom: previewZoom }}>
                  <BarcodeLabel
                    productName={label.productName}
                    variantName={label.variantName}
                    barcodeValue={label.barcodeValue}
                    price={label.price}
                    storeName={label.header || BRAND_EN}
                    widthMm={sizeConfig.widthMm}
                    heightMm={sizeConfig.heightMm}
                    showBrand={showCompanyName}
                    showTitle={showItemName}
                    showPrice={showSalePrice}
                  />
                </div>
              </div>
          ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-3 py-2 sm:px-6 sm:py-4 border-t border-gray-200 bg-white shrink-0 gap-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
          <span className="text-[11px] sm:text-xs font-bold text-gray-600 truncate mr-2">
            Total {individualLabels.length} pages ready to print
          </span>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer shrink-0"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                onClose()
                onPrint()
              }}
              className="px-4 py-2 sm:px-6 sm:py-2.5 rounded-xl bg-[#111111] border border-[#D4AF37] text-[#D4AF37] text-xs font-black uppercase tracking-wider hover:bg-[#262626] transition-all shadow-md flex items-center gap-1.5 sm:gap-2 cursor-pointer shrink-0"
            >
              <Printer size={15} /> Print Labels
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
