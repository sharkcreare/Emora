<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Minus, FullScreen, CopyDocument, Close, Sunny, Moon, UploadFilled, Setting, Refresh, Grid } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { showError } from '@/utils/feedback'
import { useEmojiStore } from '@/stores/emoji'
import { useTheme } from '@/stores/theme'
import { useShortcuts, formatShortcutLabel, matchShortcut, matchQuickSend } from '@/stores/shortcuts'
import { useGifConfig } from '@/stores/gifConfig'
import * as api from '@/api/emoji'
import SearchBar from '@/components/SearchBar.vue'
import CategoryMenu from '@/components/CategoryMenu.vue'
import StickerGrid from '@/components/StickerGrid.vue'
import PreviewBar from '@/components/PreviewBar.vue'
import SettingsDialog from '@/components/SettingsDialog.vue'
import DuplicateCompareDialog from '@/components/DuplicateCompareDialog.vue'
import { PANEL_TABS } from '@/types/emoji'

const store = useEmojiStore()
const { theme, initTheme, toggleTheme } = useTheme()
const shortcutStore = useShortcuts()
const gifConfigStore = useGifConfig()
/** 窗口是否最大化（切换图标 + 去掉圆角留白） */
const maximized = ref(false)

/** 首启引导（首次运行展示快捷键/用法提示，点任意处关闭并持久化） */
const ONBOARD_KEY = 'emoji-assistant-onboarded'
const showOnboard = ref(localStorage.getItem(ONBOARD_KEY) !== '1')
function dismissOnboard(): void {
  showOnboard.value = false
  localStorage.setItem(ONBOARD_KEY, '1')
}

/** 上传自定义表情 */
const fileInput = ref<HTMLInputElement | null>(null)

/** 设置弹窗（内容已提取到 SettingsDialog.vue，这里只管理开关与初始 Tab） */
const settingsOpen = ref(false)
const settingsTabRequest = ref('general')



/** 浏览器式缩放：存储键 + 范围（与主进程 ZOOM_MIN/MAX 对齐） */
const ZOOM_STORAGE_KEY = 'panel-zoom'
const ZOOM_MIN = 0.6
const ZOOM_MAX = 1.8
const ZOOM_STEP = 0.1

/** 读取上次缩放比并恢复（内容缩放 + 窗口联动由主进程执行） */
async function restoreZoom(): Promise<void> {
  try {
    const saved = Number(localStorage.getItem(ZOOM_STORAGE_KEY))
    if (saved >= ZOOM_MIN && saved <= ZOOM_MAX) {
      await window.api?.setZoom(saved)
    }
  } catch {
    /* 恢复失败保持默认 */
  }
}

/** 应用新缩放比：主进程执行 + 本地持久化 */
async function applyZoom(delta: number): Promise<void> {
  const cur = Number(localStorage.getItem(ZOOM_STORAGE_KEY)) || 1
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((cur + delta) * 10) / 10))
  const actual = (await window.api?.setZoom(next)) ?? 1
  localStorage.setItem(ZOOM_STORAGE_KEY, String(actual))
}

/** Ctrl+滚轮：浏览器式缩放（阻止默认，避免误触页面滚动） */
function onWheel(e: WheelEvent): void {
  if (!e.ctrlKey) return
  e.preventDefault()
  void applyZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
}

/** 边缘拖动调整窗口大小：按住手柄时通知主进程轮询鼠标位置（窗口跟手变化），松开结束 */
function startResize(dir: string, e: MouseEvent): void {
  e.preventDefault()
  e.stopPropagation()
  window.api?.beginResize(dir)
}
function stopResize(): void {
  window.api?.endResize()
}

onMounted(() => {
  initTheme()
  // 恢复上次面板模式（输入法候选窗 / 完整面板），主进程同步窗口尺寸
  if (store.compactMode) {
    window.api?.setPanelMode('compact')
  }
  void store.refresh()
  // 每次呼出面板时刷新数据（面板可能已驻留内存）
  window.api?.onPanelShown(() => {
    void store.refresh()
  })
  // 最大化状态变化：去掉圆角留白，并让网格重排
  window.api?.onMaximizedChanged((v) => {
    maximized.value = v
  })
  // Esc 隐藏面板；Ctrl+滚轮缩放；鼠标松开结束边缘拖动
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('mouseup', stopResize)
  void restoreZoom()
  // GIF 压缩配置：启动时同步到主进程（发送时主进程零 IPC 直读）
  void gifConfigStore.init()
  // 托盘「修改快捷键…」入口：直接打开设置面板并定位到快捷键页
  window.api?.onOpenSettings((tab) => {
    settingsTabRequest.value = tab || 'general'
    settingsOpen.value = true
  })
})

