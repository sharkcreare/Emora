<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { showError } from '@/utils/feedback'
import { useTheme } from '@/stores/theme'
import { useBadgeStyle } from '@/stores/badgeStyle'
import { useShortcuts, PANEL_SHORTCUT_ITEMS, formatShortcutLabel, type PanelShortcutKey } from '@/stores/shortcuts'
import { useGifConfig } from '@/stores/gifConfig'
import { useEmojiStore } from '@/stores/emoji'

const props = defineProps<{ modelValue: boolean; openTab?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const store = useEmojiStore()
const { theme, toggleTheme } = useTheme()
const { badgeStyle, setBadgeStyle } = useBadgeStyle()
const shortcutStore = useShortcuts()
const gifCfg = useGifConfig()

const settingsTab = ref('general')

/** 网络图库配置（外部 yml，保存后重启后端生效） */
const configForm = reactive({
  enabled: false,
  chinesebqbEnabled: true,
  sogouEnabled: true,
  baiduEnabled: true,
  mengyaEnabled: true,
  giphyApiKey: '',
  tenorApiKey: '',
  giphyBaseUrl: '',
  tenorBaseUrl: ''
})
const configSaving = ref(false)
const backendRestarting = ref(false)

/** 通用设置：开机启动 / 关于信息 */
const autoLaunch = ref(false)
const appInfo = ref({ version: '', platform: '' })

/** 全局快捷键（可自定义并持久化；默认 Ctrl+Shift+E） */
const hotkeyAccelerator = ref('CommandOrControl+Shift+E')
const hotkeyLabel = computed(() => formatHotkeyLabel(hotkeyAccelerator.value))
/** 录制快捷键状态：null=未录制，'global'=全局呼出，PanelShortcutKey=面板内某个快捷键 */
const recordingTarget = ref<'global' | PanelShortcutKey | null>(null)
const recordedHotkey = ref('')
const recordingItemLabel = computed(() =>
  recordingTarget.value && recordingTarget.value !== 'global'
    ? PANEL_SHORTCUT_ITEMS.find((i) => i.key === recordingTarget.value)?.label ?? ''
    : ''
)

/** 面板内快捷键展示：快速发送为「修饰键 + 1~9」，其余直接显示 */
function formatPanelShortcutLabel(key: PanelShortcutKey): string {
  if (key === 'quickSend') {
    return `${formatShortcutLabel(shortcutStore.shortcuts.quickSend)} + 1~9`
  }
  return formatShortcutLabel(shortcutStore.shortcuts[key])
}

/** Electron accelerator → 人类可读（Ctrl + Shift + E） */
function formatHotkeyLabel(acc: string): string {
  return acc
    .split('+')
    .map((p) => {
      switch (p) {
        case 'CommandOrControl':
        case 'Command':
        case 'Control':
        case 'Ctrl':
          return 'Ctrl'
        case 'Option':
          return 'Alt'
        case 'Shift':
          return 'Shift'
        case 'Super':
        case 'Meta':
          return 'Win'
        default:
          return p
      }
    })
    .join(' + ')
}

/** 按键事件 → Electron accelerator（仅捕获真实组合，避免裸按键） */
function keyEventToAccelerator(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let key = ''
  const k = e.key
  if (/^[a-zA-Z]$/.test(k)) key = k.toUpperCase()
  else if (/^[0-9]$/.test(k)) key = k
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) key = k
  else if (k === 'ArrowUp') key = 'Up'
  else if (k === 'ArrowDown') key = 'Down'
  else if (k === 'ArrowLeft') key = 'Left'
  else if (k === 'ArrowRight') key = 'Right'
  else if (k === ' ') key = 'Space'
  else if (k === 'Enter') key = 'Return'
  else if (k === 'Escape') key = 'Escape'
  else if (k === 'Tab') key = 'Tab'
  else if (k === 'Home') key = 'Home'
  else if (k === 'End') key = 'End'
  else if (k === 'PageUp') key = 'PageUp'
  else if (k === 'PageDown') key = 'PageDown'
  else if (k === 'Backspace') key = 'Backspace'
  else if (k === 'Delete') key = 'Delete'
  if (!key) return ''
  parts.push(key)
  return parts.join('+')
}

