import { app, dialog, shell } from 'electron'
import {
  checkRuntimeCompatibility,
  EXPECTED_ELECTRON_VERSION,
  FULL_INSTALL_RELEASE_URL
} from './runtimeCompatibility'

if (process.platform === 'win32') app.setAppUserModelId('top.z-tools')

const gotTheLock = app.requestSingleInstanceLock()
const runtimeCompatibility = checkRuntimeCompatibility({
  platform: process.platform,
  isPackaged: app.isPackaged,
  runtimeElectronVersion: process.versions.electron
})

async function showBlockingRuntimePrompt(): Promise<void> {
  try {
    await app.whenReady()
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: '需要安装完整版本',
      message: '当前版本无法在此 Electron 运行环境中继续启动',
      detail: `${runtimeCompatibility.reason}。请下载并安装最新完整版本，用户数据和插件不会被删除。`,
      buttons: ['下载完整版本', '退出应用'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })

    if (result.response === 0) await shell.openExternal(FULL_INSTALL_RELEASE_URL)
  } catch (error) {
    console.error('[Bootstrap] 显示 Electron 兼容性提示失败:', error)
  } finally {
    app.exit(0)
  }
}

if (!gotTheLock) {
  app.exit(0)
} else if (runtimeCompatibility.blocked) {
  console.error(
    `[Bootstrap] 阻止启动: ${runtimeCompatibility.reason}; target=${EXPECTED_ELECTRON_VERSION}`
  )
  void showBlockingRuntimePrompt()
} else {
  void import('./appMain').catch((error) => {
    console.error('[Bootstrap] 加载主程序失败:', error)
    app.exit(1)
  })
}
