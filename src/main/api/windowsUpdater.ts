import path from 'path'
import log from 'electron-log'
import { NsisUpdater, autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import {
  getWindowsInstallCompatibility,
  WINDOWS_RELEASE_URL,
  type WindowsInstallCompatibility
} from './windowsInstallCompatibility'

export type WindowsUpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'not-available'
  | 'migration-required'
  | 'error'

export interface WindowsUpdateInfo {
  version: string
  changelog: string
  releaseNotes: string
}

export interface WindowsUpdateResult {
  success: boolean
  status: WindowsUpdaterState
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  updateInfo?: WindowsUpdateInfo
  migrationRequired?: boolean
  migrationReasons?: string[]
  releaseUrl?: string
  error?: string
}

interface WindowsUpdaterCallbacks {
  onDownloadStart: (info: { version: string }) => void
  onDownloadProgress: (info: ProgressInfo) => void
  onDownloaded: (info: WindowsUpdateInfo, showWindow: boolean) => void
  onDownloadFailed: (error: string) => void
  onBeforeInstall: () => void
}

function normalizeReleaseNotes(releaseNotes: UpdateInfo['releaseNotes']): string {
  if (typeof releaseNotes === 'string') return releaseNotes
  if (!Array.isArray(releaseNotes)) return ''
  return releaseNotes
    .map((item) => item.note)
    .filter(Boolean)
    .join('\n\n')
}

function toWindowsUpdateInfo(info: UpdateInfo): WindowsUpdateInfo {
  const releaseNotes = normalizeReleaseNotes(info.releaseNotes)
  return {
    version: info.version,
    changelog: releaseNotes,
    releaseNotes
  }
}

export class WindowsUpdater {
  private state: WindowsUpdaterState = 'idle'
  private compatibility: WindowsInstallCompatibility | null = null
  private updateInfo: WindowsUpdateInfo | null = null
  private checkPromise: Promise<WindowsUpdateResult> | null = null
  private downloadPromise: Promise<{ success: boolean; error?: string }> | null = null
  private showWindowAfterDownload = true

  constructor(
    private readonly callbacks: WindowsUpdaterCallbacks,
    compatibility?: WindowsInstallCompatibility
  ) {
    this.compatibility = compatibility ?? null
    autoUpdater.logger = log
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.autoRunAppAfterInstall = true
    autoUpdater.allowPrerelease = autoUpdater.currentVersion.prerelease.length > 0

    autoUpdater.on('checking-for-update', () => {
      this.state = 'checking'
    })
    autoUpdater.on('update-available', (info) => {
      this.state = 'available'
      this.updateInfo = toWindowsUpdateInfo(info)
    })
    autoUpdater.on('update-not-available', () => {
      this.state = 'not-available'
      this.updateInfo = null
    })
    autoUpdater.on('download-progress', (info) => this.callbacks.onDownloadProgress(info))
    autoUpdater.on('update-downloaded', (info) => {
      this.state = 'downloaded'
      this.updateInfo = toWindowsUpdateInfo(info)
      this.callbacks.onDownloaded(this.updateInfo, this.showWindowAfterDownload)
    })
    autoUpdater.on('error', (error) => {
      this.state = 'error'
      this.callbacks.onDownloadFailed(error.message)
    })
  }

  public async initialize(): Promise<WindowsInstallCompatibility> {
    this.compatibility = await getWindowsInstallCompatibility()
    if (this.compatibility.migrationRequired) this.state = 'migration-required'
    return this.compatibility
  }

  public async checkForUpdates(downloadWhenAvailable = false): Promise<WindowsUpdateResult> {
    if (this.checkPromise) return this.checkPromise

    this.checkPromise = this.doCheckForUpdates(downloadWhenAvailable).finally(() => {
      this.checkPromise = null
    })
    return this.checkPromise
  }

  private async doCheckForUpdates(downloadWhenAvailable: boolean): Promise<WindowsUpdateResult> {
    try {
      const compatibility = this.compatibility ?? (await this.initialize())
      if (compatibility.migrationRequired) {
        return {
          success: true,
          status: 'migration-required',
          hasUpdate: false,
          currentVersion: autoUpdater.currentVersion.version,
          migrationRequired: true,
          migrationReasons: compatibility.reasons,
          releaseUrl: WINDOWS_RELEASE_URL
        }
      }
      if (!compatibility.compatible) {
        return {
          success: true,
          status: 'not-available',
          hasUpdate: false,
          currentVersion: autoUpdater.currentVersion.version
        }
      }

      this.state = 'checking'
      const result = await autoUpdater.checkForUpdates()
      if (!result || (this.state as WindowsUpdaterState) === 'not-available') {
        return {
          success: true,
          status: 'not-available',
          hasUpdate: false,
          currentVersion: autoUpdater.currentVersion.version,
          latestVersion: result?.updateInfo.version
        }
      }

      this.updateInfo = toWindowsUpdateInfo(result.updateInfo)
      if (downloadWhenAvailable) await this.downloadUpdate(true)

      return {
        success: true,
        status: this.state,
        hasUpdate: true,
        currentVersion: autoUpdater.currentVersion.version,
        latestVersion: this.updateInfo.version,
        updateInfo: this.updateInfo
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '检查更新失败'
      this.state = 'error'
      return {
        success: false,
        status: 'error',
        hasUpdate: false,
        currentVersion: autoUpdater.currentVersion.version,
        error: message
      }
    }
  }

  public async downloadUpdate(showWindowAfterDownload: boolean): Promise<{
    success: boolean
    error?: string
  }> {
    if (this.state === 'downloaded') return { success: true }
    if (this.downloadPromise) return this.downloadPromise
    if (!this.updateInfo) return { success: false, error: '没有可下载的更新' }

    this.showWindowAfterDownload = showWindowAfterDownload
    this.state = 'downloading'
    this.callbacks.onDownloadStart({ version: this.updateInfo.version })
    this.downloadPromise = autoUpdater
      .downloadUpdate()
      .then(() => ({ success: true }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '下载更新失败'
        this.state = 'error'
        this.callbacks.onDownloadFailed(message)
        return { success: false, error: message }
      })
      .finally(() => {
        this.downloadPromise = null
      })
    return this.downloadPromise
  }

  public async downloadAndInstall(): Promise<{ success: boolean; error?: string }> {
    const downloadResult = await this.downloadUpdate(false)
    if (!downloadResult.success) return downloadResult
    return this.installDownloadedUpdate()
  }

  public installDownloadedUpdate(): { success: boolean; error?: string } {
    if (this.state !== 'downloaded') return { success: false, error: '更新尚未下载完成' }

    this.state = 'installing'
    this.callbacks.onBeforeInstall()
    ;(autoUpdater as NsisUpdater).installDirectory = path.dirname(process.execPath)
    autoUpdater.quitAndInstall(true, true)
    return { success: true }
  }

  public getDownloadStatus(): {
    hasDownloaded: boolean
    version?: string
    changelog?: string
    status: WindowsUpdaterState
  } {
    return {
      hasDownloaded: this.state === 'downloaded',
      version: this.updateInfo?.version,
      changelog: this.updateInfo?.changelog,
      status: this.state
    }
  }
}
