<script setup lang="ts">
import { computed } from 'vue'
import { useEmojiStore } from '@/stores/emoji'
import { resolveImageUrl } from '@/api/http'

const store = useEmojiStore()

/** 网络图库来源（标记而不入库） */
const NETWORK_SOURCES = new Set(['BQB', 'SOGOU', 'BAIDU', 'GIPHY', 'TENOR', 'MEMENGYA'])

/** 当前悬停/键盘高亮的表情（预览条的核心数据源，与 store.emojis 下标对齐） */
const selected = computed(() => {
  const idx = store.selectedIndex
  if (idx >= 0 && idx < store.emojis.length) return store.emojis[idx]
  return null
})

/** 是否为 GIF 动图 */
function isGif(url: string): boolean {
  return /\.gif($|\?)/i.test(url)
}
function isNetwork(source: string): boolean {
  return NETWORK_SOURCES.has(source)
}
</script>

<template>
  <!-- 底部预览条：悬停/键盘选中时展示 大图 + 全名 + GIF 标记（对齐 emoji-mart preview / Discord 悬停放大）；
       无选中时为操作引导条（计数 + 快捷键），一步两用，替代原纯文字状态栏 -->
  <footer class="preview-bar">
    <Transition name="pv-fade" mode="out-in">
      <div v-if="selected" :key="selected.id" class="pv-item">
        <div class="pv-thumb">
          <img :src="resolveImageUrl(selected.url)" :alt="selected.name" />
        </div>
        <div class="pv-meta">
          <span class="pv-name" :title="selected.name">{{ selected.name }}</span>
          <span v-if="isNetwork(selected.source)" class="pv-source">{{ selected.source }}</span>
        </div>
        <div class="pv-actions">
          <span v-if="isGif(selected.url)" class="pv-gif">GIF</span>
          <span class="pv-hint">Enter 粘贴</span>
        </div>
      </div>
      <div v-else class="pv-idle" key="idle">
        <span class="pv-status">
          {{ store.loading && store.emojis.length ? '加载中…' : store.total > 0 ? `${store.total} 个表情` : '' }}
        </span>
        <span class="pv-hint">↑↓←→ 选择 · Enter 粘贴 · Ctrl+数字 粘贴</span>
      </div>
    </Transition>
  </footer>
</template>

<style scoped>
.preview-bar {
  flex: 0 0 44px;
  display: flex;
  align-items: center;
  padding: 4px 12px;
  border-top: 1px solid var(--border);
  background: linear-gradient(0deg, color-mix(in srgb, var(--surface-strong) 72%, transparent), transparent);
  box-shadow: 0 -1px 0 rgba(15, 23, 42, 0.02);
}

/* 选中态：预览大图 + 全名 + 操作提示 */
.pv-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-width: 0;
}
.pv-thumb {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--card-bg);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pv-thumb img {
  max-width: 100%;
  max-height: 100%;
}
.pv-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.pv-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pv-source {
  flex-shrink: 0;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--accent-text);
  background: var(--accent-soft);
  padding: 1.5px 7px;
  border-radius: var(--radius-sm);
}
.pv-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.pv-gif {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #fff;
  background: color-mix(in srgb, var(--accent) 82%, #000);
  padding: 2px 7px;
  border-radius: var(--radius-sm);
}
.pv-hint {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}

/* 窗口变窄时快捷键提示允许截断，避免撑破底部条 */
@media (max-width: 440px) {
  .pv-hint {
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

/* 空闲态：左计数 + 右快捷键引导 */
.pv-idle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-width: 0;
}
.pv-status {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 内容切换淡入（选中表情切换 / 空闲态互切） */
.pv-fade-enter-active,
.pv-fade-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}
.pv-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.pv-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>