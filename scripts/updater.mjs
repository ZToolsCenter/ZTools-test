import { existsSync, readFileSync, writeFileSync } from 'fs'
import yaml from 'yaml'
import {
  getProcessedVersion,
  isDevBuild,
  getDownloadUrl,
  generateDownloadLinksMarkdown
} from './version-utils.mjs'

// 读取 changelog.md
let changelog = readFileSync('changelog.md', 'utf-8')

// 获取处理后的版本号
const version = getProcessedVersion()
const isDev = isDevBuild()
const downloadUrl = getDownloadUrl(isDev, version)

console.log(`📦 生成更新信息...`)
console.log(`版本号: ${version}`)
console.log(`构建类型: ${isDev ? 'dev' : 'release'}`)
console.log(`下载地址: ${downloadUrl}`)

// 生成下载链接并追加到 changelog
const downloadLinks = generateDownloadLinksMarkdown(downloadUrl, version)
const updatedChangelog = changelog + downloadLinks

// electron-builder 先生成标准元数据，这里只补充发布说明和旧 updater 兼容字段。
const updateMetadataPath = 'dist/latest.yml'
if (existsSync(updateMetadataPath)) {
  const updateMetadata = yaml.parse(readFileSync(updateMetadataPath, 'utf-8'))
  updateMetadata.releaseNotes = changelog
  updateMetadata.changelog = changelog
  writeFileSync(updateMetadataPath, yaml.stringify(updateMetadata))
  console.log(`✅ 已向 ${updateMetadataPath} 添加 releaseNotes 和 changelog`)
} else {
  console.warn(`⚠️ 未找到 ${updateMetadataPath}，跳过更新元数据补充`)
}

writeFileSync('changelog.md', updatedChangelog)

console.log(`✅ 标准更新元数据由 electron-builder 生成并保留 SHA-512`)
console.log(`✅ 已更新 changelog.md（添加下载链接）`)
