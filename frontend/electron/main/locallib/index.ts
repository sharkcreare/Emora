import { app, dialog, protocol, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, existsSync, statSync, createReadStream, mkdirSync } from 'node:fs'
import { join, normalize, extname, basename, dirname } from 'node:path'
import type { LocalFileEmoji, LocalLibraryState } from './types'
import { scanFolder, locallibPath } from './scanner'
import { analyzeDuplicates, DEFAULT_HASH_TYPE } from './duplicate-service'
import type { HashType } from './phash'
import { THUMB_DIR, thumbPathOf, loadHashCache, saveHashCache, clearHashCache } from './cache'
import { initWatcher, stopWatcher } from './watcher'
import { resolveEmojiLocalPath } from './scope-resolver'

/**
 * 本地表情文件夹托管（Electron 主进程，纯本地，不依赖后端/数据库）。
 *
 * 职责拆分：
 *  - scanner.ts        递归扫描图片文件
 *  - phash.ts          感知哈希计算（md5/dHash，预留 pHash）
 *  - cache.ts          哈希缓存 + 缩略图路径
 *  - duplicate-service.ts 重复检测与分组标记
 *  - watcher.ts        自动监听（预留，本阶段不启用）
 *  - index.ts          配置持久化 / locallib:// 协议 / 编排与 IPC 出口
 *
 * 能力：添加/移除文件夹、扫描、忽略名单（不删磁盘文件）、
 *       locallib:// 协议显示本地图、缩略图缓存、重复检测（异步+进度）、手动重扫。
 */

const CONFIG_FILE = () => join(app.getPath('userData'), 'locallib.json')

interface LocallibConfig {
  folders: string[]
  ignored: string[]
  /** 相似度算法：dHash（默认，兼容旧版）/ pHash（DCT，对压缩/旋转更鲁棒） */
  hashType: Exclude<HashType, 'md5'>
}

let cfg: LocallibConfig = { folders: [], ignored: [], hashType: DEFAULT_HASH_TYPE }
/** 扫描结果缓存：最近一次扫描结果（打开面板自动扫描 + 手动刷新共用） */
let scanCache: LocalFileEmoji[] = []
/** 分析范围（folder=本地文件夹 / upload=上传库 / favorite=收藏夹） */
type AnalysisScopeKind = 'folder' | 'upload' | 'favorite'
interface ScopeStats {
  duplicates: number
  total: number
}
/**
 * 最近一次重复分析进度（供渲染层读取/显示）。
 * scope 标记当前/最近一次分析的范围；scopes 记录各范围最近一次完成的分析统计，
 * 让设置页「本地文件夹」Tab 统一展示 文件夹/上传库/收藏夹 三处的去重结果。
 */
let analysisState: {
  running: boolean
  done: number
  total: number
  duplicates: number
  scope: AnalysisScopeKind
  scopes: Partial<Record<AnalysisScopeKind, ScopeStats>>
} = {
  running: false,
  done: 0,
  total: 0,
  duplicates: 0,
  scope: 'folder',
  scopes: {}
}