/** 开始录制：暂停全局热键（避免按下旧组合触发面板切换），清空上次记录 */
function startRecordingHotkey(target: 'global' | PanelShortcutKey): void {
  recordedHotkey.value = ''
  recordingTarget.value = target
  shortcutStore.panelRecording = true
  window.api?.pauseHotkey()
}

/** 结束/取消录制：恢复全局热键 */
function stopRecordingHotkey(): void {
  recordingTarget.value = null
  recordedHotkey.value = ''
  shortcutStore.panelRecording = false
  window.api?.resumeHotkey()
}

/** 录制期间捕获按键（弹窗打开时挂到 window 的 keydown 监听里） */
function handleHotkeyRecording(e: KeyboardEvent): void {
  if (!recordingTarget.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    stopRecordingHotkey()
    return
  }
  const acc = keyEventToAccelerator(e)
  if (!acc) return
  // 全局呼出必须带修饰键（避免裸键抢占系统）；面板内允许 Enter 等裸键
  if (recordingTarget.value === 'global' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    recordedHotkey.value = ''
    return
  }
  recordedHotkey.value = acc
}

/** 保存新快捷键：全局走主进程注册+冲突检测；面板内走本地 store+冲突检测 */
async function saveHotkey(): Promise<void> {
  const target = recordingTarget.value
  if (!target || !recordedHotkey.value) return
  const acc = recordedHotkey.value
  try {
    if (target === 'global') {
      const res = await window.api?.setHotkey(acc)
      if (res?.ok) {
        hotkeyAccelerator.value = res.accelerator
        stopRecordingHotkey()
        ElMessage.success(`全局呼出快捷键已改为 ${formatHotkeyLabel(res.accelerator)}`)
      } else {
        showError('hotkey', res?.error ?? '设置快捷键失败')
        stopRecordingHotkey()
      }
      return
    }
    // 面板内快捷键：检测与全局呼出键冲突（全局键会先抢到按键）
    if (acc === hotkeyAccelerator.value) {
      showError('shortcut', `「${recordingItemLabel.value}」不能与全局呼出键 ${hotkeyLabel} 相同`)
      stopRecordingHotkey()
      return
    }
    // 面板内快捷键互相冲突检测
    const dup = PANEL_SHORTCUT_ITEMS.find((i) => i.key !== target && shortcutStore.shortcuts[i.key] === acc)
    if (dup) {
      showError('shortcut', `「${dup.label}」已在使用 ${formatShortcutLabel(acc)}，请换一个组合`)
      stopRecordingHotkey()
      return
    }
    // quickSend 只存修饰键前缀（如 CommandOrControl），数字键 1~9 动态匹配
    const finalAcc = target === 'quickSend' ? acc.split('+').slice(0, -1).join('+') : acc
    // 交叉冲突：若新组合 = quickSend 前缀 + 数字，Ctrl+数字 会被快速发送抢占
    if (target !== 'quickSend' && /^[1-9]$/.test(acc.split('+').pop() ?? '')) {
      const qsMods = shortcutStore.shortcuts.quickSend.split('+')
      const sameMods = acc
        .split('+')
        .slice(0, -1)
        .every((m) => qsMods.includes(m))
      if (sameMods) {
        showError('shortcut', `与「快速发送第 N 个」冲突：${formatShortcutLabel(acc)} 会被快速发送抢占，请换一个组合`)
        stopRecordingHotkey()
        return
      }
    }
    shortcutStore.set(target, finalAcc)
    stopRecordingHotkey()
    ElMessage.success(`「${recordingItemLabel.value}」已改为 ${formatPanelShortcutLabel(target)}`)
  } catch {
    showError('shortcut', '设置快捷键失败')
    stopRecordingHotkey()
  }
}

/** 开机启动开关 */
async function toggleAutoLaunch(v: boolean): Promise<void> {
  const ok = await window.api?.setAutoLaunch(v)
  autoLaunch.value = ok ?? autoLaunch.value
  if (!ok) {
    showError('autostart', '设置开机启动失败')
  }
}

/** 保存配置到外部 yml（重启后端后生效） */
async function saveSettings(): Promise<void> {
  configSaving.value = true
  try {
    const ok = await window.api?.setNetworkSearchConfig(configForm)
    ElMessage.success(ok ? '配置已保存，点击「重启后端」立即生效' : '配置保存失败')
  } catch (e) {
    showError('settings-save', e instanceof Error ? e.message : '配置保存失败')
  } finally {
    configSaving.value = false
  }
}

