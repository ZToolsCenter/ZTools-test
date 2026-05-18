import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDbGet = vi.hoisted(() => vi.fn())
const mockDbPut = vi.hoisted(() => vi.fn())

vi.mock('../../src/main/api/shared/database.js', () => ({
  default: {
    dbGet: mockDbGet,
    dbPut: mockDbPut
  }
}))

vi.mock('../../src/shared/pluginRuntimeNamespace.js', () => ({
  isDevelopmentPluginName: vi.fn((name: string) => name.endsWith('__dev')),
  toDevPluginName: vi.fn((name: string) => `${name}__dev`)
}))

vi.mock('../../src/main/core/internalPlugins.js', () => ({
  isBundledInternalPlugin: vi.fn(() => false)
}))

import { migrateWebSearchEngineTypes } from '../../src/main/core/startupDataMigrations'

describe('startupDataMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('migrates legacy web search engines to typed search entries', () => {
    mockDbGet.mockReturnValue([
      {
        id: 'legacy',
        name: 'Legacy',
        url: 'https://example.com?q={q}',
        icon: ''
      },
      {
        id: 'webpage',
        name: 'Webpage',
        url: 'https://example.com/',
        icon: '',
        enabled: false,
        type: 'webpage',
        keyword: 'example'
      }
    ])

    migrateWebSearchEngineTypes()

    expect(mockDbPut).toHaveBeenCalledWith('web-search-engines', [
      {
        id: 'legacy',
        name: 'Legacy',
        url: 'https://example.com?q={q}',
        icon: '',
        type: 'search',
        enabled: true,
        keyword: ''
      },
      {
        id: 'webpage',
        name: 'Webpage',
        url: 'https://example.com/',
        icon: '',
        enabled: false,
        type: 'webpage',
        keyword: 'example'
      }
    ])
  })

  it('does not rewrite already migrated web search data', () => {
    mockDbGet.mockReturnValue([
      {
        id: 'search',
        name: 'Search',
        url: 'https://example.com?q={q}',
        icon: '',
        enabled: true,
        type: 'search',
        keyword: ''
      }
    ])

    migrateWebSearchEngineTypes()

    expect(mockDbPut).not.toHaveBeenCalled()
  })
})
