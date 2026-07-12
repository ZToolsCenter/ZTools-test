import { describe, expect, it } from 'vitest'
import { compareVersions } from '../../src/main/api/platformUpdater/versionComparison'

describe('compareVersions', () => {
  it.each([
    ['3.0.0-beta.104', '3.0.0-beta.103', 1],
    ['3.0.0-beta.9', '3.0.0-beta.10', -1],
    ['3.0.0', '3.0.0-beta.103', 1],
    ['3.0.0-beta.103', '3.0.0', -1],
    ['v3.0.0+build.2', '3.0.0', 0]
  ])('compares %s with %s', (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected)
  })
})
