import React, { useEffect, useRef } from 'react'
import { renderBarcodeSvg } from '../../lib/barcode'
import { BRAND_EN } from '../../lib/brand'
import { formatCurrency } from '../../lib/retail'

export interface BarcodeLabelProps {
  productName: string
  variantName?: string
  barcodeValue: string
  price: number
  mrp?: number | null
  storeName?: string
  widthMm?: number
  heightMm?: number
}

export const BarcodeLabel: React.FC<BarcodeLabelProps> = ({
  productName,
  variantName,
  barcodeValue,
  price,
  mrp,
  storeName = BRAND_EN,
  widthMm = 50,
  heightMm = 30,
}) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const isSmall = heightMm <= 25
  const isLarge = heightMm >= 40

  // Dynamic calculation for barcode dimensions and typography (balanced proportions to prevent overlapping)
  const barcodeHeightPx = Math.max(16, Math.round(heightMm * 0.32 * 3.7795))
  const printableWidthPx = Math.max(30, (widthMm - 4) * 3.7795)
  const barcodeBarWidth = Math.max(0.80, Math.min(1.70, Math.round((printableWidthPx / 120) * 100) / 100))
  const barcodeFontSize = Math.max(6, Math.min(9.5, Math.round(heightMm * 0.20 * 10) / 10))

  useEffect(() => {
    if (svgRef.current && barcodeValue) {
      renderBarcodeSvg(svgRef.current, barcodeValue, {
        width: barcodeBarWidth,
        height: barcodeHeightPx,
        fontSize: barcodeFontSize,
        font: 'Arial, sans-serif',
        fontOptions: 'bold',
        margin: 0,
        textMargin: 1.5,
        displayValue: true,
      })
    }
  }, [barcodeValue, widthMm, heightMm, barcodeHeightPx, barcodeBarWidth, barcodeFontSize])

  const fullTitle = `${productName}${variantName ? ` (${variantName})` : ''}`

  return (
    <div
      className="barcode-sticker-box bg-white text-black border border-gray-300 rounded flex flex-col justify-between items-center text-center shadow-sm select-none transition-all"
      style={{
        width: `${widthMm}mm`,
        height: `${heightMm}mm`,
        maxWidth: `${widthMm}mm`,
        maxHeight: `${heightMm}mm`,
        padding: isSmall ? '0.6mm 1.2mm' : isLarge ? '1.5mm 2.2mm' : '1.0mm 1.6mm',
        boxSizing: 'border-box',
        overflow: 'hidden',
        pageBreakInside: 'avoid',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Brand Header */}
      <div className="w-full flex flex-col items-center leading-none shrink-0">
        <div
          className="font-black tracking-wider text-black uppercase truncate max-w-full"
          style={{ fontSize: isSmall ? '7.5px' : isLarge ? '11px' : '9px', WebkitTextStroke: '0.3px #000' }}
        >
          {storeName}
        </div>
      </div>

      {/* Barcode Graphic Box */}
      <div
        className="w-full flex-1 flex justify-center items-center overflow-hidden"
        style={{ margin: '0.4mm 0', minHeight: 0 }}
      >
        <svg ref={svgRef} className="max-w-[98%] max-h-full h-auto" />
      </div>

      {/* Footer: product name + size on the left, price on the right */}
      <div
        className="w-full flex items-center justify-between px-0.5 border-t border-black leading-none shrink-0"
        style={{
          paddingTop: isSmall ? '0.4mm' : '0.6mm',
        }}
      >
        <div className="flex flex-col items-start min-w-0 flex-1 mr-1 text-left">
          <span
            className="font-extrabold text-black truncate max-w-full leading-tight"
            style={{ fontSize: isSmall ? '7px' : isLarge ? '10px' : '8.5px', WebkitTextStroke: '0.25px #000' }}
          >
            {fullTitle}
          </span>
          {mrp && mrp > price && (
            <span className="text-black line-through font-bold" style={{ fontSize: isSmall ? '6px' : isLarge ? '8.5px' : '7.5px' }}>
              MRP {formatCurrency(mrp)}
            </span>
          )}
        </div>
        <span
          className="font-black text-black whitespace-nowrap"
          style={{
            fontSize: isSmall ? '17px' : isLarge ? '25px' : '21px',
            WebkitTextStroke: '0.5px #000',
          }}
        >
          {formatCurrency(price)}
        </span>
      </div>
    </div>
  )
}
