<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEmojiStore } from '@/stores/emoji'
import type { Emoji } from '@/types/emoji'
import EmojiCard from './EmojiCard.vue'

const store = useEmojiStore()

/** 修复1：入场淡入由网格容器统一控制（替代原卡片级 card-in 动画）。
    列表切换（切tab/搜索）时自增 key → 容器重建 → 播放 fade-in；分页追加不触发。 */
const gridKey = ref(0)
watch(
  () => [store.activeTab, store.keyword],
  () => {
    gridKey.value++
  }
)

/** 网格容器（用于测量实际渲染列数，同步给键盘导航） */
const gridWrap = ref<HTMLElement | null>(null)
/** 底部哨兵：进入视口时加载下一页 */
const sentinel = ref<HTMLElement | null>(null)
let observer: ResizeObserver | null = null
let sentinelObserver: IntersectionObserver | null = null

function measureColumns(): void {
  const grid = gridWrap.value?.querySelector('.grid')
  if (!grid) return
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
  if (cols > 0) {
    store.setGridColumns(cols)
  }
}

onMounted(() => {
  observer = new ResizeObserver(() => measureColumns())
  if (gridWrap.value) {
    observer.observe(gridWrap.value)
  }
  void nextTick(measureColumns)

  // 触底加载更多（仅搜索/分类分页场景；hot/favorite/recent 无更多）
  sentinelObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      void store.loadMore()
    }
  })
  if (sentinel.value) {
    sentinelObserver.observe(sentinel.value)
  }
})

// 列表刷新（含分区重排）后重新测量
watch(
  () => store.emojis.length,
  () => void nextTick(measureColumns)
)

onBeforeUnmount(() => {
  observer?.disconnect()
  sentinelObserver?.disconnect()
})

const NETWORK_SOURCES = new Set(['BQB', 'SOGOU', 'BAIDU', 'GIPHY', 'TENOR', 'MEMENGYA'])
const isNetwork = (e: Emoji): boolean => NETWORK_SOURCES.has(e.source)

/** 本地与网络分区（同时存在时才显示分区标题） */
const localList = computed(() => store.emojis.filter((e) => !isNetwork(e)))
const networkList = computed(() => store.emojis.filter((e) => isNetwork(e)))
const showSections = computed(() => localList.value.length > 0 && networkList.value.length > 0)

/** GIF 动图与静态图分区：URL 以 .gif 结尾即视为动图 */
const isGifUrl = (e: Emoji): boolean => /\.gif($|\?)/i.test(e.url)
const gridGif = computed(() => gridList.value.filter(isGifUrl))
const gridImg = computed(() => gridList.value.filter((e) => !isGifUrl(e)))
const localGif = computed(() => localList.value.filter(isGifUrl))
const localImg = computed(() => localList.value.filter((e) => !isGifUrl(e)))
const networkGif = computed(() => networkList.value.filter(isGifUrl))
const networkImg = computed(() => networkList.value.filter((e) => !isGifUrl(e)))

/** 首屏横条：仅热门 tab 且无关键词时展示最近使用（候选窗模式下不显示横条） */
const showRecentStrip = computed(
  () => !store.compactMode && store.activeTab === 'hot' && !store.keyword && store.recentEmojis.length > 0 && !showSections.value
)
/** 横条已展示的表情 id（网格部分去重，避免重复） */
const recentIds = computed(() => new Set(store.recentEmojis.map((e) => e.id)))
/** 网格列表：横条存在时剔除已展示项 */
const gridList = computed(() => (showRecentStrip.value ? store.emojis.filter((e) => !recentIds.value.has(e.id)) : store.emojis))

/** 修复：渲染下标必须对齐 store.emojis 的真实下标（预览条 / 键盘导航 / 选中高亮都依赖它）。
    此前分区/去重后以 0 重排 index，会导致悬停高亮与预览条取到错误的表情。 */
