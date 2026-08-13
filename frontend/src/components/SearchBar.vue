<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Search, Clock } from '@element-plus/icons-vue'
import { useEmojiStore } from '@/stores/emoji'

const store = useEmojiStore()
const input = ref('')
/** el-input 组件实例（只用到 focus） */
const inputRef = ref<{ focus: () => void } | null>(null)

/** 历史下拉显隐（失焦延迟隐藏，保证鼠标点击先触发） */
const showHistory = ref(false)
let blurTimer: ReturnType<typeof setTimeout> | undefined

let timer: ReturnType<typeof setTimeout> | undefined

watch(input, (val) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    store.keyword = val
    void store.search(val)
  }, 250)
})

/** 清空回到当前标签页 */
function clearSearch(): void {
  input.value = ''
  store.keyword = ''
  void store.loadTab(store.activeTab)
}

/** 点击历史关键词：回填搜索框并立即搜索 */
function applyHistory(kw: string): void {
  input.value = kw
  store.keyword = kw
  void store.search(kw)
}

function hideHistorySoon(): void {
  blurTimer = setTimeout(() => {
    showHistory.value = false
  }, 150)
}

/** 呼出面板时自动聚焦搜索框（输入法式：按快捷键即可直接打字） */
onMounted(() => {
  window.api?.onPanelShown(() => {
    // 等窗口显示稳定后再聚焦，避免过早聚焦失败
    setTimeout(() => inputRef.value?.focus(), 60)
  })
})
</script>

<template>
  <div class="search-bar">
    <div class="search-shell">
      <el-input
        ref="inputRef"
        v-model="input"
        placeholder="搜索表情包，如：我服了"
        clearable
        size="large"
        :prefix-icon="Search"
        @focus="showHistory = store.searchHistory.length > 0"
        @blur="hideHistorySoon"
        @clear="clearSearch"
        @keyup.esc="clearSearch"
      />
      <!-- AI 语义搜索标识：输入自然语言（如"老板让我加班"）也能匹配相关表情 -->
      <span class="ai-chip" title="AI 语义搜索已开启：支持自然语言匹配">AI</span>
    </div>

    <!-- 搜索历史下拉 -->
    <div v-if="showHistory && store.searchHistory.length" class="history-pop">
      <div class="history-head">
        <span>搜索历史</span>
        <button class="history-clear" type="button" @mousedown.prevent="store.clearHistory()">清空</button>
      </div>
      <div
        v-for="(h, i) in store.searchHistory"
        :key="`${h.keyword}-${i}`"
        class="history-item"
        @mousedown.prevent="applyHistory(h.keyword)"
      >
        <el-icon class="history-icon"><Clock /></el-icon>
        <span class="history-kw">{{ h.keyword }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-bar {
  position: relative;
  width: 100%;
}
/* Raycast 式搜索壳：聚焦时整框放大 + 双层光晕，主搜索框即窗口焦点 */
.search-shell {
  position: relative;
  display: flex;
  align-items: center;
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1);
  -webkit-app-region: no-drag;
}
.search-bar:focus-within .search-shell {
  transform: scale(1.012);
}
/* 搜索输入框需要交互，排除出拖动区域 */
.search-bar :deep(.el-input__wrapper) {
  -webkit-app-region: no-drag;
  border-radius: var(--radius-md);
  box-shadow: 0 0 0 1px var(--border-strong) inset;
  background: var(--surface-strong);
  transition:
    box-shadow 0.2s,
    background 0.2s;
}
.search-bar :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--text-3) 55%, transparent) inset;
}
.search-bar :deep(.el-input__wrapper.is-focus) {
  background: var(--surface-strong);
  box-shadow:
    0 0 0 1px var(--accent) inset,
    0 0 0 4px var(--accent-soft);
}
.search-bar :deep(.el-input__inner) {
  font-size: 13px;
  height: 28px;
  color: var(--text-1);
  padding-left: 2px;
}
.search-bar :deep(.el-input__inner::placeholder) {
  color: var(--text-3);
}
/* AI 徽标：渐变胶囊，悬浮在输入框右侧，标识语义搜索能力 */
.ai-chip {
  position: absolute;
  right: 30px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.6px;
  color: #fff;
  background: linear-gradient(135deg, #8b5cf6, #3b82f6);
  padding: 2px 6px;
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(59, 130, 246, 0.35);
  pointer-events: none;
  -webkit-app-region: no-drag;
  user-select: none;
}

/* 历史下拉 */
.history-pop {
  position: absolute;
  top: 42px;
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.16);
  padding: 6px;
  -webkit-app-region: no-drag;
}
.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 8px 4px;
  font-size: 11px;
  color: var(--text-3);
}
.history-clear {
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  transition: color 0.12s;
}
.history-clear:hover {
  color: var(--danger);
}
.history-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.12s;
}
.history-item:hover {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.history-icon {
  font-size: 13px;
  color: var(--text-3);
  flex-shrink: 0;
}
.history-kw {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>