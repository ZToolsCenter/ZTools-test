import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import AdmZip from 'adm-zip'
import yaml from 'yaml'
import { getTempPath } from '../../core/appData/appDataPaths'
import { downloadFile } from '../../utils/download.js'
import type {
  CreatePlatformUpdater,
  PlatformDownloadStatus,
  PlatformUpdateActionResult,
  PlatformUpdateInfo,
  PlatformUpdateResult,
  PlatformUpdaterCallbacks,
  PlatformUpdaterService
} from './types'

interface LegacyUpdatePaths {
  updaterPath: string
  asarSrc: string
  asarDst: string
  unpackedSrc: string
  unpackedDst: string
  appPath: string
}

class MacPlatformUpdater implements PlatformUpdaterService {
  private readonly latestYmlUrl =
    'https://github.com/ZToolsCenter/ZTools-test/releases/latest/download/latest.yml'
  private downloadedUpdateInfo: PlatformUpdateInfo | null = null
  private downloadedUpdatePath: string | null = null
  private checkPromise: Promise<PlatformUpdateResult> | null = null

  constructor(private readonly callbacks: PlatformUpdaterCallbacks) {}

  public async initialize(): Promise<void> {
    return
  }

  public async checkForUpdates(downloadWhenAvailable: boolean): Promise<PlatformUpdateResult> {
    if (this.checkPromise) return this.checkPromise

    this.checkPromise = this.doCheckForUpdates(downloadWhenAvailable).finally(() => {
      this.checkPromise = null
    })
    return this.checkPromise
  }

