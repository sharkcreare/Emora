/**
 * media 模块统一出口（主进程）。
 * 未来扩展：image/（图片压缩、格式转换）、ai/（OCR、AI 处理）等挂到本目录下，
 * 统一从这里导出，调用方不关心内部实现。
 */

export { compressGifIfNeeded, getGifConfig, setGifConfig, resolveGifThreshold, disposeCompressor } from './gif/compressor'
export type { GifCompressOutcome } from './gif/compressor'