function onKeyDown(e: KeyboardEvent): void {
  // 设置弹窗录制快捷键中：跳过面板按键处理（录制按键由 SettingsDialog 内部监听捕获）
  if (shortcutStore.panelRecording) return
  if (e.key === 'Escape') {
    window.api?.hidePanel()
    return
  }
  // 输入法组合输入期间（中文选词等）不拦截按键
  if (e.isComposing) return

  const s = shortcutStore.shortcuts

  // 复制选中表情（可自定义，默认 Ctrl+C）
  if (matchShortcut(e, s.copySelected)) {
    e.preventDefault()
    const list = store.emojis
    if (list.length) {
      void store.copyEmoji(list[store.selectedIndex >= 0 ? store.selectedIndex : 0])
    }
    return
  }

  // 发送选中表情（可自定义，默认 Enter）
  if (matchShortcut(e, s.sendSelected)) {
    e.preventDefault()
    void store.sendSelected()
    return
  }

  // 切换输入法候选窗模式（可自定义，默认 Ctrl+I）
  if (matchShortcut(e, s.compactToggle)) {
    e.preventDefault()
    store.toggleCompactMode()
    return
  }

  // 方向键导航（固定，不参与自定义）
  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      e.preventDefault()
      store.moveSelection(e.key === 'ArrowDown' ? store.gridColumns : -store.gridColumns)
      scrollSelectedIntoView()
      break
    case 'ArrowLeft':
    case 'ArrowRight':
      e.preventDefault()
      store.moveSelection(e.key === 'ArrowRight' ? 1 : -1)
      scrollSelectedIntoView()
      break
  }

  // Ctrl+Tab / Ctrl+Shift+Tab 循环切换顶部分类（固定）
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault()
    cycleCategory(e.shiftKey ? -1 : 1)
    return
  }

  // 快速发送第 N 个（可自定义修饰键，默认 Ctrl+1~9）
  const quickIdx = matchQuickSend(e, s.quickSend)
  if (quickIdx != null) {
    const idx = quickIdx - 1
    if (idx < store.emojis.length) {
      e.preventDefault()
      void store.sendEmoji(store.emojis[idx])
    }
    return
  }

  // 浏览器式缩放：Ctrl + / - 缩小，Ctrl + =/+ 放大，Ctrl + 0 重置
  if (e.ctrlKey && (e.key === '-' || e.key === '_')) {
    e.preventDefault()
    void applyZoom(-ZOOM_STEP)
  } else if (e.ctrlKey && (e.key === '=' || e.key === '+' || e.key === 'Add')) {
    e.preventDefault()
    void applyZoom(ZOOM_STEP)
  } else if (e.ctrlKey && e.key === '0') {
    e.preventDefault()
    const cur = Number(localStorage.getItem(ZOOM_STORAGE_KEY)) || 1
    void applyZoom(-cur)
  }
}

/** 单行导航循环切换（delta=±1） */
function cycleCategory(delta: number): void {
  const cur = PANEL_TABS.findIndex((t) => t.key === store.activeTab)
  const next = PANEL_TABS[(cur + delta + PANEL_TABS.length) % PANEL_TABS.length]
  store.keyword = ''
  void store.loadTab(next.key)
}

/** 让高亮卡片保持在可视区内 */
function scrollSelectedIntoView(): void {
  document.querySelector('.emoji-card.selected')?.scrollIntoView({ block: 'nearest' })
}

/* 窗口控制（模板里不直接访问 window，走包装函数） */
function minimizeWindow(): void {
  window.api?.minimizeWindow()
}
function toggleMaximize(): void {
  window.api?.toggleMaximize()
}
function closeWindow(): void {
  window.api?.closeWindow()
}
function toggleThemeClick(): void {
  toggleTheme()
}

