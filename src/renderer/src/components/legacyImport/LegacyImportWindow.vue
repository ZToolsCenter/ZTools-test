<template>
  <div class="startup-dialog-window" tabindex="0" @keydown="handleKeydown">
    <div class="header window-drag-region">
      <img :src="logo" class="header-icon" draggable="false" />
      <div class="header-info">
        <div class="title">检测到旧版本 ZTools 数据</div>
        <div class="subtitle">ZTools 3.0 数据初始化</div>
      </div>
    </div>

    <main class="content">
      <div class="message">
        <p>你可以导入旧数据，也可以全新开始。</p>
        <p>旧数据不会被删除、移动或覆盖。</p>
      </div>
    </main>

    <footer class="footer">
      <button class="btn cancel" :disabled="isImporting" @click="chooseFresh">全新开始</button>
      <button class="btn confirm" :disabled="isImporting" @click="chooseImport">
        <span v-if="isImporting" class="loading-spinner"></span>
        <span>{{ isImporting ? '导入中...' : '导入旧数据' }}</span>
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import logo from '../../assets/logo.png'

const isImporting = ref(false)

function waitNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

async function chooseImport(): Promise<void> {
  if (isImporting.value) return
  isImporting.value = true
  await waitNextFrame()
  window.electron?.ipcRenderer.send('legacy-import:choose', 'import')
}

function chooseFresh(): void {
  if (isImporting.value) return
  window.electron?.ipcRenderer.send('legacy-import:choose', 'fresh')
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    chooseImport()
  } else if (event.key === 'Escape') {
    chooseFresh()
  }
}

onMounted(() => {
  document.querySelector<HTMLElement>('.startup-dialog-window')?.focus()
})
</script>

<style src="../startupDialog.css"></style>
