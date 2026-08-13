/** GIF 压缩 worker 任务（主进程 → worker） */
export interface GifCompressRequest {
  /** 输入 GIF 文件路径 */
  inputPath: string
  /** 输出文件路径（缓存文件） */
  outputPath: string
  /** 目标字节数（压缩到该阈值以内） */
  targetBytes: number
}

/** GIF 压缩结果（worker → 主进程） */
export interface GifCompressResponse {
  ok: boolean
  /** 压缩产物路径（ok=true 时有效） */
  outputPath: string
  originalBytes: number
  compressedBytes: number
  /** 压缩方式描述，如 "colors128+scale0.5+480x240->240x120" */
  method: string
  elapsedMs: number
  error?: string
}