const storeIndex = computed(() => {
  const map = new Map<number | string, number>()
  store.emojis.forEach((e, i) => map.set(e.id, i))
  return map
})
const indexAt = (e: Emoji): number => storeIndex.value.get(e.id) ?? 0

/** 隐藏重复过滤条：仅「自定义」分类 + 本地文件存在重复时显示（默认关闭）。
    数量取文件夹 scope 的分析统计（收藏/上传分析不会覆盖本地计数） */
const showDupFilter = computed(
  () => !store.compactMode && store.activeTab === 'custom' && dupCount.value > 0
)
/** 本地文件夹中重复数量（从 scope 统计读，不实时遍历） */
const dupCount = computed(() => store.scopeStats.folder?.duplicates ?? 0)

/** 错误态重试 */
function retry(): void {
  void store.refresh()
}

/** 空态引导：一键看热门 */
function jumpToHot(): void {
  store.keyword = ''
  void store.loadTab('hot')
}
</script>

<template>
  <div ref="gridWrap" class="sticker-grid-wrap" :class="{ compact: store.compactMode }">
    <!-- 加载骨架屏 -->
    <div v-if="store.loading && !store.emojis.length" class="skeleton">
      <div v-for="i in 12" :key="i" class="skeleton-card" />
    </div>

    <!-- 错误态 -->
    <div v-else-if="store.error" class="state">
      <div class="state-icon">📡</div>
      <p class="state-title">后端连接失败</p>
      <p class="state-sub">{{ store.error }}</p>
      <button class="state-btn" @click="retry">重试</button>
    </div>

    <!-- 空态 -->
    <div v-else-if="!store.emojis.length" class="state">
      <div class="state-icon">🫥</div>
      <p class="state-title">没有找到表情包</p>
      <p class="state-sub">换个关键词试试，或看看热门表情</p>
      <button class="state-btn" @click="jumpToHot">看看热门表情</button>
    </div>

    <!-- 候选窗模式：只渲染紧凑候选网格（无分区、无横条），对齐输入法候选体验 -->
    <div v-else-if="store.compactMode" class="grid compact-grid" :key="`compact-${gridKey}`">
      <EmojiCard v-for="emoji in gridList" :key="emoji.id" :emoji="emoji" :index="indexAt(emoji)" />
    </div>

    <!-- 结果：首屏横条 + 分区 + 网格 -->
    <template v-else>
      <!-- 隐藏重复过滤条（默认关闭；红=高度相似，黄=相似） -->
      <div v-if="showDupFilter" class="dup-filter">
        <span class="dup-filter-text">检测到 {{ dupCount }} 个重复表情</span>
        <div class="dup-filter-right">
          <button v-if="store.dupResolvedCount" class="dup-filter-btn" @click="store.restoreHiddenDuplicates">
            恢复已保留 {{ store.dupResolvedCount }} 组
          </button>
          <button class="dup-filter-btn" :class="{ active: store.hideDuplicates }" @click="store.setHideDuplicates(!store.hideDuplicates)">
            {{ store.hideDuplicates ? '显示全部' : '隐藏重复' }}
          </button>
        </div>
      </div>
      <div v-if="showRecentStrip" class="section">
        <h4 class="section-title">最近使用</h4>
        <div class="recent-strip">
          <EmojiCard v-for="(emoji, i) in store.recentEmojis" :key="`r-${emoji.id}`" :emoji="emoji" :index="indexAt(emoji)" />
        </div>
      </div>

      <template v-if="showSections">
        <div class="section">
          <h4 class="section-title">本地表情</h4>
          <template v-if="localGif.length && localImg.length">
            <div class="sub-grid-group">
              <h5 class="sub-title animated">GIF 动图（{{ localGif.length }}）</h5>
              <div class="grid" :key="`local-gif-${gridKey}`">
                <EmojiCard v-for="emoji in localGif" :key="emoji.id" :emoji="emoji" :index="indexAt(emoji)" />
              </div>
            </div>
            <div class="sub-grid-group">
              <h5 class="sub-title">静态图（{{ localImg.length }}）</h5>
              <div class="grid" :key="`local-img-${gridKey}`">
                <EmojiCard v-for="emoji in localImg" :key="emoji.id" :emoji="emoji" :index="indexAt(emoji)" />
              </div>
            </div>
          </template>
          <div v-else class="grid" :key="`local-${gridKey}`">
            <EmojiCard v-for="emoji in localList" :key="emoji.id" :emoji="emoji" :index="indexAt(emoji)" />
          </div>
        </div>
        <div class="section">
          <h4 class="section-title network">网络表情 <span class="source-chip">BQB · SOGOU · BAIDU · 萌芽 · GIPHY · TENOR</span></h4>
          <template v-if="networkGif.length && networkImg.length">
            <div class="sub-grid-group">
              <h5 class="sub-title animated">GIF 动图（{{ networkGif.length }}）</h5>
              <div class="grid" :key="`net-gif-${gridKey}`">
                <EmojiCard v-for="emoji in networkGif" :key="emoji.id" :emoji="emoji" :index="indexAt(emoji)" />
              </div>
            </div>
            <div class="sub-grid-group">
              <h5 class="sub-title">静态图（{{ networkImg.length }}）</h5>
              <div class="grid" :key="`net-img-${gridKey}`">
                <EmojiCard v-for="emoji in networkImg" :key="emoji.id" :emoji="emoji" :index="indexAt(emoji)" />
              </div>
            </div>
          </template>
          <div v-else class="grid" :key="`net-${gridKey}`">
            <EmojiCard
              v-for="emoji in networkList"
              :key="emoji.id"
              :emoji="emoji"
              :index="indexAt(emoji)"
            />
          </div>
        </div>
      </template>
      <template v-else>
        <template v-if="gridGif.length && gridImg.length">
          <div class="section">
            <h4 class="section-title animated">GIF 动图 <span class="sec-count">{{ gridGif.length }}</span></h4>
            <div class="grid" :key="`gif-${gridKey}`">
              <EmojiCard v-for="emoji in gridGif" :key="emoji.id" :emoji="emoji" :index="indexAt(emoji)" />
            </div>
          </div>
          <div class="section">
            <h4 class="section-title">静态图 <span class="sec-count">{{ gridImg.length }}</span></h4>
            <div class="grid" :key="`img-${gridKey}`">
              <EmojiCard v-for="emoji in gridImg" :key="emoji.id" :emoji="emoji" :index="indexAt(emoji)" />
            </div>
          </div>
        </template>
        <div v-else class="grid" :key="`grid-${gridKey}`">
          <EmojiCard v-for="emoji in gridList" :key="emoji.id" :emoji="emoji" :index="indexAt(emoji)" />
        </div>
      </template>
      <!-- 加载哨兵：进入视口自动加载下一页 -->
      <div ref="sentinel" class="load-sentinel">
        <span v-if="store.loading">加载中…</span>
        <span v-else-if="store.hasMore">上滑加载更多</span>
        <span v-else-if="store.total > store.pageSize">已显示全部</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sticker-grid-wrap {
  height: 100%;
  overflow-y: auto;
  /* 右侧让出 7px 给窗口调整大小手柄（.rh-e），否则手柄盖住滚动条无法拖动；
     左 10px + 右 3px 保持卡片距两侧视觉对称（滚动条在 7px 让位区左侧）。 */
  padding: 5px 3px 10px 10px;
  margin-right: 7px;
  /* 表情网格需要滚动/点击，排除出拖动区域 */
  -webkit-app-region: no-drag;
}

