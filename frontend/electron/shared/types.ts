/** 主进程与渲染进程共享的 IPC 类型定义 */

/** 一个表情包（渲染进程发送给主进程去粘贴；本地文件夹文件 id 为 local_xxx 字符串） */
export interface EmojiPayload {
  id: number | string
  name: string
  /** 本地路径 或 http(s) URL */
  url: string
}

/** 呼出面板时记录的目标聊天窗口 */
export interface ActiveWindowInfo {
  pid: number
  title: string
}

/** 网络图库搜索配置（设置弹窗编辑，写入外部 yml 后重启后端生效） */
export interface NetworkSearchConfig {
  enabled: boolean
  /** 内置中文梗图库（ChineseBQB，无需 Key） */
  chinesebqbEnabled: boolean
  /** 免费搜狗表情包（接口盒子聚合，无需 Key，共享频次） */
  sogouEnabled: boolean
  /** 百度图库实时通道（接口盒子 IP 直连，无需 Key，内容实时更新） */
  baiduEnabled: boolean
  /** 萌芽梗图浏览（meme.smyhub.com，2600+ 梗图，免 Key，仅浏览） */
  mengyaEnabled: boolean
  giphyApiKey: string
  tenorApiKey: string
  giphyBaseUrl: string
  tenorBaseUrl: string
}

/** 本地文件夹扫描出的图片（source='FOLDER'，前端以 Emoji 形式展示） */
export interface LocalFileEmoji {
  /** 唯一 ID：local_ + 路径 hash（非负数、稳定，可作前端 key / 收藏去重） */
  id: string
  name: string
  /** locallib:// 协议地址（渲染层 img src 用） */
  url: string
  /** 真实磁盘绝对路径（点击发送时传给 clipboard 本地路径分支） */
  localPath: string
  /** 直接父目录名（本地搜索范围之一） */
  parentDir: string
  /** 预留：AI 标签（后续语义搜索/自动打标写入） */
  tags: string
  /** 图片扩展名（小写，无点） */
  ext: string
  /** 文件大小（字节） */
  size: number
  /** 最后修改时间（毫秒） */
  mtime: number
  /** 重复检测：是否被标记为重复（高度相似/相似） */
  duplicate?: boolean
  /** 重复等级：high=高度相似（红角标），similar=相似（黄角标） */
  duplicateLevel?: 'high' | 'similar'
  /** 组代表文件的 id（此文件与它重复/相似） */
  duplicateOf?: string
  /** 与组代表的相似度百分比（0~100；汉明距离换算，md5 精确重复为 100） */
  similarity?: number
}

/** 本地图库状态（设置页 + 自定义分类展示用） */
export interface LocalLibraryState {
  folders: string[]
  ignored: string[]
  files: LocalFileEmoji[]
  /** 相似度算法：dHash（默认）/ pHash（DCT，对压缩/旋转更鲁棒） */
  hashType: 'dHash' | 'pHash'
}

/** 本地图库重复分析进度（设置页进度条 / 自定义分类过滤条用） */
export interface LocalLibraryAnalysisState {
  running: boolean
  done: number
  total: number
  duplicates: number
  /** 当前/最近一次分析的范围：folder=本地文件夹 / upload=上传库 / favorite=收藏夹 */
  scope: 'folder' | 'upload' | 'favorite'
  /** 各范围最近一次完成的分析统计（设置页统一展示去重结果） */
  scopes: Partial<Record<'folder' | 'upload' | 'favorite', { duplicates: number; total: number }>>
}

/** AI 模型安装状态：未安装 / 下载中 / 已完成 / 失败 */
export type AiModelState = 'not-installed' | 'downloading' | 'ready' | 'failed'

/** AI 模型信息（设置页展示：状态 + 版本 + 大小） */
export interface AiModelInfo {
  state: AiModelState
  /** 模型标识（如 chinese-clip-vit-b-16-int8-v1） */
  modelId: string
  version: string
  /** 模型总大小（字节） */
  sizeBytes: number
  /** 已下载大小（下载中实时更新） */
  downloadedBytes: number
  error?: string
}