/** 上传自定义表情：选择文件 → 上传 → 切到自定义分类展示 */
function triggerUpload(): void {
  fileInput.value?.click()
}

/** 刷新当前列表：热门/分类/收藏/最近重新拉取；梗图库随机换一批；搜索重跑当前关键词 */
function refreshView(): void {
  void store.refresh()
}

async function onFileSelected(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const emoji = await api.uploadEmoji(file)
    ElMessage.success(`已上传「${emoji.name}」`)
    store.keyword = ''
    await store.loadTab('custom')
  } catch (err) {
    showError('upload', err instanceof Error ? err.message : '上传失败')
  }
}

/** 打开设置弹窗（内容在 SettingsDialog.vue） */
function openSettings(): void {
  settingsOpen.value = true
  settingsTabRequest.value = 'general'
}

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('wheel', onWheel)
  window.removeEventListener('mouseup', stopResize)
})
</script>

<template>
  <el-config-provider :locale="zhCn">
  <div class="panel" :class="{ maximized }">
    <!-- 粘贴成功 HUD：面板保持打开，短暂浮现提示 -->
    <Transition name="hud-pop">
      <div v-if="store.sendHud" class="send-hud">✓ 已复制</div>
    </Transition>

    <!-- 首启引导：只显示一次，点任意处关闭（覆盖在主内容之上，不改变布局） -->
    <Transition name="onboard-fade">
      <div v-if="showOnboard" class="onboard-mask" @click="dismissOnboard">
        <div class="onboard-card" @click.stop>
          <div class="onboard-title">👋 欢迎使用表情包助手</div>
          <ul class="onboard-steps">
            <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>E</kbd> 随时呼出面板</li>
            <li>输入关键词或自然语言，AI 帮你找表情</li>
            <li>点击表情 → 自动复制，到微信/QQ 按 <kbd>Ctrl</kbd> + <kbd>V</kbd> 发送</li>
            <li>方向键选择 + <kbd>Enter</kbd> 快速发送 · <kbd>Ctrl</kbd> + <kbd>1~9</kbd> 直达第 N 个</li>
          </ul>
          <button class="onboard-btn" @click="dismissOnboard">开始使用 →</button>
        </div>
      </div>
    </Transition>

    <!-- 边缘拖动热区：按住四边/四角即可像普通窗口一样调整大小（最大化时隐藏） -->
    <div v-if="!maximized" class="resize-zone">
      <div class="rh rh-n" @mousedown.prevent="startResize('n', $event)" />
      <div class="rh rh-s" @mousedown.prevent="startResize('s', $event)" />
      <div class="rh rh-e" @mousedown.prevent="startResize('e', $event)" />
      <div class="rh rh-w" @mousedown.prevent="startResize('w', $event)" />
      <div class="rh rh-ne" @mousedown.prevent="startResize('ne', $event)" />
      <div class="rh rh-nw" @mousedown.prevent="startResize('nw', $event)" />
      <div class="rh rh-se" @mousedown.prevent="startResize('se', $event)" />
      <div class="rh rh-sw" @mousedown.prevent="startResize('sw', $event)" />
    </div>

    <!-- 一条式工具栏：品牌 + 搜索 + 操作/窗口按钮（合并原标题栏，垂直空间更充裕） -->
    <header class="toolbar">
      <div class="brand" title="表情包助手">
        <span class="logo-mark">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="logo-grad" x1="0" y1="0" x2="24" y2="24">
                <stop offset="0" stop-color="#8b5cf6" />
                <stop offset="1" stop-color="#3b82f6" />
              </linearGradient>
            </defs>
            <!-- 笑脸徽章：圆角方 + 眼睛 + 微笑弧线 -->
            <rect x="3" y="3" width="18" height="18" rx="5.5" fill="url(#logo-grad)" />
            <circle cx="9" cy="10.5" r="1.3" fill="#fff" />
            <circle cx="15" cy="10.5" r="1.3" fill="#fff" />
            <path d="M8.2 15.2a4.6 4.6 0 0 0 7.6 0" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </span>
        <span class="app-title">表情包助手</span>
      </div>
      <div class="toolbar-search">
        <SearchBar />
      </div>
      <div class="toolbar-actions">
        <button
          class="title-btn"
          :title="`${store.compactMode ? '完整面板' : '输入法候选窗'}（${formatShortcutLabel(shortcutStore.shortcuts.compactToggle)} 切换）`"
          @click="store.toggleCompactMode"
        >
          <el-icon><Grid /></el-icon>
        </button>
        <button v-if="!store.compactMode" class="title-btn btn-secondary" title="上传自定义表情" @click="triggerUpload">
          <el-icon><UploadFilled /></el-icon>
        </button>
        <button v-if="!store.compactMode" class="title-btn btn-secondary" title="设置（网络图库）" @click="openSettings">
          <el-icon><Setting /></el-icon>
        </button>
        <button
          v-if="!store.compactMode"
          class="title-btn btn-secondary"
          title="刷新当前列表"
          @click="refreshView"
        >
          <el-icon :class="{ spinning: store.loading }"><Refresh /></el-icon>
        </button>
        <button v-if="!store.compactMode" class="title-btn btn-secondary" :title="theme === 'dark' ? '切换浅色' : '切换深色'" @click="toggleThemeClick">
          <el-icon><Sunny v-if="theme === 'dark'" /><Moon v-else /></el-icon>
        </button>
        <span class="title-divider" />
        <button v-if="!store.compactMode" class="title-btn" title="最小化" @click="minimizeWindow">
          <el-icon><Minus /></el-icon>
        </button>
        <button v-if="!store.compactMode" class="title-btn" :title="maximized ? '还原' : '最大化'" @click="toggleMaximize">
          <el-icon><CopyDocument v-if="maximized" /><FullScreen v-else /></el-icon>
        </button>
        <button class="title-btn title-close" title="关闭（隐藏到托盘）" @click="closeWindow">
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </header>
    <!-- 上传文件选择（隐藏） -->
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
      hidden
      @change="onFileSelected"
    />

    <!-- 单行分类导航（候选窗模式下隐藏，空间让给候选网格） -->
    <div v-if="!store.compactMode" class="nav-row">
      <CategoryMenu />
    </div>

    <!-- 表情网格 -->
    <main class="panel-body">
      <StickerGrid />
    </main>

    <!-- 底部预览条：选中表情预览 / 操作引导（候选窗模式下隐藏） -->
    <PreviewBar v-if="!store.compactMode" />

    <!-- 设置弹窗（独立组件：通用 / 快捷键 / 网络图库 / 关于） -->
    <SettingsDialog v-model="settingsOpen" :open-tab="settingsTabRequest" />

    <!-- 相似图对比面板（点击重复角标弹出：选择保留哪张 → 隐藏其余 / 移出本地库） -->
    <DuplicateCompareDialog />
  </div>
  </el-config-provider>