  private async doCheckForUpdates(downloadWhenAvailable: boolean): Promise<PlatformUpdateResult> {
    try {
      const tempDir = path.join(getTempPath(), 'ztools-update-check')
      await fs.mkdir(tempDir, { recursive: true })
      const tempFilePath = path.join(tempDir, `latest-${Date.now()}.yml`)

      try {
        console.log('[Updater] 下载 latest.yml:', this.latestYmlUrl)
        await downloadFile(this.latestYmlUrl, tempFilePath)
        const updateMetadata = yaml.parse(await fs.readFile(tempFilePath, 'utf-8'))

        if (!updateMetadata.version) throw new Error('latest.yml 格式错误：缺少 version 字段')

        const latestVersion = updateMetadata.version
        const currentVersion = app.getVersion()
        if (this.compareVersions(latestVersion, currentVersion) <= 0) {
          return {
            success: true,
            status: 'not-available',
            hasUpdate: false,
            latestVersion,
            currentVersion
          }
        }

        const releaseNotes = updateMetadata.releaseNotes || updateMetadata.changelog || ''
        const updateInfo: PlatformUpdateInfo = {
          version: latestVersion,
          changelog: releaseNotes,
          releaseNotes,
          downloadUrl: this.buildUpdateDownloadUrl(latestVersion)
        }
        this.downloadedUpdateInfo = updateInfo

        if (downloadWhenAvailable) {
          const downloadResult = await this.downloadUpdate(updateInfo, true)
          if (!downloadResult.success) {
            return {
              success: false,
              status: 'error',
              hasUpdate: true,
              currentVersion,
              latestVersion,
              updateInfo,
              error: downloadResult.error
            }
          }
        }

        return {
          success: true,
          status: downloadWhenAvailable ? 'downloaded' : 'available',
          hasUpdate: true,
          currentVersion,
          latestVersion,
          updateInfo
        }
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch((error) => {
          console.error('[Updater] 清理更新检查临时目录失败:', error)
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '检查更新失败'
      console.error('[Updater] 检查更新失败:', error)
      return { success: false, status: 'error', hasUpdate: false, error: message }
    }
  }

  private buildUpdateDownloadUrl(version: string): string {
    const fileName = `update-darwin-${process.arch}-${version}.zip`
    return `https://github.com/ZToolsCenter/ZTools-test/releases/latest/download/${fileName}`
  }

  private async downloadUpdate(
    updateInfo: PlatformUpdateInfo,
    showWindow: boolean
  ): Promise<PlatformUpdateActionResult> {
    if (this.downloadedUpdatePath) return { success: true }
    if (!updateInfo.downloadUrl) return { success: false, error: '更新包地址不存在' }

    this.callbacks.onDownloadStart({ version: updateInfo.version })
    try {
      const tempDir = path.join(getTempPath(), 'ztools-update-pkg')
      await fs.mkdir(tempDir, { recursive: true })
      const tempZipPath = path.join(tempDir, `update-${Date.now()}.zip`)
      const extractPath = path.join(tempDir, `extracted-${Date.now()}`)

      await downloadFile(updateInfo.downloadUrl, tempZipPath)
      await fs.mkdir(extractPath, { recursive: true })

      const zip = new AdmZip(tempZipPath)
      await new Promise<void>((resolve, reject) => {
        zip.extractAllToAsync(extractPath, true, false, (error?: Error) => {
          if (error) reject(error)
          else resolve()
        })
      })

      const appAsarTmp = path.join(extractPath, 'app.asar.tmp')
      const appAsar = path.join(extractPath, 'app.asar')
      try {
        await fs.access(appAsarTmp)
        await fs.rename(appAsarTmp, appAsar)
      } catch {
        console.log('[Updater] 未找到 app.asar.tmp，可能直接是 app.asar')
      }

      await fs.unlink(tempZipPath).catch((error) => {
        console.error('[Updater] 删除更新 ZIP 失败:', error)
      })

      this.downloadedUpdateInfo = updateInfo
      this.downloadedUpdatePath = extractPath
      this.callbacks.onDownloaded(updateInfo, showWindow)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : '下载更新失败'
      this.callbacks.onDownloadFailed(message)
      return { success: false, error: message }
    }
  }

  private async getUpdatePaths(extractPath: string): Promise<LegacyUpdatePaths> {
    const appPath = process.execPath
    const contentsDir = path.dirname(path.dirname(appPath))
    const resourcesDir = path.join(contentsDir, 'Resources')
    const safeArch = process.arch === 'arm64' ? 'arm64' : 'amd64'
    const updaterPath = app.isPackaged
      ? path.join(path.dirname(appPath), 'ztools-updater')
      : path.join(app.getAppPath(), `updater/mac-${safeArch}/ztools-updater`)

    return {
      updaterPath,
      asarSrc: path.join(extractPath, 'app.asar'),
      asarDst: path.join(resourcesDir, 'app.asar'),
      unpackedSrc: path.join(extractPath, 'app.asar.unpacked'),
      unpackedDst: path.join(resourcesDir, 'app.asar.unpacked'),
      appPath
    }
  }

  private async launchUpdater(paths: LegacyUpdatePaths): Promise<void> {
    await fs.access(paths.updaterPath).catch(() => {
      throw new Error(`找不到升级程序: ${paths.updaterPath}`)
    })

    const args = [
      '--asar-src',
      paths.asarSrc,
      '--asar-dst',
      paths.asarDst,
      '--app',
      paths.appPath,
      '--unpacked-src',
      paths.unpackedSrc,
      '--unpacked-dst',
      paths.unpackedDst
    ]
    const subprocess = spawn(paths.updaterPath, args, { detached: true, stdio: 'ignore' })
    subprocess.unref()
    this.callbacks.onBeforeInstall()
    app.exit(0)
  }

  public async startUpdate(updateInfo?: PlatformUpdateInfo): Promise<PlatformUpdateActionResult> {
    if (!updateInfo) return { success: false, error: '没有可用的更新' }
    const downloadResult = await this.downloadUpdate(updateInfo, false)
    if (!downloadResult.success || !this.downloadedUpdatePath) return downloadResult

    try {
      await this.launchUpdater(await this.getUpdatePaths(this.downloadedUpdatePath))
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '安装更新失败' }
    }
  }

  public async installDownloadedUpdate(): Promise<PlatformUpdateActionResult> {
    if (!this.downloadedUpdatePath) return { success: false, error: '没有已下载的更新' }
    try {
      await this.launchUpdater(await this.getUpdatePaths(this.downloadedUpdatePath))
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '安装更新失败' }
    }
  }

  public getDownloadStatus(): PlatformDownloadStatus {
    return {
      hasDownloaded: Boolean(this.downloadedUpdatePath),
      version: this.downloadedUpdateInfo?.version,
      changelog: this.downloadedUpdateInfo?.changelog,
      status: this.downloadedUpdatePath ? 'downloaded' : 'idle'
    }
  }

  public cleanup(): void {
    return
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number)
    const parts2 = v2.split('.').map(Number)
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0
      const p2 = parts2[i] || 0
      if (p1 > p2) return 1
      if (p1 < p2) return -1
    }
    return 0
  }
}

const createMacUpdater: CreatePlatformUpdater = (callbacks) => new MacPlatformUpdater(callbacks)

export default createMacUpdater
