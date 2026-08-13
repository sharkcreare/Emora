/** gifenc 最小类型声明（库本身无类型） */
declare module 'gifenc' {
  /** 调色板条目：RGB 三元组，或带 alpha 的四元组 */
  export type GifPaletteEntry = number[]

  export interface QuantizeOptions {
    /** rgb565（默认）| rgb444 | rgba4444 */
    format?: 'rgb565' | 'rgb444' | 'rgba4444'
    clearAlpha?: boolean
    clearAlphaColor?: number
    clearAlphaThreshold?: number
    oneBitAlpha?: boolean | number
    useSqrt?: boolean
  }

  /** 量化：返回调色板数组 */
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: QuantizeOptions): GifPaletteEntry[]

  /** 调色板映射：返回按像素索引的 Uint8Array */
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifPaletteEntry[], format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array

  export interface WriteFrameOptions {
    /** 首帧必须传调色板（写入全局颜色表）；后续帧可不传（复用全局表） */
    palette?: GifPaletteEntry[]
    /** 帧延迟（毫秒） */
    delay?: number
    transparent?: boolean
    transparentIndex?: number
    /** 循环次数，>=0 时写 NETSCAPE 循环扩展（0=无限） */
    repeat?: number
    colorDepth?: number
    /** GIF disposal：1=保留画面 */
    dispose?: number
  }

  export interface GIFEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
  }

  export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GIFEncoderInstance
}
