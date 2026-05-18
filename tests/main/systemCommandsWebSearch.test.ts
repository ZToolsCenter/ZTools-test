import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOpenExternal = vi.hoisted(() => vi.fn())
const mockGetEngineByFeatureCode = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  clipboard: {},
  nativeImage: {
    createFromDataURL: vi.fn()
  },
  Notification: vi.fn(),
  shell: {
    openExternal: mockOpenExternal,
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

vi.mock('../../src/main/api/renderer/webSearch', () => ({
  default: {
    getEngineByFeatureCode: mockGetEngineByFeatureCode
  }
}))

vi.mock('../../src/main/managers/windowManager', () => ({
  default: {
    getPreviousActiveWindow: vi.fn(),
    getMainWindow: vi.fn()
  }
}))

vi.mock('../../src/main/api/shared/database', () => ({
  default: {
    dbGet: vi.fn(),
    dbPut: vi.fn()
  }
}))

vi.mock('../../src/main/core/globalStyles', () => ({
  GLOBAL_SCROLLBAR_CSS: ''
}))

vi.mock('../../src/main/core/screenCapture', () => ({
  screenCapture: vi.fn()
}))

vi.mock('../../src/main/core/native/index.js', () => ({
  ColorPicker: {
    start: vi.fn()
  }
}))

vi.mock('../../src/main/utils/common', () => ({
  getExplorerFolderPathFromWindow: vi.fn()
}))

import { executeSystemCommand } from '../../src/main/api/renderer/systemCommands'

describe('systemCommands web search execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenExternal.mockResolvedValue(undefined)
  })

  it('executes search engines by encoding the query into the template', async () => {
    mockGetEngineByFeatureCode.mockResolvedValue({
      id: 'search-1',
      name: 'Search',
      url: 'https://example.com/search?q={q}',
      icon: '',
      enabled: true,
      type: 'search',
      keyword: ''
    })
    const mainWindow = {
      webContents: { send: vi.fn() },
      hide: vi.fn()
    }

    await expect(
      executeSystemCommand(
        'web-search-search-1',
        { mainWindow: mainWindow as any, pluginManager: null },
        {
          payload: 'hello world'
        }
      )
    ).resolves.toEqual({ success: true })

    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/search?q=hello%20world')
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('app-launched')
    expect(mainWindow.hide).toHaveBeenCalled()
  })

  it('executes webpage entries by opening the fixed URL', async () => {
    mockGetEngineByFeatureCode.mockResolvedValue({
      id: 'webpage-1',
      name: 'Example',
      url: 'https://example.com/',
      icon: '',
      enabled: true,
      type: 'webpage',
      keyword: 'example'
    })
    const mainWindow = {
      webContents: { send: vi.fn() },
      hide: vi.fn()
    }

    await expect(
      executeSystemCommand(
        'web-search-webpage-1',
        { mainWindow: mainWindow as any, pluginManager: null },
        {
          payload: 'ignored query'
        }
      )
    ).resolves.toEqual({ success: true })

    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/')
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('app-launched')
    expect(mainWindow.hide).toHaveBeenCalled()
  })
})
