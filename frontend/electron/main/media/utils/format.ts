/**
 * 媒体格式工具（media/ 模块公共设施，未来 image/ 等模块复用）。
 * 仅做字节级嗅探，不引入解码依赖。
 */

/** GIF 魔数检测（GIF87a / GIF89a） */
export function isGifBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  )
}

/** 从文件头读取 GIF 逻辑屏幕尺寸（偏移 6/8，小端 uint16） */
export function readGifDims(buf: Buffer): { width: number; height: number } | null {
  if (!isGifBuffer(buf) || buf.length < 10) return null
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
}