</template>

<style scoped>
/* 核心：flex 面板占满 #app 并扣除 margin，四边留白对称，不再被外层 overflow 裁剪 */
.panel {
  flex: 1;
  min-height: 0;
  margin: var(--panel-gap);
  border-radius: var(--radius-xl);
  background: var(--glass-bg);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: panel-in 0.18s ease-out;
  /* 无边框窗口：整个面板可按住拖动（交互元素单独声明 no-drag）。
     必须 position: relative——resize-zone 的 absolute 定位以它为包含块，
     否则会退回到面板入场动画的 transform 上（动画期间/重复触发时手柄位置漂移，
     且右侧手柄盖住网格滚动条导致无法拖动）。 */
  position: relative;
  -webkit-app-region: drag;
  transition:
    margin 0.15s,
    border-radius 0.15s,
    background 0.25s,
    border-color 0.25s;
}

.panel.maximized {
  margin: 0;
  border-radius: 0;
  border: none;
  box-shadow: none;
}

/* 发送成功 HUD：悬浮在面板上部中央，不挡内容 */
.send-hud {
  position: absolute;
  top: 38px;
  left: 50%;
  z-index: 300;
  transform: translateX(-50%);
  padding: 6px 16px;
  border-radius: 999px;
  background: var(--hud-bg);
  color: var(--hud-text);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  pointer-events: none;
  animation: hud-in 0.42s ease-out forwards;
}
.hud-pop-leave-active {
  transition: opacity 0.1s ease;
}

