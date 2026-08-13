<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Star, StarFilled, Delete, Link } from '@element-plus/icons-vue'
import { useEmojiStore } from '@/stores/emoji'
import { useBadgeStyle } from '@/stores/badgeStyle'
import { resolveImageUrl } from '@/api/http'
import { showError } from '@/utils/feedback'
import * as api from '@/api/emoji'
import type { Emoji } from '@/types/emoji'

const props = defineProps<{ emoji: Emoji; index: number }>()
const store = useEmojiStore()

/* ---------- 右键菜单（收藏 / 复制链接 / 删除） ---------- */
const menu = reactive({ visible: false, x: 0, y: 0 })

function openMenu(e: MouseEvent): void {
  e.preventDefault()
  e.stopPropagation()
  menu.visible = true
  menu.x = e.clientX
  menu.y = e.clientY
}

function closeMenu(): void {
  menu.visible = false
}

function onContextItem(action: (...args: unknown[]) => void): void {
  closeMenu()
  action()
}

function onCopyLink(): void {
  void navigator.clipboard.writeText(resolveImageUrl(props.emoji.url)).then(
    () => ElMessage.success('图片链接已复制'),
    () => showError('copy-link', '复制链接失败')
  )
}

// 点击任意处关闭右键菜单
function onDocClick(): void {
  if (menu.visible) closeMenu()
}

document.addEventListener('click', onDocClick)
document.addEventListener('contextmenu', onDocClick)
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('contextmenu', onDocClick)
})

/** 单卡图片加载失败重试：key 递增后 el-image 重新请求 src */
const retryKey = ref(0)
function retryImage(e: MouseEvent): void {
  e.stopPropagation()
  retryKey.value++
}

/** 网络图库来源（不入库、不可收藏） */
const NETWORK_SOURCES = new Set(['BQB', 'SOGOU', 'BAIDU', 'GIPHY', 'TENOR', 'MEMENGYA'])
const isNetwork = computed(() => NETWORK_SOURCES.has(props.emoji.source))
/** 是否为 GIF 动图（网络图库表情，点击后以动图粘贴） */
const isGif = computed(() => /\.gif($|\?)/i.test(props.emoji.url))
/** 自定义上传的表情可删除（后端删除记录）；本地文件夹文件不可删除磁盘文件 */
const canDelete = computed(() => props.emoji.source === 'UPLOAD')
/** 本地文件夹托管的文件：可从软件移除（加入忽略名单，不删源文件） */
const isLocalFolder = computed(() => props.emoji.source === 'FOLDER')
/** 重复角标：high=高度相似（红），similar=相似（黄）；直接显示与组代表的相似度百分比 */
const dupBadge = computed(() => {
  if (!props.emoji.duplicate) return null
  const high = props.emoji.duplicateLevel === 'high'
  const level = high ? '高度相似' : '相似'
  const pct = props.emoji.similarity
  return {
    cls: `dup-badge ${high ? 'high' : 'similar'}`,
    label: pct != null ? `${level} ${pct}%` : level
  }
})
/** 悬停提示：与哪张相似（组代表名称）+ 相似度百分比；已保留的显示「已保留，点击可重新选择」 */
const dupHint = computed(() => {
  if (!props.emoji.duplicate) return ''
  if (store.isKeptDuplicate(props.emoji)) {
    return '已保留此张，点击可重新选择'
  }
  const repId = props.emoji.duplicateOf
  const rep = repId
    ? store.localEmojis.find((e) => String(e.id) === repId) ?? store.uploadEmojis.find((e) => String(e.id) === repId)
    : undefined
  const pct = props.emoji.similarity
  const simText = pct != null ? `相似度 ${pct}%` : props.emoji.duplicateLevel === 'high' ? '高度相似' : '相似'
  const base = rep ? `与「${rep.name}」${simText}` : `有相似表情（${simText}），`
  return `${base}点击对比相似图`
})
/** 点击重复角标：弹出相似图对比面板（阻止冒泡，不触发发送） */
function onOpenCompare(e: MouseEvent): void {
  e.stopPropagation()
  store.openDuplicateCompare(props.emoji)
}
/** AI 角标阈值：相似度低于该值不显示角标，避免低分结果被误认为强推荐 */
const AI_BADGE_THRESHOLD = 0.6
const { badgeStyle } = useBadgeStyle()
/** AI 语义推荐：带相似度百分比（如 87）；低于阈值不显示 */
const semanticPct = computed(() => {
  const s = props.emoji.semanticScore
  if (s == null || s < AI_BADGE_THRESHOLD) return null
  return Math.min(99, Math.round(s * 100))
})
/** 百分比 → 星级（1~5 星，60%~100% 线性映射，最低 1 星） */
function starsOf(pct: number): string {
  const n = Math.max(1, Math.min(5, Math.round(((pct - 60) / 39) * 5)))
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}
/** 按用户选择的样式渲染角标文本；低于阈值返回 null（不显示） */
const badgeLabel = computed(() => {
  const pct = semanticPct.value
  if (pct == null) return null
  switch (badgeStyle.value) {
    case 'text':
      return 'AI 推荐'
    case 'star':
      return starsOf(pct)
    default:
      return `AI ${pct}%`
  }
})

