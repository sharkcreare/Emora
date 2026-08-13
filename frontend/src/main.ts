import { createApp } from 'vue'
import { createPinia } from 'pinia'
import {
  ElButton,
  ElConfigProvider,
  ElDialog,
  ElDivider,
  ElForm,
  ElFormItem,
  ElIcon,
  ElImage,
  ElInput,
  ElInputNumber,
  ElOption,
  ElProgress,
  ElSelect,
  ElSwitch,
  ElTabPane,
  ElTabs
} from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
// 全局样式：组件样式与深浅色变量（按需注册组件 + 全量 CSS 是体积/稳定性折中，
// 全部样式保留避免漏引单个组件样式导致布局错乱）
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import './styles/main.css'

// 全局兜底：渲染进程未捕获异常 / 未处理 Promise 拒绝统一上报主进程 error.log
// （error.log 路径：userData/error.log，与主进程 uncaughtException 日志同文件）
window.addEventListener('error', (e) => {
  try {
    window.api?.reportError('renderer-uncaught', e.message || String(e.error))
  } catch {
    /* 上报失败静默 */
  }
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason ?? 'unknown')
  try {
    window.api?.reportError('renderer-rejection', msg)
  } catch {
    /* 上报失败静默 */
  }
})

const app = createApp(App)
app.use(createPinia())
// 按需注册实际用到的组件（替代全量 app.use(ElementPlus)，减小 JS bundle）
for (const comp of [
  ElButton,
  ElConfigProvider,
  ElDialog,
  ElDivider,
  ElForm,
  ElFormItem,
  ElIcon,
  ElImage,
  ElInput,
  ElInputNumber,
  ElOption,
  ElProgress,
  ElSelect,
  ElSwitch,
  ElTabPane,
  ElTabs
]) {
  app.use(comp as any)
}
// locale 通过 <el-config-provider :locale="zhCn"> 注入（见 App.vue）
app.mount('#app')
