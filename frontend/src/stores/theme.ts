import { ref } from 'vue'

type Theme = 'light' | 'dark'

const THEME_KEY = 'emoji-assistant-theme'

const theme = ref<Theme>('light')

function applyTheme(t: Theme): void {
  theme.value = t
  // CSS 变量主题（html[data-theme]）+ Element Plus 深色类名
  document.documentElement.setAttribute('data-theme', t)
  document.documentElement.classList.toggle('dark', t === 'dark')
}

/** 初始化：优先用户手动选择，其次跟随系统 */
function initTheme(): void {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') {
    applyTheme(saved)
    return
  }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  applyTheme(prefersDark ? 'dark' : 'light')
}

/** 手动切换并记住偏好 */
function toggleTheme(): void {
  const next: Theme = theme.value === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  localStorage.setItem(THEME_KEY, next)
}

export function useTheme() {
  return { theme, initTheme, toggleTheme }
}
