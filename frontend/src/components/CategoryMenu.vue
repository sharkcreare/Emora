<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import {
  TrendCharts,
  ChatLineRound,
  Picture,
  Sunny,
  Folder,
  Star,
  StarFilled,
  Clock,
  Collection
} from '@element-plus/icons-vue'
import { PANEL_TABS } from '@/types/emoji'
import { useEmojiStore } from '@/stores/emoji'

const store = useEmojiStore()

/** 图标名 → 组件映射（激活的「收藏」用实心星） */
const ICONS: Record<string, Component> = {
  TrendCharts,
  ChatLineRound,
  Picture,
  Sunny,
  Folder,
  Star,
  Clock,
  Collection
}

function iconOf(key: string): Component {
  // 收藏激活时用实心星，突出"已进入收藏视图"
  return key === 'favorite' && store.activeTab === 'favorite' && !store.keyword
    ? StarFilled
    : ICONS[key] ?? Star
}

function switchTab(key: (typeof PANEL_TABS)[number]['key']): void {
  store.keyword = ''
  void store.loadTab(key)
}

const activeClass = computed(() => (tabKey: string) =>
  store.activeTab === tabKey && !store.keyword ? 'active' : ''
)
</script>

<template>
  <nav class="category-menu">
    <button
      v-for="tab in PANEL_TABS"
      :key="tab.key"
      class="cat-tab"
      :class="activeClass(tab.key)"
      :title="tab.label"
      @click="switchTab(tab.key)"
    >
      <el-icon class="cat-icon" :size="13"><component :is="iconOf(tab.key)" /></el-icon>
      <span>{{ tab.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.category-menu {
  display: flex;
  gap: 1px;
  overflow-x: auto;
  padding: 0 2px 2px;
  /* 隐藏横向滚动条（鼠标滚轮仍可滚动） */
  scrollbar-width: none;
}
.category-menu::-webkit-scrollbar {
  display: none;
}
.cat-tab {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid transparent;
  background: transparent;
  padding: 4px 9px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-2);
  border-radius: 999px;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
  /* 分类按钮可点击，排除出拖动区域 */
  -webkit-app-region: no-drag;
}
/* 中性 hover：浅灰底，克制 */
.cat-tab:hover {
  background: var(--accent-soft-2);
  color: var(--text-1);
}
/* 激活态：主题色浅底 + 主题色文字，无渐变无重阴影（对齐 Telegram/Discord 导航范式） */
.cat-tab.active {
  background: var(--accent-soft);
  color: var(--accent-text);
  border-color: color-mix(in srgb, var(--accent) 38%, transparent);
  font-weight: 600;
}
.cat-icon {
  color: inherit;
}
</style>