const isFavorite = (): boolean => store.favoriteIds.has(props.emoji.id)

async function onToggleFavorite(e?: MouseEvent): Promise<void> {
  e?.stopPropagation()
  try {
    await store.toggleFavorite(props.emoji)
  } catch (err) {
    showError('favorite', err instanceof Error ? err.message : '操作失败')
  }
}

async function onDelete(e?: MouseEvent): Promise<void> {
  e?.stopPropagation()
  try {
    await ElMessageBox.confirm(`确定删除「${props.emoji.name}」吗？删除后不可恢复。`, '删除表情', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await api.deleteEmoji(props.emoji.id as number)
    store.removeEmojiFromList(props.emoji.id)
    ElMessage.success('已删除')
  } catch {
    /* 用户取消或删除失败（错误由全局提示） */
  }
}

/** 从本地库移除：加入忽略名单（不删除磁盘文件），列表即时刷新 */
async function onRemoveFromLibrary(e?: MouseEvent): Promise<void> {
  e?.stopPropagation()
  try {
    await store.ignoreLocalFile(props.emoji)
    ElMessage.success('已从本地库移除（磁盘文件保留）')
  } catch (err) {
    showError('locallib-remove', err instanceof Error ? err.message : '移除失败')
  }
}

function onClick(): void {
  void store.sendEmoji(props.emoji)
}
</script>

<template>
  <!-- ================= 修复2：移除卡片级入场动画样式绑定（动画改由网格容器层控制） ================= -->
  <div
    class="emoji-card"
    :class="{ selected: store.selectedIndex === index }"
    title="点击发送到聊天窗口"
    @click="onClick"
    @contextmenu="openMenu"
    @mouseenter="store.setSelected(index)"
  >
    <el-image :key="retryKey" :src="resolveImageUrl(emoji.url)" fit="cover" class="emoji-img" lazy>
      <template #error>
        <div class="img-error" title="图片加载失败，点击重试" @click="retryImage">
          <span class="img-error-icon">🖼️</span>
          <span class="img-error-text">点击重试</span>
        </div>
      </template>
    </el-image>

    <!-- AI 语义推荐角标（左上角；样式可切换：百分比 / 文字 / 星级） -->
    <span v-if="badgeLabel != null" class="ai-badge" title="AI 语义推荐（相似度 {{ semanticPct }}%）">{{ badgeLabel }}</span>

    <!-- GIF 动图常显角标（右上角，不依赖悬停，一眼区分静态图/动图） -->
    <span v-if="isGif" class="gif-badge">GIF</span>

    <!-- 重复检测角标：高度相似=红，相似=黄；点击弹出相似图对比面板 -->
    <span v-if="dupBadge" :class="dupBadge.cls" :title="dupHint" @click="onOpenCompare">{{ dupBadge.label }}</span>

    <!-- 悬停/选中浮层：仅保留收藏/来源/删除微操作（名称改由底部预览条展示） -->
    <div class="overlay">
      <div class="actions">
        <button
          v-if="!isNetwork"
          class="mini-btn"
          :class="{ faved: isFavorite() }"
          :title="isFavorite() ? '取消收藏' : '收藏'"
          @click="onToggleFavorite"
        >
          <el-icon :size="12">
            <StarFilled v-if="isFavorite()" />
            <Star v-else />
          </el-icon>
        </button>
        <button v-if="canDelete" class="mini-btn del" title="删除此表情" @click="onDelete">
          <el-icon :size="12"><Delete /></el-icon>
        </button>
        <span v-else-if="isNetwork" class="source-badge">{{ emoji.source }}</span>
        <span v-else-if="isLocalFolder" class="source-badge local" title="本地文件夹托管">本地</span>
      </div>
    </div>

    <!-- 右键菜单：收藏 / 复制图片链接 / 删除 -->
    <Teleport to="body">
      <div v-if="menu.visible" class="ctx-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
        <button v-if="!isNetwork" class="ctx-item" @click="onContextItem(() => onToggleFavorite())">
          <el-icon :size="13"><StarFilled v-if="isFavorite()" /><Star v-else /></el-icon>
          <span>{{ isFavorite() ? '取消收藏' : '收藏' }}</span>
        </button>
        <button class="ctx-item" @click="onContextItem(onCopyLink)">
          <el-icon :size="13"><Link /></el-icon>
          <span>复制图片链接</span>
        </button>
        <button v-if="canDelete" class="ctx-item ctx-danger" @click="onContextItem(() => onDelete())">
          <el-icon :size="13"><Delete /></el-icon>
          <span>删除表情</span>
        </button>
        <button v-if="isLocalFolder" class="ctx-item ctx-danger" @click="onContextItem(() => onRemoveFromLibrary())">
          <el-icon :size="13"><Delete /></el-icon>
          <span>从本地库移除（保留文件）</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ================= 修复1（主 bug 根治）：卡片基础样式不再依赖入场动画显形 =================
   原实现：.emoji-card { opacity: 0; animation: card-in forwards }
   被 .selected 的 pulse-ring 动画整体替换后 forwards 失效 → 元素回退到 opacity: 0 → 悬浮即消失。
   修复：opacity 基础值恒为 1，卡片自身不做任何动画；入场淡入由网格容器（StickerGrid）统一控制，
   任何 hover/selected 状态变化都不会再触碰卡片动画。 */
.emoji-card {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  background: var(--card-bg);
  border: 1px solid var(--border);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  opacity: 1;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
  /* 表情卡片需要点击发送/收藏，排除出拖动区域 */
  -webkit-app-region: no-drag;
}
/* 悬停：轻微上浮 + 主题色光晕描边（对齐 Discord 悬停反馈层级） */
.emoji-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent),
    0 10px 26px color-mix(in srgb, var(--accent) 20%, rgba(15, 23, 42, 0.16));
  z-index: 2;
}
/* 键盘导航高亮：主题色描边 + 呼吸外光（"即将发送"的强反馈）。
   注意：只允许操作 border-color / box-shadow，绝不覆盖 animation/opacity，
   否则会与容器级入场动画产生替换（悬浮消失 bug 的根源）。 */