/* 输入法候选窗模式：更密的小图网格，一屏看更多候选 */
.sticker-grid-wrap.compact {
  padding: 6px 1px 8px 8px;
  margin-right: 7px;
}
.compact-grid {
  grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)) !important;
  gap: 5px !important;
}

.grid {
  display: grid;
  /* 修复1：容器级淡入（切 tab / 搜索切换时经 gridKey 重建触发） */
  animation: fade-in 0.18s ease;
  /* 紧凑列数：小图多列（对齐 emoji-mart 密度），最大化时卡片保持合适大小 */
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 7px;
}

/* 首屏最近使用横条：横向滚动的大图卡片 */
.recent-strip {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  /* 修复3：overflow-x:auto 会强制纵向裁剪，留出 padding 容纳卡片 hover 上浮（-2px） */
  padding: 5px 2px 5px;
  scrollbar-width: none;
}
.recent-strip::-webkit-scrollbar {
  display: none;
}
.recent-strip :deep(.emoji-card) {
  flex: 0 0 84px;
}

.section + .section {
  margin-top: 6px;
}

/* GIF/静态图二级分区标题（组内再分） */
.sub-grid-group + .sub-grid-group {
  margin-top: 1px;
}
.sub-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 6px 2px;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-3);
}
.sub-title::before {
  content: '';
  width: 3px;
  height: 10px;
  border-radius: 3px;
  background: var(--text-3);
}
/* 动图分区标题用主题色点缀（一眼区分 GIF/静态图） */
.sub-title.animated,
.section-title.animated {
  color: var(--accent-text);
}
.sub-title.animated::before,
.section-title.animated::before {
  background: var(--accent);
}
.sec-count {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-3);
  background: var(--surface-strong);
  padding: 1px 7px;
  border-radius: 999px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 7px 2px;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--text-3);
}
.section-title::before {
  content: '';
  width: 3px;
  height: 11px;
  border-radius: 3px;
  background: var(--text-3);
}
.section-title.network {
  color: var(--accent-text);
}
.section-title.network::before {
  background: var(--accent);
}
.source-chip {
  font-size: 10px;
  color: var(--accent-text);
  background: var(--accent-soft);
  padding: 1px 7px;
  border-radius: var(--radius-sm);
  letter-spacing: 0.3px;
}