/** 立即重启内置后端，让网络图库配置生效 */
async function restartBackendNow(): Promise<void> {
  backendRestarting.value = true
  try {
    const ok = await window.api?.restartBackend()
    ElMessage.success(ok ? '后端已重启，网络图库配置已生效' : '后端重启失败，请重启应用后重试')
  } catch (e) {
    showError('backend-restart', e instanceof Error ? e.message : '后端重启失败')
  } finally {
    backendRestarting.value = false
  }
}

/** 本地文件夹托管：文件夹列表 / 忽略名单 / 扫描统计 / 重复分析 */
const localFolders = ref<string[]>([])
const localIgnored = ref<string[]>([])
const localFileCount = ref(0)
const localLoading = ref(false)
const analysisRunning = ref(false)
const analysisDone = ref(0)
const analysisTotal = ref(0)
const analysisDuplicates = ref(0)
/** 当前分析范围（folder / upload / favorite），进度条标注用 */
const analysisScope = ref<'folder' | 'upload' | 'favorite'>('folder')
const scopeLabel = computed(() =>
  analysisScope.value === 'upload' ? '分析上传库' : analysisScope.value === 'favorite' ? '分析收藏夹' : '分析本地文件夹'
)
/** 各范围去重统计（来自主进程 scopeStats，收藏/上传/文件夹统一可见） */
const folderDup = computed(() => store.scopeStats.folder?.duplicates ?? 0)
const uploadDup = computed(() => store.scopeStats.upload?.duplicates ?? 0)
const favDup = computed(() => store.scopeStats.favorite?.duplicates ?? 0)
/** 相似度算法（dHash / pHash） */
const localHashType = ref<'dHash' | 'pHash'>('dHash')
const hashTypeSwitching = ref(false)

/** 切换相似度算法（主进程触发重新分析，完成后 store 自动刷新） */
async function changeHashType(type: 'dHash' | 'pHash'): Promise<void> {
  if (type === localHashType.value) return
  hashTypeSwitching.value = true
  try {
    const ok = await window.api?.setLocallibHashType(type)
    if (ok !== false) {
      localHashType.value = type
      ElMessage.success(type === 'pHash' ? '已切换到 pHash（DCT），正在重新分析…' : '已切换到 dHash，正在重新分析…')
    }
  } catch {
    showError('locallib-hash-type', '切换相似度算法失败')
  } finally {
    hashTypeSwitching.value = false
  }
}

/** 重新分析全部（本地文件夹强制 + 上传库 + 收藏夹）+ 监听进度 */
let analysisOff: (() => void) | undefined
async function reanalyzeLocal(): Promise<void> {
  analysisRunning.value = true
  // 每次点击重新挂监听（弹窗可能反复开关）
  analysisOff?.()
  analysisOff = window.api?.onLocallibAnalysisProgress((s) => {
    analysisRunning.value = s.running
    analysisDone.value = s.done
    analysisTotal.value = s.total
    analysisDuplicates.value = s.duplicates
    if (s.scope) analysisScope.value = s.scope
  })
  // store 依次触发 文件夹(强制清缓存)→上传库→收藏夹，进度事件逐段上报
  await store.reanalyzeAllScopes()
  // 同步一次当前进度快照（含各范围统计）
  const s = await window.api?.getLocallibAnalysisState()
  if (s) {
    analysisRunning.value = s.running
    analysisDone.value = s.done
    analysisTotal.value = s.total
    analysisDuplicates.value = s.duplicates
    if (s.scope) analysisScope.value = s.scope
  }
}

async function loadLocalState(): Promise<void> {
  try {
    const state = await window.api?.getLocallibState()
    if (!state) return
    localFolders.value = state.folders
    localIgnored.value = state.ignored
    localFileCount.value = state.files.length
    if (state.hashType === 'pHash' || state.hashType === 'dHash') localHashType.value = state.hashType
  } catch {
    /* 主进程不可用 */
  }
}