/** AI 标签分析整体状态（设置页进度 / 暂停继续） */
export interface AiAnalysisState {
  running: boolean
  done: number
  total: number
  mode: 'idle' | 'running' | 'paused' | 'canceled'
  /** 已缓存的标签文件数 */
  cachedFiles: number
}

/** GIF 压缩配置（渲染层持久化，启动时同步到主进程内存缓存） */
export type GifCompressMode = 'wechat' | 'qq' | 'custom'
export interface GifCompressConfig {
  /** 是否开启发送前自动压缩（默认关闭，首次遇到超大 GIF 提示用户开启） */
  enabled: boolean
  /** 阈值模式：wechat=1MB / qq=5MB / custom=自定义大小 */
  mode: GifCompressMode
  /** mode=custom 时的自定义阈值（字节） */
  customThresholdBytes?: number
}

/** 表情发送结果：hint=true 表示超大 GIF 且未开启压缩（供渲染层提示开启） */
export interface EmojiSendResult {
  ok: boolean
  error?: string
  hint?: boolean
}

/** 暴露给渲染进程的 API 形状 */
export interface EmojiAssistantApi {
  /** 点击表情：将图片写入系统剪贴板（用户自行切到聊天窗口按 Ctrl+V 粘贴），成功返回 ok=true */
  sendEmoji(emoji: EmojiPayload): Promise<EmojiSendResult>
  /** 仅复制到剪贴板，不自动粘贴（Ctrl+C 快捷键） */
  copyEmoji(emoji: EmojiPayload): Promise<EmojiSendResult>
  /** 隐藏悬浮窗 */
  hidePanel(): void
  /** 读取开机启动状态 */
  getAutoLaunch(): Promise<boolean>
  /** 设置开机启动 */
  setAutoLaunch(enable: boolean): Promise<boolean>
  /** 读取应用信息（版本等） */
  getAppInfo(): Promise<{ version: string; platform: string }>
  /** 读取后端 API 地址 */
  getApiBase(): Promise<string>
  /** 确保后端可用（主进程自动拉起内置后端），返回是否就绪 */
  ensureBackend(): Promise<boolean>
  /** 读取网络图库配置 */
  getNetworkSearchConfig(): Promise<NetworkSearchConfig>
  /** 写回网络图库配置（保存到外部 yml），返回是否成功 */
  setNetworkSearchConfig(cfg: NetworkSearchConfig): Promise<boolean>
  /** 重启内置后端（使配置生效） */
  restartBackend(): Promise<boolean>
  /** 最小化窗口 */
  minimizeWindow(): void
  /** 最大化 / 还原切换 */
  toggleMaximize(): void
  /** 切换面板模式：full=完整面板（搜索+分类+预览），compact=输入法候选小窗 */
  setPanelMode(mode: 'full' | 'compact'): void
  /** 关闭面板（隐藏到托盘，应用常驻后台） */
  closeWindow(): void
  /** 面板被呼出时触发（渲染进程用于刷新数据） */
  onPanelShown(cb: () => void): () => void
  /** 最大化状态变化（true=已最大化，用于切换图标与圆角样式） */
  onMaximizedChanged(cb: (maximized: boolean) => void): () => void
  /** 浏览器式缩放界面：按比例缩放内容并联动调整窗口尺寸，返回生效后的缩放比 */
  setZoom(factor: number): Promise<number>
  /** 开始边缘拖动调整窗口大小（dir: n/s/e/w/ne/nw/se/sw，主进程轮询鼠标位置） */
  beginResize(dir: string): void
  /** 结束边缘拖动调整 */
  endResize(): void
  /** 渲染进程错误上报：写入主进程 error.log（主进程按标签+内容聚合去重） */
  reportError(tag: string, message: string): void
  /** 读取当前生效的全局呼出快捷键（Electron accelerator 格式） */
  getHotkey(): Promise<string>
  /**
   * 设置并重新注册全局呼出快捷键，返回结果。
   * 冲突（被其他程序占用）时主进程自动回滚旧快捷键并通过 error 提示。
   */
  setHotkey(accelerator: string): Promise<{ ok: boolean; accelerator: string; error?: string }>
  /** 暂停全局呼出快捷键（设置面板录制新组合键时调用） */
  pauseHotkey(): void
  /** 恢复全局呼出快捷键（录制结束/取消后调用） */
  resumeHotkey(): void
  /** 托盘「修改快捷键…」等入口：主进程要求打开设置面板并跳到指定 Tab（如 'hotkey'） */
  onOpenSettings(cb: (tab: string) => void): () => void
  /** 读取 GIF 压缩配置（主进程内存缓存） */
  getGifConfig(): Promise<GifCompressConfig>
  /** 写入 GIF 压缩配置（renderer 启动/变更时同步到主进程） */
  setGifConfig(cfg: GifCompressConfig): Promise<void>
  /** 读取本地图库状态（文件夹/忽略名单/扫描结果；打开面板自动扫描一次） */
  getLocallibState(): Promise<LocalLibraryState>
  /** 添加托管文件夹（主进程弹窗选目录），返回新状态 */
  addLocallibFolder(): Promise<{ ok: boolean; error?: string; state?: LocalLibraryState }>
  /** 移除托管文件夹（仅解除托管，不删除磁盘文件） */
  removeLocallibFolder(folder: string): Promise<LocalLibraryState>
  /** 手动重新扫描全部托管文件夹 */
  rescanLocallib(): Promise<LocalLibraryState>
  /** 从软件移除某文件（加入忽略名单，不删除磁盘文件） */
  ignoreLocallibFile(localPath: string): Promise<LocalLibraryState>
  /** 批量从软件移除文件（对比面板「移出本地库」用；一次重扫/重分析） */
  ignoreLocallibFiles(paths: string[]): Promise<LocalLibraryState>
  /** 恢复被忽略的文件 */
  unignoreLocallibFile(localPath: string): Promise<LocalLibraryState>
  /** 手动重新分析本地表情（强制清空哈希缓存全量重算），返回是否已开始 */
  reanalyzeLocallib(): Promise<boolean>
  /** 设置本地图库相似度算法（dHash / pHash），切换后自动重新分析，返回是否生效 */
  setLocallibHashType(type: 'dHash' | 'pHash'): Promise<boolean>
  /** 读取当前重复分析进度状态 */
  getLocallibAnalysisState(): Promise<LocalLibraryAnalysisState>
  /** 重复分析进度更新（设置页进度条） */
  onLocallibAnalysisProgress(cb: (s: LocalLibraryAnalysisState) => void): () => void
  /** 重复分析完成（自定义分类据此刷新列表与重复过滤条） */
  onLocallibAnalyzed(cb: (files: LocalFileEmoji[]) => void): () => void
  /** 上传库/收藏夹去重：传入条目（id/name/url），主进程解析磁盘路径后分析，返回按原 id 的标记 */
  analyzeLocallibScope(scope: 'upload' | 'favorite', items: ScopeAnalysisItem[]): Promise<ScopeAnalysisMark[]>
  /** 读取 AI 模型状态（未安装/下载中/已完成/失败 + 版本/大小） */
  getAiModelInfo(): Promise<AiModelInfo>
  /** 发起 AI 模型下载（首次使用），返回最新状态 */
  requestAiModelDownload(): Promise<AiModelInfo>
  /** 重置 AI 模型状态（清除失败/下载中标记） */
  resetAiModel(): Promise<AiModelInfo>
  /** 读取 AI 标签分析状态（进度 / 已缓存数） */
  getAiAnalysisState(): Promise<AiAnalysisState>
  /** AI 模型状态变化推送（设置页实时刷新） */
  onAiModelStateChange(cb: (info: AiModelInfo) => void): () => void
}

/** 上传库/收藏夹去重：渲染层传入的待分析条目 */
export interface ScopeAnalysisItem {
  id: number | string
  name: string
  url: string
}

/** 分析结果标记（按原 id 回写渲染层） */
export interface ScopeAnalysisMark {
  id: number | string
  duplicate: boolean
  duplicateLevel?: 'high' | 'similar'
  duplicateOf?: string
  /** 与组代表的相似度百分比（0~100；汉明距离换算，md5 精确重复为 100） */
  similarity?: number
}
