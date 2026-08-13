import { ref } from 'vue'

/** AI 角标样式：百分比（AI 87%）/ 文字（AI 推荐）/ 星级（★★★★☆） */
export type AiBadgeStyle = 'percent' | 'text' | 'star'

const BADGE_STYLE_KEY = 'emoji-assistant-ai-badge-style'

const badgeStyle = ref<AiBadgeStyle>('percent')

/** 初始化：读取上次选择（默认百分比） */
function initBadgeStyle(): void {
  const saved = localStorage.getItem(BADGE_STYLE_KEY)
  if (saved === 'percent' || saved === 'text' || saved === 'star') {
    badgeStyle.value = saved
  }
}

/** 切换样式并记住偏好 */
function setBadgeStyle(s: AiBadgeStyle): void {
  badgeStyle.value = s
  localStorage.setItem(BADGE_STYLE_KEY, s)
}

export function useBadgeStyle() {
  return { badgeStyle, initBadgeStyle, setBadgeStyle }
}