async function addLocalFolder(): Promise<void> {
  const res = await window.api?.addLocallibFolder()
  if (res?.ok && res.state) {
    localFolders.value = res.state.folders
    localIgnored.value = res.state.ignored
    localFileCount.value = res.state.files.length
    ElMessage.success(`已添加本地文件夹（${res.state.files.length} 个表情）`)
    void store.refresh()
  } else if (res && res.error !== 'cancelled') {
    showError('locallib-add', res.error ?? '添加文件夹失败')
  }
}

async function removeLocalFolder(folder: string): Promise<void> {
  try {
    const state = await window.api?.removeLocallibFolder(folder)
    if (state) {
      localFolders.value = state.folders
      localIgnored.value = state.ignored
      localFileCount.value = state.files.length
      ElMessage.success('已移除托管文件夹（磁盘文件保留）')
      void store.refresh()
    }
  } catch (err) {
    showError('locallib-remove-folder', err instanceof Error ? err.message : '移除失败')
  }
}

async function rescanLocal(): Promise<void> {
  localLoading.value = true
  try {
    const state = await window.api?.rescanLocallib()
    if (state) {
      localFolders.value = state.folders
      localIgnored.value = state.ignored
      localFileCount.value = state.files.length
      ElMessage.success(`重新扫描完成（${state.files.length} 个表情）`)
      void store.refresh()
    }
  } catch (err) {
    showError('locallib-rescan', err instanceof Error ? err.message : '重新扫描失败')
  } finally {
    localLoading.value = false
  }
}

/** 弹窗打开时加载各项配置 */
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    settingsTab.value = props.openTab && ['general', 'hotkey', 'network', 'about', 'locallib'].includes(props.openTab) ? props.openTab : 'general'
    void loadLocalState()
    // 打开设置时读取当前分析进度快照
    const s = await window.api?.getLocallibAnalysisState()
    if (s) {
      analysisRunning.value = s.running
      analysisDone.value = s.done
      analysisTotal.value = s.total
      analysisDuplicates.value = s.duplicates
      if (s.scope) analysisScope.value = s.scope
    }
    try {
      const cfg = await window.api?.getNetworkSearchConfig()
      if (cfg) {
        configForm.enabled = cfg.enabled
        configForm.chinesebqbEnabled = cfg.chinesebqbEnabled
        configForm.sogouEnabled = cfg.sogouEnabled
        configForm.baiduEnabled = cfg.baiduEnabled
        configForm.mengyaEnabled = cfg.mengyaEnabled
        configForm.giphyApiKey = cfg.giphyApiKey
        configForm.tenorApiKey = cfg.tenorApiKey
        configForm.giphyBaseUrl = cfg.giphyBaseUrl
        configForm.tenorBaseUrl = cfg.tenorBaseUrl
      }
    } catch {
      /* 读取失败保持默认值 */
    }
    try {
      autoLaunch.value = (await window.api?.getAutoLaunch()) ?? false
      appInfo.value = (await window.api?.getAppInfo()) ?? { version: '', platform: '' }
      const acc = await window.api?.getHotkey()
      if (acc) hotkeyAccelerator.value = acc
    } catch {
      /* 读取失败保持默认值 */
    }
  }
)

/** 弹窗关闭：若在录制则恢复热键；清理重复分析进度监听 */
function onClosed(): void {
  if (recordingTarget.value) {
    stopRecordingHotkey()
  }
  analysisOff?.()
  analysisOff = undefined
}

/** 弹窗打开期间挂 keydown 处理录制（全局快捷键会先被主进程拦截，面板内按键由这里捕获） */
watch(
  () => props.modelValue,
  (open) => {
    const handler = (e: KeyboardEvent): void => handleHotkeyRecording(e)
    if (open) {
      window.addEventListener('keydown', handler)
    } else {
      window.removeEventListener('keydown', handler)
    }
  }
)

/** GIF 压缩配置（本地状态绑定 store，变更即持久化+同步主进程） */
const gifEnabled = computed({
  get: () => gifCfg.config.enabled,
  set: (v: boolean) => {
    void gifCfg.set({ enabled: v })
    if (!v) gifCfg.dismissPrompt()
  }
})
const gifMode = computed({
  get: () => gifCfg.config.mode,
  set: (v: 'wechat' | 'qq' | 'custom') => void gifCfg.set({ mode: v })
})
const gifCustomMb = computed({
  get: () => (gifCfg.config.customThresholdBytes ? gifCfg.config.customThresholdBytes / (1024 * 1024) : 1),
  set: (v: number | undefined) => {
    const mb = Math.max(1, Math.min(50, Number(v ?? 1)))
    void gifCfg.set({ mode: 'custom', customThresholdBytes: Math.round(mb * 1024 * 1024) })
  }
})
</script>

