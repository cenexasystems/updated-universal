import { generateBarcodeSvgString } from './barcode'
import { BRAND_EN } from './brand'

/**
 * Single source of truth for the printed barcode sticker.
 *
 * Layout (all black, bold – grey does not survive thermal printing):
 *   SHOP NAME   (stretched to exactly the barcode width)
 *   ||||| barcode ||||||
 *   ------------------------------
 *   PRODUCT (SIZE)            ₹PRICE
 *
 * Every print path (single print, Create Barcode queue, …) must build its stickers with
 * buildStickerHtml + buildStickerCss so they cannot drift apart again.
 */

export interface StickerData {
  /** Shop name shown above the barcode. null/'' hides it. */
  brand?: string | null
  /** Product name (+ size) shown bottom-left. null/'' hides it. */
  title?: string | null
  barcodeValue: string
  /** Sale price shown bottom-right. null/undefined hides it. */
  price?: number | null
  mrp?: number | null
}

const MM_TO_PX = 3.7795

export function getStickerSizing(widthMm: number, heightMm: number) {
  const isSmall = heightMm <= 25
  const isLarge = heightMm >= 40
  // Bars take ~27% of the height, leaving room for the shop name, digits and footer.
  const barcodeHeightPx = Math.max(16, Math.round(heightMm * 0.27 * MM_TO_PX))
  const printableWidthPx = Math.max(30, (widthMm - 4) * MM_TO_PX)
  const barcodeBarWidth = Math.max(0.8, Math.min(1.7, Math.round((printableWidthPx / 120) * 100) / 100))
  const barcodeFontSize = Math.max(6, Math.min(9.5, Math.round(heightMm * 0.2 * 10) / 10))
  return { isSmall, isLarge, barcodeHeightPx, barcodeBarWidth, barcodeFontSize }
}

const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Shop name drawn as scalable text so it is exactly as wide as the barcode beneath it. */
export function buildBrandSvg(brand: string): string {
  return `<svg class="brand-svg" viewBox="0 0 200 20" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><text x="0" y="16" textLength="200" lengthAdjust="spacingAndGlyphs" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="19" fill="#000" stroke="#000" stroke-width="0.7">${escapeHtml(brand.toUpperCase())}</text></svg>`
}

export function buildStickerBarcodeSvg(barcodeValue: string, widthMm: number, heightMm: number): string {
  const s = getStickerSizing(widthMm, heightMm)
  return generateBarcodeSvgString(barcodeValue, {
    width: s.barcodeBarWidth,
    height: s.barcodeHeightPx,
    fontSize: s.barcodeFontSize,
    font: 'Arial, sans-serif',
    fontOptions: 'bold',
    margin: 0,
    textMargin: 1.5,
    displayValue: true,
  })
}

/**
 * HTML for one sticker. Pass `barcodeSvg` (from buildStickerBarcodeSvg) when printing many copies of
 * the same code so the SVG is only generated once.
 */
export function buildStickerHtml(
  data: StickerData,
  widthMm: number,
  heightMm: number,
  barcodeSvg?: string,
): string {
  const svg = barcodeSvg ?? buildStickerBarcodeSvg(data.barcodeValue, widthMm, heightMm)
  const brand = data.brand === undefined ? BRAND_EN : data.brand
  const hasPrice = data.price !== null && data.price !== undefined
  const showMrp = hasPrice && data.mrp && data.mrp > (data.price as number)
  return `
      <div class="sticker">
        <div class="barcode-box">
          <div class="bb">
            ${brand ? buildBrandSvg(brand) : ''}
            <div class="bc">${svg}</div>
          </div>
        </div>
        <div class="footer">
          <span class="footer-left">
            ${data.title ? `<span class="prod-title">${escapeHtml(data.title)}</span>` : ''}
            ${showMrp ? `<span class="mrp">MRP ₹${data.mrp}</span>` : ''}
          </span>
          ${hasPrice ? `<span class="price">₹${data.price}</span>` : ''}
        </div>
      </div>
    `
}

/** CSS for the sticker (put inside a <style> next to the page/row CSS of the caller). */
export function buildStickerCss(widthMm: number, heightMm: number, bordered = false): string {
  const { isSmall, isLarge } = getStickerSizing(widthMm, heightMm)
  const titleFontSize = isSmall ? '6.5pt' : isLarge ? '9.5pt' : '8pt'
  const tagFontSize = isSmall ? '5.5pt' : isLarge ? '8.5pt' : '7pt'
  const priceFontSize = isSmall ? '14pt' : isLarge ? '20pt' : '17pt'
  return `
            .sticker {
              width: ${widthMm}mm;
              height: ${heightMm}mm;
              max-width: ${widthMm}mm;
              max-height: ${heightMm}mm;
              /* Horizontal padding protects text from physical printer misalignment */
              padding: ${isSmall ? '0.8mm 2mm' : '1.2mm 2.5mm'};
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              align-items: center;
              text-align: center;
              overflow: hidden;
              box-sizing: border-box;
              flex-shrink: 0;
              background: #fff;
              break-inside: avoid !important;
              page-break-inside: avoid !important;
              ${bordered ? 'border: 0.2mm dashed #000;' : ''}
            }
            .bb {
              display: flex;
              flex-direction: column;
              align-items: stretch;
              max-width: 98%;
              max-height: 100%;
              min-height: 0;
            }
            .brand-svg {
              display: block;
              width: 0;
              min-width: 100%;
              height: auto;
              margin-bottom: 0.6mm;
              flex-shrink: 0;
            }
            .bc { display: flex; justify-content: center; min-height: 0; }
            .barcode-box {
              width: 100%;
              flex: 1;
              min-height: 0;
              display: flex;
              justify-content: center;
              align-items: center;
              margin: 0.4mm 0;
              overflow: hidden;
            }
            .bc svg {
              overflow: visible; /* digits sit on the svg's bottom edge; never clip them */
              display: block;
              margin: 0 auto;
              max-width: 100%;
              max-height: 100%;
              width: auto;
              height: auto;
            }
            .footer {
              width: 100%;
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-top: 0.6pt solid #000;
              padding-top: 0.5mm;
              line-height: 1;
              flex-shrink: 0;
            }
            .footer-left {
              display: flex;
              flex-direction: column;
              align-items: flex-start;
              justify-content: center;
              min-width: 0;
              flex: 1;
              margin-right: 1mm;
              text-align: left;
            }
            .prod-title {
              font-size: ${titleFontSize};
              font-weight: 800;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              max-width: 100%;
              padding: 0 0.3mm; /* keep the bold outline of the first/last letter from being clipped */
              color: #000;
              -webkit-text-stroke: 0.2pt #000;
              line-height: 1.1;
            }
            .mrp {
              text-decoration: line-through;
              color: #000;
              font-size: ${tagFontSize};
              font-weight: 800;
              -webkit-text-stroke: 0.2pt #000;
              line-height: 1.1;
            }
            .price {
              font-size: ${priceFontSize};
              font-weight: 900;
              color: #000;
              white-space: nowrap;
              -webkit-text-stroke: 0.4pt #000;
            }
`
}