/* 隐藏重复过滤条：底部信息条 + 切换按钮（默认关闭，红黄角标已提示重复） */
.dup-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  margin: 2px 0 6px;
  border-radius: var(--radius-md);
  background: var(--surface-strong);
  border: 1px solid var(--border);
}
.dup-filter-text {
  font-size: 10.5px;
  color: var(--text-3);
}
.dup-filter-btn {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  border-radius: 999px;
  padding: 2px 12px;
  font-size: 10.5px;
  cursor: pointer;
  transition: all 0.15s;
}
.dup-filter-btn:hover {
  border-color: var(--accent);
  color: var(--accent-text);
}
.dup-filter-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.dup-filter-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 加载哨兵 */
.load-sentinel {
  padding: 6px 0 3px;
  text-align: center;
  font-size: 10.5px;
  color: var(--text-3);
}

/* 骨架屏 */
.skeleton {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 7px;
}
.compact .skeleton {
  grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
  gap: 5px;
}
.skeleton-card {
  aspect-ratio: 1;
  border-radius: var(--radius-lg);
  background: linear-gradient(
    90deg,
    var(--surface-strong) 25%,
    color-mix(in srgb, var(--text-3) 14%, transparent) 37%,
    var(--surface-strong) 63%
  );
  background-size: 400% 100%;
  animation: shimmer 1.4s infinite;
}

/* 空态 / 错误态 */
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px 20px;
  text-align: center;
}
.state-icon {
  font-size: 42px;
  margin-bottom: 10px;
  filter: grayscale(0.2);
}
.state-title {
  margin: 0 0 4px;
  font-size: 14px;
  color: var(--text-1);
  font-weight: 500;
}
.state-sub {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--text-3);
}
.state-btn {
  border: 1px solid var(--accent);
  color: var(--accent-text);
  background: transparent;
  border-radius: 999px;
  padding: 6px 20px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.state-btn:hover {
  background: var(--accent);
  color: #fff;
}
</style>