<template>
  <el-dialog :model-value="modelValue" title="设置" width="400px" append-to-body @update:model-value="emit('update:modelValue', $event)" @closed="onClosed">
    <el-tabs v-model="settingsTab">
      <!-- 通用：外观 + 启动行为 + GIF 压缩 -->
      <el-tab-pane label="通用" name="general">
        <el-form label-width="96px" label-position="left">
          <el-form-item label="AI 角标样式">
            <el-select v-model="badgeStyle" style="width: 100%" @change="setBadgeStyle">
              <el-option label="百分比（AI 87%）" value="percent" />
              <el-option label="文字（AI 推荐）" value="text" />
              <el-option label="星级（★★★★☆）" value="star" />
            </el-select>
            <span class="settings-tip">AI 语义推荐结果角标样式，选择即生效</span>
          </el-form-item>
          <el-form-item label="深色模式">
            <el-switch :model-value="theme === 'dark'" @change="toggleTheme" />
            <span class="settings-tip">切换后立即生效</span>
          </el-form-item>
          <el-form-item label="开机启动">
            <el-switch :model-value="autoLaunch" @change="toggleAutoLaunch" />
            <span class="settings-tip">登录 Windows 后自动常驻后台</span>
          </el-form-item>
          <el-form-item label="面板模式">
            <el-switch :model-value="store.compactMode" @change="store.toggleCompactMode" />
            <span class="settings-tip">输入法候选窗（紧凑小窗）</span>
          </el-form-item>
          <el-divider />
          <el-form-item label="GIF 自动压缩">
            <el-switch v-model="gifEnabled" />
            <span class="settings-tip">发送前自动压缩超大 GIF（默认关闭，遇到大图会提示）</span>
          </el-form-item>
          <el-form-item v-if="gifEnabled" label="压缩阈值">
            <el-select v-model="gifMode" style="width: 100%">
              <el-option label="微信模式（1MB）" value="wechat" />
              <el-option label="QQ 模式（5MB）" value="qq" />
              <el-option label="自定义大小" value="custom" />
            </el-select>
            <span class="settings-tip">超过阈值的 GIF 发送前自动压缩，保持动画</span>
          </el-form-item>
          <el-form-item v-if="gifEnabled && gifMode === 'custom'" label="自定义阈值">
            <el-input-number v-model="gifCustomMb" :min="1" :max="50" :step="1" style="width: 110px" />
            <span class="settings-tip">MB（1~50）</span>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 快捷键：全局呼出 + 面板内操作均可自定义录制 -->
      <el-tab-pane label="快捷键" name="hotkey">
        <div class="hotkey-list">
          <div class="hotkey-row">
            <span class="hotkey-name">呼出 / 隐藏面板</span>
            <div class="hotkey-edit">
              <kbd class="hotkey-kbd">
                {{ recordingTarget === 'global' ? (recordedHotkey ? formatHotkeyLabel(recordedHotkey) : '请按下组合键…') : hotkeyLabel }}
              </kbd>
              <template v-if="recordingTarget !== 'global'">
                <el-button size="small" @click="startRecordingHotkey('global')">修改</el-button>
              </template>
              <template v-else>
                <el-button size="small" type="primary" :disabled="!recordedHotkey" @click="saveHotkey">保存</el-button>
                <el-button size="small" @click="stopRecordingHotkey">取消</el-button>
              </template>
            </div>
          </div>
          <el-divider />
          <div v-for="item in PANEL_SHORTCUT_ITEMS" :key="item.key" class="hotkey-row">
            <span class="hotkey-name">{{ item.label }}</span>
            <div class="hotkey-edit">
              <kbd class="hotkey-kbd">
                {{ recordingTarget === item.key ? (recordedHotkey ? formatShortcutLabel(recordedHotkey) : '请按下按键…') : formatPanelShortcutLabel(item.key) }}
              </kbd>
              <template v-if="recordingTarget !== item.key">
                <el-button size="small" @click="startRecordingHotkey(item.key)">修改</el-button>
              </template>
              <template v-else>
                <el-button size="small" type="primary" :disabled="!recordedHotkey" @click="saveHotkey">保存</el-button>
                <el-button size="small" @click="stopRecordingHotkey">取消</el-button>
              </template>
            </div>
          </div>
          <div class="hotkey-row">
            <span class="hotkey-name">键盘导航</span>
            <kbd class="hotkey-kbd">方向键</kbd>
          </div>
          <p class="hotkey-note">
            点击「修改」后直接按下新按键（如 Ctrl + Alt + K，面板内可只用 Enter）保存。全局呼出键若被其他程序占用会提示冲突并保留原快捷键。
          </p>
        </div>
      </el-tab-pane>

      <!-- 网络图库：API Key 与开关，写入外部配置后重启后端生效 -->
      <el-tab-pane label="网络图库" name="network">
        <el-form label-width="96px" label-position="left">
          <el-form-item label="网络图库搜索">
            <el-switch v-model="configForm.enabled" />
            <span class="settings-tip">总开关；未配置 Key 时 BQB/搜狗（免 Key 源）仍生效</span>
          </el-form-item>
          <el-form-item label="中文梗图库">
            <el-switch v-model="configForm.chinesebqbEnabled" />
            <span class="settings-tip">BQB（ChineseBQB）内置 4000+ 中文梗图，无需 Key</span>
          </el-form-item>
          <el-form-item label="搜狗表情包">
            <el-switch v-model="configForm.sogouEnabled" />
            <span class="settings-tip">SOGOU 免费关键词搜图（共享频次，可能波动）</span>
          </el-form-item>
          <el-form-item label="百度实时图库">
            <el-switch v-model="configForm.baiduEnabled" />
            <span class="settings-tip">BAIDU 百度图库实时搜索（IP 直连，免 Key）</span>
          </el-form-item>
          <el-form-item label="萌芽梗图浏览">
            <el-switch v-model="configForm.mengyaEnabled" />
            <span class="settings-tip">萌芽 2600+ 精选梗图（50 分类，免 Key）</span>
          </el-form-item>
          <el-form-item label="Giphy Key">
            <el-input v-model="configForm.giphyApiKey" placeholder="https://developers.giphy.com 免费申请" clearable />
          </el-form-item>
          <el-form-item label="Tenor Key">
            <el-input v-model="configForm.tenorApiKey" placeholder="https://tenor.com/gifapi 免费申请" clearable />
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 本地文件夹：把本地表情文件夹直接设为表情库（纯本地托管，不复制文件） -->
      <el-tab-pane label="本地文件夹" name="locallib">
        <div class="locallib-box">
          <p class="locallib-hint">把本地表情文件夹直接设为表情库，图片不复制、不入库，在「自定义」分类统一展示。</p>
          <div class="locallib-actions">
            <el-button size="small" type="primary" @click="addLocalFolder">添加文件夹</el-button>
            <el-button size="small" :loading="localLoading" @click="rescanLocal">重新扫描</el-button>
            <span class="locallib-count">{{ localFolders.length }} 个文件夹 · {{ localFileCount }} 个表情</span>
          </div>
          <div v-if="localFolders.length" class="locallib-list">
            <div v-for="folder in localFolders" :key="folder" class="locallib-item">
              <span class="locallib-path" :title="folder">{{ folder }}</span>
              <el-button size="small" text type="danger" @click="removeLocalFolder(folder)">移除</el-button>
            </div>
          </div>
          <div v-else class="locallib-empty">尚未添加本地文件夹，点上方「添加文件夹」选择表情包目录。</div>
          <div v-if="localIgnored.length" class="locallib-ignored">
            <span class="locallib-ignored-tip">{{ localIgnored.length }} 个文件已从软件移除（磁盘文件保留）</span>
          </div>
          <el-divider />
          <div class="locallib-analyze">
            <el-button size="small" :loading="analysisRunning" @click="reanalyzeLocal">重新分析全部（本地+上传+收藏）</el-button>
            <span class="locallib-count" title="各范围最近一次完成的分析去重数量">
              本地 {{ folderDup }} · 上传 {{ uploadDup }} · 收藏 {{ favDup }}
            </span>
          </div>
          <div class="locallib-hashtype">
            <span class="locallib-hashtype-label">相似度算法</span>
            <el-select
              :model-value="localHashType"
              size="small"
              style="width: 180px"
              :disabled="hashTypeSwitching"
              @update:model-value="changeHashType"
            >
              <el-option label="dHash（差异哈希，默认）" value="dHash" />
              <el-option label="pHash（DCT，抗压缩/旋转）" value="pHash" />
            </el-select>
          </div>
          <el-progress
            v-if="analysisRunning"
            :percentage="analysisTotal ? Math.round((analysisDone / analysisTotal) * 100) : 0"
            :stroke-width="6"
            :show-text="false"
          />
          <p v-if="analysisRunning" class="locallib-hint" style="margin-top: 4px">
            正在{{ scopeLabel }}…（{{ analysisDone }}/{{ analysisTotal }}）
          </p>
          <p class="locallib-hint" style="margin-top: 4px">
            分析本地库/上传库/收藏夹相似重复表情（红=高度相似，黄=相似），默认不隐藏，可在「自定义」分类按需过滤。
            pHash 基于 DCT 低频分量，对图片压缩与 90° 旋转更鲁棒，首次切换会全量重算（约几秒）。
          </p>
        </div>
      </el-tab-pane>

      <!-- 关于：版本与平台信息 -->
      <el-tab-pane label="关于" name="about">
        <div class="about-box">
          <div class="about-logo">
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="about-grad" x1="0" y1="0" x2="24" y2="24">
                  <stop offset="0" stop-color="#8b5cf6" />
                  <stop offset="1" stop-color="#3b82f6" />
                </linearGradient>
              </defs>
              <rect x="3" y="3" width="18" height="18" rx="5.5" fill="url(#about-grad)" />
              <circle cx="9" cy="10.5" r="1.3" fill="#fff" />
              <circle cx="15" cy="10.5" r="1.3" fill="#fff" />
              <path d="M8.2 15.2a4.6 4.6 0 0 0 7.6 0" stroke="#fff" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </div>
          <div class="about-name">表情包助手 EmojiAssistant</div>
          <div class="about-ver">版本 {{ appInfo.version || '0.1.0' }} · {{ appInfo.platform || 'win32' }}</div>
          <p class="about-desc">
            悬浮搜索 · AI 语义推荐 · 点击即发。<br />
            按 {{ hotkeyLabel }} 呼出面板，点击表情即可复制到剪贴板。
          </p>
        </div>
      </el-tab-pane>
    </el-tabs>
    <template #footer>
      <el-button :loading="backendRestarting" @click="restartBackendNow">重启后端生效</el-button>
      <el-button type="primary" :loading="configSaving" @click="saveSettings">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.settings-tip {
  margin-left: 10px;
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.5;
}

