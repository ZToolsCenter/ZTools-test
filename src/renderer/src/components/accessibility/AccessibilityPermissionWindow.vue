<template>
  <div class="startup-dialog-window" tabindex="0" @keydown.esc="quitApp">
    <div class="header">
      <img :src="logo" class="header-icon" draggable="false" />
      <div class="header-info">
        <div class="title">需要开启辅助功能权限</div>
        <div class="subtitle">ZTools 启动权限检查</div>
      </div>
    </div>

    <main class="content">
      <div class="message">
        <p>ZTools 需要辅助功能权限来响应快捷键并完成键盘与窗口操作。</p>
        <p>请在“系统设置 → 隐私与安全性 → 辅助功能”中允许 ZTools。</p>
      </div>
      <div class="permission-status" :class="{ checking: isChecking }">
        <span class="status-dot"></span>
        <span>{{ isChecking ? '正在检测授权状态...' : '等待开启辅助功能权限' }}</span>
      </div>
    </main>

    <footer class="footer">
      <button class="btn cancel" @click="quitApp">退出应用</button>
      <button class="btn cancel" :disabled="isChecking" @click="checkPermission">重新检测</button>
      <button class="btn confirm" @click="openSettings">打开系统设置</button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import logo from '../../assets/logo.png'

const isChecking = ref(false)
let stopGrantedListener: (() => void) | undefined
let checkingTimer: number | undefined

function showCheckingState(): void {
  window.clearTimeout(checkingTimer)
  isChecking.value = true
  checkingTimer = window.setTimeout(() => {
    isChecking.value = false
  }, 1000)
}

function openSettings(): void {
  showCheckingState()
  window.electron.ipcRenderer.send('accessibility-permission:open-settings')
}

function checkPermission(): void {
  showCheckingState()
  window.electron.ipcRenderer.send('accessibility-permission:check')
}

function quitApp(): void {
  window.electron.ipcRenderer.send('accessibility-permission:quit')
}

onMounted(() => {
  document.querySelector<HTMLElement>('.startup-dialog-window')?.focus()
  stopGrantedListener = window.electron.ipcRenderer.on('accessibility-permission:granted', () => {
    window.clearTimeout(checkingTimer)
    isChecking.value = true
  })
})

onBeforeUnmount(() => {
  window.clearTimeout(checkingTimer)
  stopGrantedListener?.()
})
</script>

<style src="../startupDialog.css"></style>

<style scoped>
.permission-status {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 22px;
  padding: 10px 12px;
  border-radius: 6px;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.035);
  font-size: 13px;
}

.status-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #f59e0b;
}

.permission-status.checking .status-dot {
  background: #3b82f6;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-color-scheme: dark) {
  .permission-status {
    background: rgba(255, 255, 255, 0.05);
  }
}
</style>
