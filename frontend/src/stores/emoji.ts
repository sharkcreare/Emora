import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as api from '@/api/emoji'
import { resolveImageUrl } from '@/api/http'
import { showError } from '@/utils/feedback'
import { useGifConfig } from '@/stores/gifConfig'
import { applyDupKeep, buildDupGroup } from '@/utils/dupKeep'
import type { Emoji, PanelTab, SearchHistoryItem } from '@/types/emoji'

export const useEmojiStore = defineStore('emoji', () => {
  const keyword = ref('')
  const activeTab = ref<PanelTab>('hot')

  /** 请求序号：每次视图/关键词变化递增，过期响应（慢请求后到）直接丢弃，避免竞态覆盖 */
  let reqSeq = 0

  const emojis = ref<Emoji[]>([])
  const loading = ref(false)
  const total = ref(0)
  const page = ref(1)
  /** 普通视图每页数量（热门/分类/最近） */
  const size = 60
  /** 搜索/梗图库一次拉取的条数：尽可能多给（本地 200 + 每个网络源 100） */
  const searchSize = 200
  /** 当前视图页大小（搜索时用 searchSize，其余视图 36） */
  const pageSize = computed(() => (keyword.value.trim() || activeTab.value === 'bqb' ? searchSize : size))

  /** 输入法候选窗模式（紧凑小窗）：持久化到 localStorage，切换时主进程同步调整窗口尺寸 */
  const COMPACT_KEY = 'panel-compact-mode'
  const compactMode = ref(localStorage.getItem(COMPACT_KEY) === '1')

  /** 切换输入法候选窗模式（快捷键 Ctrl+I），同步主进程窗口尺寸 */
  function toggleCompactMode(): void {
    compactMode.value = !compactMode.value
    localStorage.setItem(COMPACT_KEY, compactMode.value ? '1' : '0')
    window.api?.setPanelMode(compactMode.value ? 'compact' : 'full')
  }

  /** 是否还有更多（搜索/分类分页时有效；热门/收藏/最近一次拉全量） */
  const hasMore = computed(() => emojis.value.length < total.value)

  const favoriteIds = ref<Set<number | string>>(new Set())
  const error = ref('')

  /** 网格列数（随窗口宽度自适应；键盘上下移动按行跳转） */
  const gridColumns = ref(4)

  /** 由 StickerGrid 实测实际渲染列数后更新 */
  function setGridColumns(n: number): void {
    if (n >= 1 && n <= 12) {
      gridColumns.value = n
    }
  }

  /** 当前键盘高亮的表情下标（-1 表示未选中） */
  const selectedIndex = ref(-1)
  /** 发送中标记，防止重复点击 */
  const sending = ref(false)

  /** 搜索历史（搜索框下拉展示） */
  const searchHistory = ref<SearchHistoryItem[]>([])

  /** 首屏分区：最近使用（横条展示）与热门（网格） */
  const recentEmojis = ref<Emoji[]>([])
  const hotEmojis = ref<Emoji[]>([])

  /** 本地文件夹托管扫描结果（source='FOLDER'，合并进「自定义」分类与本地搜索） */
  const localEmojis = ref<Emoji[]>([])
  /** 全部自定义上传记录（跨分页拉取，作为上传库去重全集与对比面板分组池） */
  const uploadEmojis = ref<Emoji[]>([])

  /** 隐藏重复开关（默认关闭，用户手动开启；localStorage 持久化） */
  const HIDE_DUP_KEY = 'emoji-assistant-hide-duplicates'
  const hideDuplicates = ref(localStorage.getItem(HIDE_DUP_KEY) === '1')
  function setHideDuplicates(v: boolean): void {
    hideDuplicates.value = v
    localStorage.setItem(HIDE_DUP_KEY, v ? '1' : '0')
  }

  /**
   * 重复组「保留选择」：{ 组代表 id: 保留的文件 id }（localStorage 持久化）。
   * 用户在相似图对比面板选择保留哪张后，其余成员从本地列表隐藏（不动磁盘）。
   */
  const DUP_KEEP_KEY = 'emoji-assistant-dup-keep'
  function loadDupKeep(): Record<string, string> {
    try {
      const raw = JSON.parse(localStorage.getItem(DUP_KEEP_KEY) ?? '{}') as Record<string, string>
      return raw && typeof raw === 'object' ? raw : {}
    } catch {
      return {}
    }
  }
  const dupKeepMap = ref<Record<string, string>>(loadDupKeep())
  function persistDupKeep(): void {
    localStorage.setItem(DUP_KEEP_KEY, JSON.stringify(dupKeepMap.value))
  }
  /** 已解决（保留某张）的重复组数量，用于过滤条「恢复」入口 */
  const dupResolvedCount = computed(() => Object.keys(dupKeepMap.value).length)

  /** 相似图对比面板状态（点击重复角标弹出） */
  const compareOpen = ref(false)
  const compareGroup = ref<Emoji[]>([])
  const compareRepId = ref('')
  const compareKeepId = ref('')

  /** 跨 scope 对比分组池：本地文件夹 + 上传库 + 当前视图（按 id 去重）。
      上传↔文件夹互相去重后，重复组可能跨库，必须合并查找成员 */
  function buildComparePool(): Emoji[] {
    const seen = new Set<string>()
    const out: Emoji[] = []
    for (const e of [...localEmojis.value, ...uploadEmojis.value, ...emojis.value]) {
      const key = String(e.id)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(e)
      }
    }
    return out
  }

  /** 打开对比面板：根据被点击的表情定位其重复组，默认选中当前保留（无则组代表） */
  function openDuplicateCompare(emoji: Emoji): void {
    if (emoji.source !== 'FOLDER' && emoji.source !== 'UPLOAD') return
    const group = buildDupGroup(emoji, buildComparePool())
    if (!group.length) return
    const repId = emoji.duplicateOf ?? String(emoji.id)
    compareGroup.value = group
    compareRepId.value = repId
    compareKeepId.value = dupKeepMap.value[repId] ?? repId
    compareOpen.value = true
  }

  function closeDuplicateCompare(): void {
    compareOpen.value = false
  }

  /** 全库重复组：{ repId, members }（跨 scope；组代表不在池中的孤儿组跳过）。
      用于「删除全部重复副本」批量操作与统计 */
  interface DupGroup {
    repId: string
    members: Emoji[]
  }
  function buildAllDupGroups(): DupGroup[] {
    const pool = buildComparePool()
    const idSet = new Set(pool.map((e) => String(e.id)))
    const byRep = new Map<string, Emoji[]>()
    for (const e of pool) {
      if (!e.duplicate || !e.duplicateOf) continue
      if (!idSet.has(e.duplicateOf)) continue // 组代表不在池中 → 孤儿组，不动它
      const arr = byRep.get(e.duplicateOf) ?? []
      arr.push(e)
      byRep.set(e.duplicateOf, arr)
    }
    return [...byRep.entries()].map(([repId, members]) => ({ repId, members }))
  }

  /** 全部重复副本数量（每组保留：用户已选保留项优先，否则组代表；其余都是副本） */
  const dupAllCopies = computed(() => {
    let n = 0
    for (const g of buildAllDupGroups()) {
      const keeper = dupKeepMap.value[g.repId] ?? g.repId
      n += g.members.filter((m) => String(m.id) !== keeper).length
    }
    return n
  })

  /** 批量删除进度（对比面板「删除全部重复副本」用） */
  const batchRemove = ref<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 })

  /**
   * 删除本地库中全部重复副本（每组保留代表/用户已选保留项）。
   * UPLOAD → 删除后端记录；FOLDER → 批量加入忽略名单（磁盘文件均保留）。
   * 删除过程中实时更新 batchRemove 进度；完成后清理已解决组的保留记录并刷新视图。
   */
  async function removeAllDuplicates(): Promise<number> {
    if (batchRemove.value.running) return 0
    const groups = buildAllDupGroups()
    const toRemoveUpload: Emoji[] = []
    const toRemoveFolder: Emoji[] = []
    for (const g of groups) {
      const keeper = dupKeepMap.value[g.repId] ?? g.repId
      for (const m of g.members) {
        if (String(m.id) === keeper) continue
        if (m.source === 'UPLOAD') toRemoveUpload.push(m)
        else if (m.source === 'FOLDER') toRemoveFolder.push(m)
      }
    }
    const total = toRemoveUpload.length + toRemoveFolder.length
    if (!total) return 0
    batchRemove.value = { running: true, done: 0, total }
    let done = 0
    try {
      // 上传记录：逐条删除并推进进度
      for (const e of toRemoveUpload) {
        if (typeof e.id === 'number') {
          try {
            await api.deleteEmoji(e.id)
          } catch {
            /* 单个删除失败继续 */
          }
        }
        done++
        batchRemove.value = { running: true, done, total }
      }
      uploadEmojis.value = uploadEmojis.value.filter((e) => !toRemoveUpload.some((o) => String(o.id) === String(e.id)))
      // 本地文件：一次性批量忽略
      if (toRemoveFolder.length) {
        await window.api?.ignoreLocallibFiles(toRemoveFolder.map((e) => e.localPath as string))
        await loadLocalLib()
      }
      // 已处理完的组清掉保留记录（组只剩保留项，无需再隐藏）
      const resolved = new Set(groups.map((g) => g.repId))
      const next = { ...dupKeepMap.value }
      let changed = false
      for (const repId of resolved) {
        if (next[repId] !== undefined) {
          delete next[repId]
          changed = true
        }
      }
      if (changed) {
        dupKeepMap.value = next
        persistDupKeep()
      }
      compareOpen.value = false
      refreshLocalView()
      return total
    } finally {
      batchRemove.value = { running: false, done: total, total }
    }
  }

  /** 本地视图刷新（自定义分类/搜索重跑，反映保留/移除后的过滤结果） */
  function refreshLocalView(): void {
    if (activeTab.value === 'custom' || keyword.value.trim()) {
      void (keyword.value.trim() ? search(keyword.value) : loadTab('custom'))
    }
  }

  /** 保留某张，其余隐藏（本地持久化，不动磁盘） */
  function keepInGroup(repId: string, keepId: string): void {
    dupKeepMap.value = { ...dupKeepMap.value, [repId]: keepId }
    persistDupKeep()
    compareOpen.value = false
    refreshLocalView()
  }

  /** 保留某张，其余移出本地库：按来源分流——UPLOAD → 删除上传记录；FOLDER → 批量忽略名单（磁盘文件保留）。
      跨库重复组可能同时含上传记录与本地文件，两者分别处理 */
  async function removeOthersFromLibrary(repId: string, keepId: string): Promise<void> {
    const kept = compareGroup.value.find((e) => String(e.id) === keepId)
    const others = compareGroup.value.filter((e) => String(e.id) !== keepId)
    if (!kept || !others.length) return
    try {
      const uploadOthers = others.filter((e) => e.source === 'UPLOAD')
      const folderOthers = others.filter((e) => e.source === 'FOLDER')
      if (uploadOthers.length) {
        for (const e of uploadOthers) {
          if (typeof e.id === 'number') {
            try {
              await api.deleteEmoji(e.id)
            } catch {
              /* 单个删除失败继续 */
            }
          }
        }
        uploadEmojis.value = uploadEmojis.value.filter((e) => !uploadOthers.some((o) => String(o.id) === String(e.id)))
      }
      if (folderOthers.length) {
        await window.api?.ignoreLocallibFiles(folderOthers.map((e) => e.localPath as string))
        await loadLocalLib()
      }
      // 移出后该组只剩保留项：清掉保留记录，重新拉取
      const next = { ...dupKeepMap.value }
      delete next[repId]
      dupKeepMap.value = next
      persistDupKeep()
      compareOpen.value = false
      refreshLocalView()
    } catch (err) {
      showError('locallib-remove-dup', err instanceof Error ? err.message : '移出本地库失败')
    }
  }

  /** 恢复全部被隐藏的重复组（清空保留选择） */
  function restoreHiddenDuplicates(): void {
    dupKeepMap.value = {}
    persistDupKeep()
    refreshLocalView()
  }

  /** 某表情是否为当前保留项（角标提示「已保留」用） */
  function isKeptDuplicate(emoji: Emoji): boolean {
    if (!emoji.duplicate) return false
    const repId = emoji.duplicateOf
    if (!repId) return false
    return dupKeepMap.value[repId] === String(emoji.id)
  }

  /** 重复分析进度（设置页进度条 / 自定义分类过滤条用）。
      scopes 记录各范围（文件夹/上传库/收藏夹）最近一次完成的分析统计，设置页统一展示 */
  const duplicateAnalysis = ref<{
    running: boolean
    done: number
    total: number
    duplicates: number
    scope: string
    scopes: Partial<Record<'folder' | 'upload' | 'favorite', { duplicates: number; total: number }>>
  }>({ running: false, done: 0, total: 0, duplicates: 0, scope: 'folder', scopes: {} })
  /** 各范围去重统计（StickerGrid 过滤条 / 设置页展示用） */
  const scopeStats = computed(() => duplicateAnalysis.value.scopes ?? {})

  /** 拉取本地文件夹托管状态并转成 Emoji 列表（打开面板/手动刷新时调用） */
  async function loadLocalLib(): Promise<void> {
    try {
      const [state, analysis] = await Promise.all([window.api?.getLocallibState(), window.api?.getLocallibAnalysisState()])
      if (!state) return
      localEmojis.value = state.files.map((f) => ({
        id: f.id,
        name: f.name,
        url: f.url,
        tags: f.tags || '',
        category: 'custom',
        hotScore: 0,
        source: 'FOLDER',
        createTime: new Date(f.mtime).toISOString(),
        localPath: f.localPath,
        parentDir: f.parentDir,
        duplicate: f.duplicate,
        duplicateLevel: f.duplicateLevel,
        duplicateOf: f.duplicateOf,
        similarity: f.similarity
      }))
      if (analysis) duplicateAnalysis.value = analysis
      // 清理已失效的保留记录：保留的文件已被移除（如移出本地库）时删除对应组记录
      const alive = new Set(state.files.map((f) => f.id))
      const pruned: Record<string, string> = {}
      for (const [repId, keepId] of Object.entries(dupKeepMap.value)) {
        if (alive.has(keepId)) pruned[repId] = keepId
      }
      if (Object.keys(pruned).length !== Object.keys(dupKeepMap.value).length) {
        dupKeepMap.value = pruned
        persistDupKeep()
      }
    } catch {
      /* 主进程不可用时保持空列表 */
    }
  }

  /** 本地搜索：先应用「保留选择」（已解决组只显示保留项），再按隐藏重复开关过滤，最后匹配文件名/父目录名 */
  function filterLocalByKeyword(list: Emoji[], kw: string): Emoji[] {
    let out = applyDupKeep(list, dupKeepMap.value)
    if (hideDuplicates.value) {
      out = out.filter((e) => !e.duplicate)
    }
    const q = kw.trim().toLowerCase()
    if (!q) return out
    return out.filter((e) => e.name.toLowerCase().includes(q) || (e.parentDir ?? '').toLowerCase().includes(q))
  }

  /** 拉取全部自定义上传记录（跨分页），作为上传库去重全集（含对比面板分组池） */
  async function loadAllUploads(): Promise<void> {
    try {
      const all: Emoji[] = []
      let page = 1
      for (;;) {
        const res = await api.getByCategory('custom', page, 100)
        all.push(...res.records)
        if (all.length >= res.total || res.records.length < 100) break
        page++
      }
      uploadEmojis.value = all.filter((e) => e.source === 'UPLOAD')
    } catch {
      /* 后端不可用时保持空列表 */
    }
  }

  /** 上传库/收藏夹去重：主进程分析后把标记合并进列表，返回 原id→标记 映射 */
  async function analyzeScopeMarks(scope: 'upload' | 'favorite', list: Emoji[]): Promise<void> {
    if (!list.length || !window.api) return
    try {
      const marks = await window.api.analyzeLocallibScope(
        scope,
        list.map((e) => ({ id: e.id, name: e.name, url: e.localPath ?? e.url }))
      )
      const byId = new Map(marks.map((m) => [String(m.id), m]))
      for (const e of list) {
        const m = byId.get(String(e.id))
        if (m) {
          e.duplicate = m.duplicate
          e.duplicateLevel = m.duplicateLevel
          e.duplicateOf = m.duplicateOf
          e.similarity = m.similarity
        }
      }
    } catch {
      /* 分析失败不影响展示 */
    }
  }

  /**
   * 全 scope 重新分析（设置页「重新分析」入口）：
   * 文件夹（强制清缓存全量重算）→ 上传库 → 收藏夹，依次串行执行。
   * 各阶段进度通过 locallib:analysis-progress 事件上报，设置页进度条与统计统一更新。
   */
  async function reanalyzeAllScopes(): Promise<void> {
    await window.api?.reanalyzeLocallib()
    await loadAllUploads()
    await analyzeScopeMarks('upload', uploadEmojis.value)
    try {
      const favs = await api.getFavorites()
      await analyzeScopeMarks('favorite', favs)
    } catch {
      /* 收藏拉取失败不影响其他范围 */
    }
  }

  /** 监听主进程重复分析进度与完成事件（首次进入页面时注册一次） */
  let locallibListenersAttached = false
  function attachLocallibListeners(): void {
    if (locallibListenersAttached) return
    locallibListenersAttached = true
    window.api?.onLocallibAnalysisProgress((s) => {
      duplicateAnalysis.value = s
    })
    window.api?.onLocallibAnalyzed((files) => {
      // 分析完成：主进程已把标记写回 scanCache，重新拉取最新状态
      void loadLocalLib()
      // 当前在「自定义」分类或搜索中 → 同步刷新当前列表
      if (activeTab.value === 'custom' || keyword.value.trim()) {
        void (keyword.value.trim() ? search(keyword.value) : loadTab('custom'))
      }
      void files // 主进程已更新，直接忽略入参
    })
  }

  /** 发送成功 HUD 提示（面板顶部短暂浮现，对齐 Raycast 的 ✓ Copied 反馈） */
  const sendHud = ref(false)
  let hudTimer: ReturnType<typeof setTimeout> | undefined
  function flashSendHud(): void {
    sendHud.value = true
    clearTimeout(hudTimer)
    hudTimer = setTimeout(() => {
      sendHud.value = false
    }, 420)
  }

  /**
   * 首次遇到超大 GIF 且未开启压缩时，提示用户是否开启（主进程通过 hint 标记告知）。
   * 用户选择后保存配置：开启 → 持久化并立即生效；本次不开启 → 免打扰（下次启动重新提示）。
   */
  async function maybePromptGifCompress(): Promise<void> {
    const gifCfg = useGifConfig()
    if (gifCfg.config.enabled || !gifCfg.shouldPrompt()) return
    try {
      await ElMessageBox.confirm(
        '检测到超大 GIF，直接发送可能无法在微信/QQ 正常显示。是否开启「发送前自动压缩」？',
        '开启 GIF 自动压缩？',
        {
          confirmButtonText: '开启',
          cancelButtonText: '本次不开启',
          type: 'info'
        }
      )
      await gifCfg.set({ enabled: true })
    } catch {
      // 用户选择「本次不开启」：免打扰，下次启动重新提示
      gifCfg.dismissPrompt()
    }
  }

  /**
   * 加载前统一处理：仅有旧数据时不显示骨架屏（静默刷新，避免每次呼出面板闪烁），
   * 数据为空时才进入 loading 骨架屏。
   */
  function beginLoad(): void {
    error.value = ''
    if (emojis.value.length === 0) {
      loading.value = true
    }
  }

  /** 点击复制：图片以图片格式写入系统剪贴板（PNG/JPG/GIF 均含图片数据），面板不关闭，可连续复制 */
  async function sendEmoji(emoji: Emoji): Promise<void> {
    if (sending.value) return
    sending.value = true
    try {
      if (!window.api) {
        ElMessage.warning('当前运行环境无桌面 API，无法复制（请用 Electron 运行）')
        return
      }
      const res = await window.api.sendEmoji({
        id: emoji.id,
        name: emoji.name,
        // 本地文件夹文件：直接传磁盘路径（clipboard 本地路径分支）；其余拼后端地址
        url: emoji.localPath ?? resolveImageUrl(emoji.url)
      })
      if (res.ok) {
        flashSendHud()
        if (res.hint) {
          await maybePromptGifCompress()
        }
      } else {
        showError('clipboard-send', `复制失败：${res.error ?? '未知错误'}`)
      }
    } finally {
      sending.value = false
    }
  }

  /** 键盘发送：发当前高亮项，未高亮则发列表第一个 */
  async function sendSelected(): Promise<void> {
    const list = emojis.value
    if (!list.length) return
    await sendEmoji(list[selectedIndex.value >= 0 ? selectedIndex.value : 0])
  }

  /** Ctrl+C：仅复制当前选中表情到剪贴板，不自动粘贴 */
  async function copyEmoji(emoji: Emoji): Promise<void> {
    if (sending.value) return
    sending.value = true
    try {
      if (!window.api) {
        ElMessage.warning('当前运行环境无桌面 API，无法复制（请用 Electron 运行）')
        return
      }
      const res = await window.api.copyEmoji({
        id: emoji.id,
        name: emoji.name,
        url: emoji.localPath ?? resolveImageUrl(emoji.url)
      })
      if (res.ok) {
        flashSendHud()
        if (res.hint) {
          await maybePromptGifCompress()
        }
      } else {
        showError('clipboard-copy', `复制失败：${res.error ?? '未知错误'}`)
      }
    } finally {
      sending.value = false
    }
  }

  /** 高亮指定下标（悬停时调用） */
  function setSelected(index: number): void {
    if (index >= 0 && index < emojis.value.length) {
      selectedIndex.value = index
    }
  }

  /** 方向键移动高亮：delta 为 ±1（左右）或 ±网格列数（上下），到边界停止 */
  function moveSelection(delta: number): void {
    const list = emojis.value
    if (!list.length) return
    if (selectedIndex.value < 0) {
      selectedIndex.value = delta > 0 ? 0 : list.length - 1
      return
    }
    const next = selectedIndex.value + delta
    if (next >= 0 && next < list.length) {
      selectedIndex.value = next
    }
  }

  /** 列表刷新后重置高亮 */
  function resetSelection(): void {
    selectedIndex.value = -1
  }

  /** 关键词搜索（append=true 时触底加载下一页，追加到列表尾部） */
  async function search(text: string, append = false): Promise<void> {
    if (!text.trim()) {
      await loadTab(activeTab.value)
      return
    }
    const seq = ++reqSeq
    beginLoad()
    try {
      const next = append ? page.value + 1 : 1
      const res = await api.searchEmojis(text.trim(), next, searchSize)
      // 本地文件夹托管：搜索时合并文件名/父目录命中的本地文件（第一页；追加分页不重复合并）
      let localHits: Emoji[] = []
      if (!append) {
        await loadLocalLib()
        localHits = filterLocalByKeyword(localEmojis.value, text)
      }
      // 期间又发起了更新的请求，丢弃本次结果
      if (seq !== reqSeq) return
      emojis.value = append ? [...emojis.value, ...res.records] : [...res.records, ...localHits]
      total.value = res.total + (append ? 0 : localHits.length)
      page.value = next
      // 进入搜索视图时收起首屏横条
      if (!append) {
        recentEmojis.value = []
        hotEmojis.value = []
      }
      if (!append) resetSelection()
    } catch (e) {
      if (seq !== reqSeq) return
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (seq === reqSeq) {
        loading.value = false
      }
    }
  }

  /** 首页视图：最近使用优先 + 热门补足（去重），无最近使用时退化为纯热门；同时保存分区数据供横条展示 */
  async function loadHomeList(): Promise<Emoji[]> {
    const [recent, hot] = await Promise.all([api.getRecentEmojis(10), api.getHotEmojis(size)])
    recentEmojis.value = recent
    hotEmojis.value = hot
    const merged: Emoji[] = []
    const seen = new Set<number | string>()
    for (const e of recent) {
      if (!seen.has(e.id)) {
        seen.add(e.id)
        merged.push(e)
      }
    }
    for (const e of hot) {
      if (merged.length >= size) break
      if (!seen.has(e.id)) {
        seen.add(e.id)
        merged.push(e)
      }
    }
    return merged
  }

  /** 切换标签（热门/分类/收藏/最近）；append=true 时分类分页追加 */
  async function loadTab(tab: PanelTab, append = false): Promise<void> {
    activeTab.value = tab
    // 切换标签属于新视图，令在途请求全部过期；触底追加沿用当前序号
    const seq = ++reqSeq
    beginLoad()
    try {
      let list: Emoji[]
      switch (tab) {
        case 'hot':
          // 首屏默认最近使用 + 热门混合（高频场景：呼出即可看到常用表情）
          list = await loadHomeList()
          total.value = list.length
          break
        case 'bqb':
          // 梗图库：无关键词随机浏览网络图库（不入库，不可收藏）
          list = await api.browseNetworkEmojis(searchSize)
          total.value = list.length
          break
        case 'favorite': {
          list = await api.getFavorites()
          // 收藏去重：可解析的收藏项（上传/本地文件）分析并标记
          await analyzeScopeMarks('favorite', list)
          list = applyDupKeep(list, dupKeepMap.value)
          total.value = list.length
          break
        }
        case 'recent':
          list = await api.getRecentEmojis(size)
          total.value = list.length
          break
        case 'custom': {
          // 自定义分类 = 后端上传记录 + 本地文件夹托管文件（用户看到的统一自定义表情库）
          const next = append ? page.value + 1 : 1
          const res = await api.getByCategory(tab, next, size)
          if (!append) {
            // 跨库去重：拉全量上传 → 主进程与文件夹统一分析 → 标记写回 uploadEmojis 与 scanCache
            await loadAllUploads()
            await analyzeScopeMarks('upload', uploadEmojis.value)
          }
          await loadLocalLib()
          // 上传标记合并进本页记录（uploadEmojis 与 res.records 是不同实例；追加页沿用同一次会话标记）
          const markById = new Map(uploadEmojis.value.map((e) => [String(e.id), e]))
          for (const rec of res.records) {
            const m = markById.get(String(rec.id))
            if (m && m.duplicate) {
              rec.duplicate = true
              rec.duplicateLevel = m.duplicateLevel
              rec.duplicateOf = m.duplicateOf
              rec.similarity = m.similarity
            }
          }
          // 上传记录也应用「保留选择」（隐藏已解决组的其余成员）
          const uploads = applyDupKeep(res.records, dupKeepMap.value)
          const locals = filterLocalByKeyword(localEmojis.value, keyword.value)
          list = append ? [...emojis.value, ...uploads] : [...uploads, ...locals]
          total.value = res.total + locals.length
          page.value = next
        }
        default: {
          const next = append ? page.value + 1 : 1
          const res = await api.getByCategory(tab, next, size)
          list = append ? [...emojis.value, ...res.records] : res.records
          total.value = res.total
          page.value = next
        }
      }
      if (seq !== reqSeq) return
      emojis.value = list
      if (!append) {
        resetSelection()
        if (tab !== 'hot') {
          recentEmojis.value = []
          hotEmojis.value = []
        }
      }
    } catch (e) {
      if (seq !== reqSeq) return
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (seq === reqSeq) {
        loading.value = false
      }
    }
  }

  /** 触底加载更多（仅搜索 / 分类分页场景，热门/收藏/最近无分页） */
  async function loadMore(): Promise<void> {
    if (loading.value || !hasMore.value) return
    if (keyword.value.trim()) {
      await search(keyword.value, true)
    } else {
      await loadTab(activeTab.value, true)
    }
  }

  /** 梗图库刷新：重新随机拉一批（BQB/萌芽每次随机，点一次换一批） */
  async function refreshBqb(): Promise<void> {
    if (loading.value || keyword.value.trim()) return
    await loadTab('bqb')
  }

  /** 删除/移除后从当前列表移除（不用全量刷新，避免闪烁） */
  function removeEmojiFromList(id: number | string): void {
    emojis.value = emojis.value.filter((e) => e.id !== id)
    total.value = Math.max(0, total.value - 1)
    favoriteIds.value.delete(id)
    if (selectedIndex.value >= emojis.value.length) {
      resetSelection()
    }
  }

  /** 从本地库移除某文件（加入忽略名单，不删除磁盘文件），并刷新列表 */
  async function ignoreLocalFile(emoji: Emoji): Promise<void> {
    if (emoji.source !== 'FOLDER' || !emoji.localPath) return
    await window.api?.ignoreLocallibFile(emoji.localPath)
    await loadLocalLib()
    removeEmojiFromList(emoji.id)
  }

  /** 网络图库来源（不入库，不可收藏） */
  const NETWORK_SOURCES = new Set(['BQB', 'SOGOU', 'BAIDU', 'GIPHY', 'TENOR', 'MEMENGYA'])

  /** 本地文件夹文件的收藏：纯本地持久化（不依赖后端），存 localStorage，key 用主进程生成的 local_xxx ID */
  const LOCAL_FAVS_KEY = 'emoji-assistant-localfavs'
  function loadLocalFavIds(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(LOCAL_FAVS_KEY) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  }
  function saveLocalFavIds(set: Set<string>): void {
    localStorage.setItem(LOCAL_FAVS_KEY, JSON.stringify([...set]))
  }

  /** 收藏切换：本地文件夹文件（FOLDER）走 localStorage，其余走后端 */
  async function toggleFavorite(emoji: Emoji): Promise<void> {
    // 网络图库表情不入库，跳过收藏
    if (NETWORK_SOURCES.has(emoji.source)) return
    if (emoji.source === 'FOLDER') {
      const set = loadLocalFavIds()
      if (set.has(String(emoji.id))) {
        set.delete(String(emoji.id))
      } else {
        set.add(String(emoji.id))
      }
      saveLocalFavIds(set)
      favoriteIds.value = new Set([...loadLocalFavIds()])
      return
    }
    const id = emoji.id as number
    if (favoriteIds.value.has(id)) {
      await api.removeFavorite(id)
      favoriteIds.value.delete(id)
    } else {
      await api.addFavorite(id)
      favoriteIds.value.add(id)
    }
    // 收藏页实时移除
    if (activeTab.value === 'favorite') {
      removeEmojiFromList(emoji.id)
    }
  }

  async function loadFavorites(): Promise<void> {
    try {
      const list = await api.getFavorites()
      favoriteIds.value = new Set([...list.map((e) => e.id), ...loadLocalFavIds()])
    } catch {
      favoriteIds.value = new Set(loadLocalFavIds())
    }
  }

  async function loadSearchHistory(): Promise<void> {
    try {
      searchHistory.value = await api.getSearchHistory(10)
    } catch {
      searchHistory.value = []
    }
  }

  async function clearHistory(): Promise<void> {
    try {
      await api.clearSearchHistory()
      searchHistory.value = []
    } catch {
      /* 忽略，清空失败下次再试 */
    }
  }

  /** 确保后端可用：主进程会自动拉起内置后端（幂等），首次呼出时可能等待几秒 */
  async function ensureBackend(): Promise<void> {
    try {
      await window.api?.ensureBackend()
    } catch {
      /* 忽略，后续请求会给出错误提示 */
    }
  }

  /** 面板每次呼出时刷新当前页数据、收藏与搜索历史；已有数据时静默刷新 */
  async function refresh(): Promise<void> {
    beginLoad()
    await ensureBackend()
    attachLocallibListeners()
    // 本地文件夹托管：每次刷新拉取最新扫描（打开面板自动扫描的兜底路径）
    await Promise.all([
      loadLocalLib(),
      loadFavorites(),
      loadSearchHistory(),
      keyword.value ? search(keyword.value) : loadTab(activeTab.value)
    ])
  }

  return {
    keyword,
    activeTab,
    compactMode,
    toggleCompactMode,
    emojis,
    loading,
    error,
    total,
    page,
    size,
    searchSize,
    pageSize,
    hasMore,
    favoriteIds,
    selectedIndex,
    sending,
    gridColumns,
    searchHistory,
    recentEmojis,
    hotEmojis,
    localEmojis,
    uploadEmojis,
    hideDuplicates,
    setHideDuplicates,
    duplicateAnalysis,
    scopeStats,
    reanalyzeAllScopes,
    dupResolvedCount,
    dupAllCopies,
    batchRemove,
    removeAllDuplicates,
    compareOpen,
    compareGroup,
    compareRepId,
    compareKeepId,
    openDuplicateCompare,
    closeDuplicateCompare,
    keepInGroup,
    removeOthersFromLibrary,
    restoreHiddenDuplicates,
    isKeptDuplicate,
    sendHud,
    setGridColumns,
    sendEmoji,
    sendSelected,
    copyEmoji,
    setSelected,
    moveSelection,
    search,
    loadTab,
    loadMore,
    refreshBqb,
    toggleFavorite,
    removeEmojiFromList,
    ignoreLocalFile,
    loadSearchHistory,
    clearHistory,
    loadLocalLib,
    refresh
  }
})