/* 快捷键列表 */
.hotkey-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 0;
}
.hotkey-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.hotkey-name {
  font-size: 12px;
  color: var(--text-1);
}
.hotkey-kbd {
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 6px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  color: var(--text-1);
  white-space: nowrap;
}
.hotkey-edit {
  display: flex;
  align-items: center;
  gap: 6px;
}
.hotkey-note {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.6;
}

/* 本地文件夹托管 */
.locallib-hashtype {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.locallib-hashtype-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.locallib-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.locallib-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.6;
}
.locallib-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.locallib-count {
  font-size: 11px;
  color: var(--text-3);
  margin-left: auto;
}
.locallib-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
}
.locallib-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  border: 1px solid var(--border);
}
.locallib-path {
  font-size: 11px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.locallib-empty {
  padding: 14px;
  text-align: center;
  font-size: 11px;
  color: var(--text-3);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
}
.locallib-ignored {
  font-size: 11px;
  color: var(--text-3);
}
.locallib-analyze {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 关于页 */
.about-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 10px 0 6px;
  gap: 6px;
}
.about-logo svg {
  display: block;
  box-shadow: 0 6px 18px rgba(99, 102, 241, 0.3);
  border-radius: 12px;
}
.about-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-1);
}
.about-ver {
  font-size: 11px;
  color: var(--text-3);
}
.about-desc {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: var(--text-2);
  line-height: 1.7;
}
</style>
