function parseVersion(version: string): { core: number[]; prerelease: string[] | null } {
  const normalized = version.trim().replace(/^v/i, '').split('+', 1)[0]
  const separatorIndex = normalized.indexOf('-')
  const coreText = separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : normalized
  const prereleaseText = separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : ''

  return {
    core: coreText.split('.').map((part) => Number.parseInt(part, 10) || 0),
    prerelease: prereleaseText ? prereleaseText.split('.') : null
  }
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left)
  const rightVersion = parseVersion(right)
  const coreLength = Math.max(leftVersion.core.length, rightVersion.core.length)

  for (let index = 0; index < coreLength; index += 1) {
    const difference = (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }

  if (!leftVersion.prerelease && !rightVersion.prerelease) return 0
  if (!leftVersion.prerelease) return 1
  if (!rightVersion.prerelease) return -1

  const prereleaseLength = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length)
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = leftVersion.prerelease[index]
    const rightPart = rightVersion.prerelease[index]
    if (leftPart === rightPart) continue
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1

    const leftIsNumber = /^\d+$/.test(leftPart)
    const rightIsNumber = /^\d+$/.test(rightPart)
    if (leftIsNumber && rightIsNumber) {
      const difference = Number(leftPart) - Number(rightPart)
      if (difference !== 0) return difference > 0 ? 1 : -1
      continue
    }
    if (leftIsNumber !== rightIsNumber) return leftIsNumber ? -1 : 1
    return leftPart.localeCompare(rightPart) > 0 ? 1 : -1
  }

  return 0
}