/* 一条式工具栏：品牌 + 搜索居中占主 + 操作/窗口按钮组 */
.toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 8px 0 12px;
  min-width: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1;
}
/* 品牌标识：渐变笑脸徽章（Linear 风格 SVG），带柔和光晕 */
.logo-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 7px;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.14), rgba(59, 130, 246, 0.14));
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent),
    0 0 10px color-mix(in srgb, var(--accent) 26%, transparent);
  -webkit-app-region: no-drag;
}
.app-title {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: 0.3px;
  white-space: nowrap;
  background: linear-gradient(135deg, var(--text-1), color-mix(in srgb, var(--text-1) 72%, var(--accent)));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
/* 搜索占满剩余宽度 */
.toolbar-search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 1px;
}

/* 窗口变窄时隐藏次要工具栏按钮（上传/设置/刷新/主题），
   优先保证搜索框不被挤压、窗口控制按钮（最小化/最大化/关闭）不溢出面板。 */
@media (max-width: 440px) {
  .toolbar .btn-secondary {
    display: none;
  }
}
/* 更窄时连品牌标题文字也隐藏，只保留 Logo 徽章 */
@media (max-width: 360px) {
  .app-title {
    display: none;
  }
}
.title-btn {
  width: 27px;
  height: 27px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  /* 窗口控制按钮需要可点击，排除出拖动区域 */
  -webkit-app-region: no-drag;
  transition:
    background 0.12s,
    color 0.12s;
}
.title-btn:hover {
  background: var(--surface-strong);
  color: var(--text-1);
}
.title-close:hover {
  background: var(--danger);
  color: #fff;
}
.title-divider {
  width: 1px;
  align-self: center;
  height: 16px;
  margin: 0 4px;
  background: var(--border-strong);
}

/* 分类导航行 */
.nav-row {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 5px;
}

/* 刷新按钮加载态：图标旋转 */
.title-btn .spinning {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 首启引导浮层 */
.onboard-mask {
  position: absolute;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg, #0f1220) 55%, transparent);
  -webkit-app-region: no-drag;
}
.onboard-fade-enter-active,
.onboard-fade-leave-active {
  transition: opacity 0.18s ease;
}
.onboard-fade-enter-from,
.onboard-fade-leave-to {
  opacity: 0;
}
.onboard-card {
  width: min(300px, 82%);
  padding: 18px 20px;
  border-radius: var(--radius-lg);
  background: var(--glass-bg);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
  text-align: center;
  animation: card-pop 0.22s ease-out;
}
@keyframes card-pop {
  from {
    opacity: 0;
    transform: scale(0.92) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
.onboard-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 12px;
}
.onboard-steps {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  text-align: left;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.6;
}
.onboard-steps kbd {
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 10.5px;
  padding: 1.5px 6px;
  border-radius: 5px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  color: var(--text-1);
}
.onboard-btn {
  border: none;
  border-radius: var(--radius-md);
  padding: 7px 22px;
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #8b5cf6, #3b82f6);
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.onboard-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(99, 102, 241, 0.45);
}

/* 边缘拖动热区：透明层盖住面板四周，指针悬停显示对应方向的双向箭头；
   手柄必须 no-drag，否则会被整窗拖拽逻辑拦截。 */
.resize-zone {
  position: absolute;
  inset: 0;
  z-index: 200;
  pointer-events: none;
}
.rh {
  position: absolute;
  pointer-events: auto;
  -webkit-app-region: no-drag;
  z-index: 201;
}
.rh-n {
  top: 0;
  left: 10px;
  right: 10px;
  height: 7px;
  cursor: n-resize;
}
.rh-s {
  bottom: 0;
  left: 10px;
  right: 10px;
  height: 7px;
  cursor: s-resize;
}
.rh-e {
  right: 0;
  top: 10px;
  bottom: 10px;
  width: 7px;
  cursor: e-resize;
}
.rh-w {
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 7px;
  cursor: w-resize;
}
.rh-ne {
  top: 0;
  right: 0;
  width: 8px;
  height: 8px;
  cursor: ne-resize;
}
.rh-nw {
  top: 0;
  left: 0;
  width: 8px;
  height: 8px;
  cursor: nw-resize;
}
.rh-se {
  bottom: 0;
  right: 0;
  width: 8px;
  height: 8px;
  cursor: se-resize;
}
.rh-sw {
  bottom: 0;
  left: 0;
  width: 8px;
  height: 8px;
  cursor: sw-resize;
}
</style>