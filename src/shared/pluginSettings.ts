export const ENABLED_MAIN_PUSH_PLUGINS_KEY = 'enabled-main-push-plugin'

/** 解析插件配置列表，当前数据契约固定为 string[] */
export function normalizeConfigList(data: unknown): string[] {
  if (!Array.isArray(data)) return []
  return data.filter((name): name is string => typeof name === 'string' && Boolean(name))
}

export function isMainPushPluginEnabled(pluginName: string, enabledPluginNames: string[]): boolean {
  return enabledPluginNames.includes(pluginName)
}

export function removePluginNameFromSettingList(data: string[], pluginName: string): string[] {
  return data.filter((name) => name !== pluginName)
}