.emoji-card.selected {
  border-color: var(--accent);
  animation: pulse-ring 1.6s ease-in-out infinite;
  z-index: 3;
}
.emoji-img {
  width: 100%;
  height: 100%;
  transition: transform 0.22s ease;
}
.emoji-card:hover :deep(img),
.emoji-card.selected :deep(img) {
  transform: scale(1.1);
}
.img-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 100%;
  font-size: 20px;
  background: var(--surface);
  color: var(--text-3);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.img-error:hover {
  background: var(--surface-strong);
  color: var(--text-2);
}
.img-error-icon {
  font-size: 20px;
}
.img-error-text {
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.3px;
}
.gif-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  /* 修复2：角标需盖在悬停信息条（.overlay）之上，否则 hover 时被遮挡 */
  z-index: 2;
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #fff;
  background: color-mix(in srgb, var(--accent) 82%, #000);
  padding: 1.5px 6px;
  border-radius: var(--radius-sm);
  pointer-events: none;
}
/* 重复检测角标：高度相似=红，相似=黄；GIF 角标共存时错位（GIF 在右上，此角标右中）。
   可点击（弹出对比面板），悬停轻微放大提示可交互 */
.dup-badge {
  position: absolute;
  right: 5px;
  top: 22px;
  z-index: 3;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: #fff;
  padding: 1.5px 5px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  white-space: nowrap;
  line-height: 1.4;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  transition: transform 0.12s ease, filter 0.12s ease;
}
.dup-badge:hover {
  transform: scale(1.1);
  filter: brightness(1.15);
}
.dup-badge.high {
  background: #e5484d;
}
.dup-badge.similar {
  background: #f59e0b;
}

/* AI 语义推荐角标：紫蓝渐变 + 小圆角，与 GIF 角标（右上）对称分布在左上 */
.ai-badge {
  position: absolute;
  top: 5px;
  left: 5px;
  z-index: 2;
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: #fff;
  background: linear-gradient(135deg, #8b5cf6, #3b82f6);
  padding: 1.5px 6px;
  border-radius: var(--radius-sm);
  box-shadow: 0 1px 4px rgba(59, 130, 246, 0.35);
  pointer-events: none;
  white-space: nowrap;
  line-height: 1.4;
}
/* 悬停浮层：底部小段渐变 + 右侧操作，悬停滑入 */
.overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  padding: 14px 6px 6px;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.45), transparent 80%);
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.emoji-card:hover .overlay,
.emoji-card.selected .overlay {
  opacity: 1;
  transform: translateY(0);
}
.actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
/* 微型操作按钮：白底圆钮，悬停浮起 */
.mini-btn {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.92);
  color: #4b5563;
  cursor: pointer;
  padding: 0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  transition:
    transform 0.12s ease,
    background 0.12s ease,
    color 0.12s ease;
}
.mini-btn:hover {
  transform: scale(1.12);
}
.mini-btn.faved {
  color: #f59e0b;
}
.mini-btn.del {
  color: #e5484d;
}
.source-badge {
  font-size: 9.5px;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  padding: 1.5px 7px;
  border-radius: var(--radius-sm);
  letter-spacing: 0.4px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
/* 本地文件夹来源角标：绿色系，区分网络图库 */
.source-badge.local {
  background: linear-gradient(135deg, #10b981, #059669);
}

/* 右键菜单：毛玻璃浮层 + 圆角 + 阴影，桌面级观感 */
.ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 150px;
  padding: 4px;
  border-radius: var(--radius-md);
  background: var(--menu-bg, var(--surface-strong));
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  animation: menu-in 0.12s ease-out;
}
@keyframes menu-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-1);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s ease;
}
.ctx-item:hover {
  background: var(--surface);
}
.ctx-danger {
  color: var(--danger);
}
</style>