function loadConfig(): void {
  try {
    const raw = readFileSync(CONFIG_FILE(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LocallibConfig>
    cfg = {
      folders: Array.isArray(parsed.folders) ? parsed.folders.filter((f) => typeof f === 'string') : [],
      ignored: Array.isArray(parsed.ignored) ? parsed.ignored.filter((f) => typeof f === 'string') : [],
      hashType: parsed.hashType === 'pHash' ? 'pHash' : DEFAULT_HASH_TYPE
    }
  } catch {
    cfg = { folders: [], ignored: [], hashType: DEFAULT_HASH_TYPE }
  }
}

function saveConfig(): void {
  try {
    writeFileSync(CONFIG_FILE(), JSON.stringify(cfg, null, 2), 'utf8')
  } catch (err) {
    console.error('[locallib] 保存配置失败:', err)
  }
}

/** 全量重扫：遍历所有托管文件夹，合并去重（同一文件被多个文件夹托管只留一个），排除忽略 */
function rescan(): LocalFileEmoji[] {
  const ignoredSet = new Set(cfg.ignored.map((f) => normalize(f)))
  const byId = new Map<string, LocalFileEmoji>()
  for (const folder of cfg.folders) {
    for (const f of scanFolder(folder, ignoredSet)) {
      if (!byId.has(f.id)) {
        byId.set(f.id, f)
      }
    }
  }
  scanCache = [...byId.values()].sort((a, b) => a.parentDir.localeCompare(b.parentDir) || a.name.localeCompare(b.name))
  return scanCache
}

function getState(): LocalLibraryState {
  return {
    folders: [...cfg.folders],
    ignored: [...cfg.ignored],
    files: scanCache,
    hashType: cfg.hashType
  }
}

/* ---------------- 缩略图（渲染层 locallib:// 请求时生成） ---------------- */

/** 确保缩略图存在：不存在则解码生成 200px 缩略图（PNG），返回缩略图路径；失败回退原图 */
async function ensureThumb(localPath: string): Promise<string> {
  const thumb = thumbPathOf(localPath)
  if (existsSync(thumb) && statSync(thumb).size > 0) {
    return thumb
  }
  try {
    mkdirSync(THUMB_DIR(), { recursive: true })
    const jimpMod = await import('jimp')
    const Jimp: any = (jimpMod as any).default ?? jimpMod
    const decoded = await Jimp.read(localPath)
    const max = 200
    if (decoded.getWidth() > max || decoded.getHeight() > max) {
      if (decoded.getWidth() >= decoded.getHeight()) {
        decoded.resize(max, Jimp.AUTO)
      } else {
        decoded.resize(Jimp.AUTO, max)
      }
    }
    const png = await decoded.getBufferAsync(Jimp.MIME_PNG)
    writeFileSync(thumb, png)
    return thumb
  } catch (err) {
    console.warn('[locallib] 缩略图生成失败，回退原图:', err)
    return localPath
  }
}

/* ---------------- locallib:// 协议 ---------------- */

function registerLocallibProtocol(): void {
  protocol.handle('locallib', async (request) => {
    const localPath = locallibPath(request.url)
    if (!localPath) {
      return new Response('bad locallib url', { status: 400 })
    }
    // 渲染层请求图片：优先缩略图（?thumb=1），否则原图
    const wantThumb = new URL(request.url).searchParams.get('thumb') === '1'
    const target = wantThumb ? await ensureThumb(localPath) : localPath
    try {
      if (!existsSync(target)) {
        return new Response('file not found', { status: 404 })
      }
      const stat = statSync(target)
      const ext = extname(target).slice(1).toLowerCase()
      const mime =
        ext === 'gif' ? 'image/gif' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
      const stream = createReadStream(target) as unknown as ReadableStream<Uint8Array>
      return new Response(stream, {
        headers: { 'Content-Type': mime, 'Content-Length': String(stat.size), 'Cache-Control': 'no-cache' }
      })
    } catch (err) {
      console.warn('[locallib] 协议读取失败:', request.url, err)
      return new Response('read failed', { status: 500 })
    }
  })
}

/* ---------------- 重复分析（异步 + 进度推送） ---------------- */

function sendToRenderers(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

/**
 * 分析任务串行队列：文件夹/上传/收藏分析互不并发，
 * 避免 scanCache 与 analysisState 被并发修改互相覆盖。
 */
let analysisChain: Promise<void> = Promise.resolve()
function enqueueAnalysis<T>(fn: () => Promise<T>): Promise<T> {
  const run = analysisChain.then(fn, fn)
  analysisChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/**
 * 对当前扫描结果执行重复分析（异步，后台进行）。
 * force=true 时清空哈希缓存强制全量重算（「重新分析」入口）。
 * 完成后把标记写回 scanCache 并推送 locallib:analyzed 事件。
 */
async function runDuplicateAnalysis(force = false): Promise<void> {
  return enqueueAnalysis(async () => {
    if (analysisState.running) return
    const files = scanCache
    if (!files.length) {
      analysisState = { running: false, done: 0, total: 0, duplicates: 0, scope: 'folder', scopes: analysisState.scopes }
      return
    }
    analysisState = { running: true, done: 0, total: files.length, duplicates: 0, scope: 'folder', scopes: analysisState.scopes }
    if (force) clearHashCache()
    sendToRenderers('locallib:analysis-progress', { ...analysisState })
    try {
      const marked = await analyzeDuplicates(files, 'folder', (done, total) => {
        analysisState = { ...analysisState, done, total }
        sendToRenderers('locallib:analysis-progress', { ...analysisState })
      }, force, cfg.hashType)
      scanCache = marked
      const folderDups = marked.filter((f) => f.duplicate).length
      analysisState = {
        running: false,
        done: marked.length,
        total: marked.length,
        duplicates: folderDups,
        scope: 'folder',
        scopes: { ...analysisState.scopes, folder: { duplicates: folderDups, total: marked.length } }
      }
      saveHashCache()
      sendToRenderers('locallib:analyzed', { files: scanCache, stats: analysisState })
    } catch (err) {
      console.error('[locallib] 重复分析失败:', err)
      analysisState = { ...analysisState, running: false }
    }
  })
}

/* ---------------- 上传库 / 收藏夹去重（scope=upload / favorite） ---------------- */

/** 渲染层传入的待分析条目（id 为原表情 id，url 用于解析磁盘路径） */
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

/**
 * 对上传库 / 收藏夹执行重复分析（跨 scope：与本地文件夹文件统一分组）。
 *
 * 条目中的 url 解析为本地磁盘路径（/uploads/... → 上传目录；绝对路径直用；
 * 种子 /static、网络 http(s) 不可解析则跳过）。解析到的文件与本地文件夹
 * scanCache 合并成一份列表统一比较，实现「上传库 ↔ 本地文件夹」互相去重：
 * 同一张图在上传和文件夹各存一份时，两边的记录都会被标记。
 *
 * - 文件夹标记写回 scanCache（下次 getLocallibState 即带跨库标记）
 * - 仅返回调用方传入条目的标记（按原 id；duplicateOf 若是文件夹 local_ id 则原样返回）
 * - 同一物理文件已被文件夹托管的上传条目跳过（由文件夹文件代表，避免自指重复）
 */
export async function analyzeScope(
  scope: 'upload' | 'favorite',
  items: ScopeAnalysisItem[]
): Promise<ScopeAnalysisMark[]> {
  return enqueueAnalysis(() => doAnalyzeScope(scope, items))
}

async function doAnalyzeScope(scope: 'upload' | 'favorite', items: ScopeAnalysisItem[]): Promise<ScopeAnalysisMark[]> {
  const folderPathSet = new Set(scanCache.map((f) => f.localPath))
  // 1. 解析条目为磁盘文件（跳过不可解析与已被文件夹托管的同一物理文件）
  const itemFiles: LocalFileEmoji[] = []
  for (const item of items) {
    const localPath = resolveEmojiLocalPath(item.url)
    if (!localPath || !existsSync(localPath)) continue
    const stat = statSync(localPath, { throwIfNoEntry: false })
    if (!stat?.isFile()) continue
    const ext = extname(localPath).slice(1).toLowerCase()
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) continue
    if (folderPathSet.has(localPath)) continue // 同一物理文件：由文件夹文件代表
    itemFiles.push({
      id: `scope-${String(item.id)}`, // 主进程内唯一 id（仅用于分组代表），不回写前端
      name: item.name || basename(localPath),
      url: 'locallib://f/' + encodeURIComponent(localPath),
      localPath,
      parentDir: basename(dirname(localPath)),
      tags: '',
      ext,
      size: stat.size,
      mtime: stat.mtimeMs
    })
  }
  if (!scanCache.length && !itemFiles.length) return []
  // 2. 跨 scope 统一分组：本地文件夹文件 + 上传/收藏条目一起比较（同样推送进度事件）
  const combined = [...scanCache, ...itemFiles]
  analysisState = { running: true, done: 0, total: combined.length, duplicates: 0, scope, scopes: analysisState.scopes }
  sendToRenderers('locallib:analysis-progress', { ...analysisState })
  const marked = await analyzeDuplicates(combined, scope, (done, total) => {
    analysisState = { ...analysisState, done, total }
    sendToRenderers('locallib:analysis-progress', { ...analysisState })
  }, false, cfg.hashType)
  // 3. 文件夹标记写回 scanCache（duplicateOf 若指向 scope 条目，换回原 id，保证前端分组一致）
  const idByScope = new Map(itemFiles.map((f) => [f.id, String(f.id).replace(/^scope-/, '')]))
  const toOrig = (id: string | undefined): string | undefined => (id ? (idByScope.get(id) ?? id) : id)
  scanCache = marked
    .filter((f) => folderPathSet.has(f.localPath))
    .map((f) => ({ ...f, duplicateOf: toOrig(f.duplicateOf) }))
  const folderDups = marked.filter((f) => folderPathSet.has(f.localPath) && f.duplicate).length
  const itemDups = marked.filter((f) => !folderPathSet.has(f.localPath) && f.duplicate).length
  analysisState = {
    running: false,
    done: marked.length,
    total: marked.length,
    duplicates: itemDups,
    scope,
    scopes: {
      ...analysisState.scopes,
      folder: { duplicates: folderDups, total: scanCache.length },
      [scope]: { duplicates: itemDups, total: itemFiles.length }
    }
  }
  saveHashCache()
  // 4. 只返回调用方传入条目的标记（按原 id）
  const result: ScopeAnalysisMark[] = []
  for (const m of marked) {
    if (!m.duplicate) continue
    const origId = idByScope.get(m.id)
    if (origId == null) continue
    result.push({
      id: origId,
      duplicate: true,
      duplicateLevel: m.duplicateLevel,
      duplicateOf: toOrig(m.duplicateOf),
      similarity: m.similarity
    })
  }
  return result
}

/* ---------------- 对外 API（IPC 调用） ---------------- */

/** 初始化：注册协议 + 加载配置 + 加载哈希缓存 + 首扫 + 触发重复分析（应用启动时调用一次） */
export function initLocallib(): void {
  loadConfig()
  loadHashCache()
  // 启动即扫描一次，保证首次打开「自定义」分类立即可见本地表情
  rescan()
  void runDuplicateAnalysis()
}

export function getLocallibState(): LocalLibraryState {
  return getState()
}

/** 读取重复分析状态（设置页进度条 / 各范围统计用） */
export function getLocallibAnalysisState(): typeof analysisState {
  return { ...analysisState, scopes: { ...analysisState.scopes } }
}

/** 添加文件夹（主进程弹窗选目录），返回是否成功 */
export async function addLocallibFolder(): Promise<{ ok: boolean; error?: string; state?: LocalLibraryState }> {
  try {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? undefined as any, {
      title: '选择表情包文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, error: 'cancelled' }
    }
    const folder = normalize(result.filePaths[0])
    if (!cfg.folders.includes(folder)) {
      cfg.folders.push(folder)
      saveConfig()
      rescan()
      void runDuplicateAnalysis()
    }
    return { ok: true, state: getState() }
  } catch (err) {
    console.error('[locallib] 添加文件夹失败:', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 移除托管文件夹（不删除磁盘文件，仅解除托管） */
export function removeLocallibFolder(folder: string): LocalLibraryState {
  cfg.folders = cfg.folders.filter((f) => f !== normalize(folder))
  saveConfig()
  rescan()
  void runDuplicateAnalysis()
  return getState()
}

/** 手动重新扫描全部托管文件夹（立即返回当前列表，重复分析在后台进行） */
export function rescanLocallib(): LocalLibraryState {
  rescan()
  void runDuplicateAnalysis()
  return getState()
}

/** 手动重新分析本地表情（强制清空哈希缓存全量重算），返回是否已开始 */
export function reanalyzeLocallib(): boolean {
  void runDuplicateAnalysis(true)
  return analysisState.running
}

/** 读取当前相似度算法（dHash / pHash） */
export function getLocallibHashType(): Exclude<HashType, 'md5'> {
  return cfg.hashType
}

/**
 * 设置相似度算法并触发重新分析。
 * 哈希缓存同时存了 dHash + pHash（一次解码算出），切换算法无需重算缓存。
 */
export function setLocallibHashType(type: Exclude<HashType, 'md5'>): boolean {
  const next = type === 'pHash' ? 'pHash' : DEFAULT_HASH_TYPE
  if (next === cfg.hashType) return false
  cfg.hashType = next
  saveConfig()
  void runDuplicateAnalysis()
  return true
}

/** 从软件移除某文件（加入忽略名单，不删除磁盘文件） */
export function ignoreLocallibFile(localPath: string): LocalLibraryState {
  const p = normalize(localPath)
  if (!cfg.ignored.includes(p)) {
    cfg.ignored.push(p)
    saveConfig()
    rescan()
    void runDuplicateAnalysis()
  }
  return getState()
}

/** 批量从软件移除文件（对比面板「移出本地库」用；一次重扫/重分析，避免逐条触发） */
export function ignoreLocallibFiles(paths: string[]): LocalLibraryState {
  let changed = false
  for (const raw of paths) {
    const p = normalize(String(raw || ''))
    if (p && !cfg.ignored.includes(p)) {
      cfg.ignored.push(p)
      changed = true
    }
  }
  if (changed) {
    saveConfig()
    rescan()
    void runDuplicateAnalysis()
  }
  return getState()
}

/** 恢复被忽略的文件（移出忽略名单，重新显示） */
export function unignoreLocallibFile(localPath: string): LocalLibraryState {
  const p = normalize(localPath)
  cfg.ignored = cfg.ignored.filter((f) => f !== p)
  saveConfig()
  rescan()
  void runDuplicateAnalysis()
  return getState()
}

/** 注册 locallib:// 协议（app ready 后调用） */
export function registerLocallibProtocolSafe(): void {
  registerLocallibProtocol()
}

/** 应用退出清理（watcher 预留） */
export function disposeLocallib(): void {
  stopWatcher()
}
