<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useToast, DetailPanel } from '@/components'

interface WebSearchEngine {
  id: string
  name: string
  url: string
  icon: string
  enabled: boolean
  type: 'search' | 'webpage'
  keyword?: string
}

interface Props {
  editingEngine: WebSearchEngine | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  back: []
  save: [engine: WebSearchEngine]
}>()

const { error } = useToast()

const isEditing = computed(() => props.editingEngine !== null)
const isWebpage = computed(() => formData.value.type === 'webpage')
const urlLabel = computed(() => (isWebpage.value ? '网页 URL *' : 'URL 模板 *'))
const urlPlaceholder = computed(() =>
  isWebpage.value ? '例如：https://www.example.com' : '例如：https://www.google.com/search?q={q}'
)
const urlHint = computed(() =>
  isWebpage.value
    ? '支持 http/https，未填写协议时会自动补充 https://'
    : '使用 {q} 作为搜索关键词的占位符；未填写协议时会自动补充 https://'
)
const isFetchingIcon = ref(false)

const formData = ref<WebSearchEngine>({
  id: '',
  name: '',
  url: '',
  icon: '',
  enabled: true,
  type: 'webpage',
  keyword: ''
})

// 监听 editingEngine 变化
watch(
  () => props.editingEngine,
  (newEngine) => {
    if (newEngine) {
      formData.value = {
        ...newEngine,
        type: newEngine.type || 'search',
        keyword: newEngine.keyword || ''
      }
    } else {
      formData.value = {
        id: '',
        name: '',
        url: '',
        icon: '',
        enabled: true,
        type: 'webpage',
        keyword: ''
      }
    }
  },
  { immediate: true }
)

// 自动获取 favicon
async function handleFetchFavicon(): Promise<void> {
  if (!formData.value.url) {
    error('请先填写 URL 模板')
    return
  }

  isFetchingIcon.value = true
  try {
    const result = await window.ztools.internal.webSearch.fetchFavicon(formData.value.url)
    if (result.success && result.data) {
      formData.value.icon = result.data
    } else {
      error('未能获取到图标')
    }
  } catch (err) {
    console.error('获取 favicon 失败:', err)
    error('获取图标失败')
  } finally {
    isFetchingIcon.value = false
  }
}

function handleSave(): void {
  if (!formData.value.name || !formData.value.url) {
    error('请填写名称和 URL')
    return
  }

  const nextData = {
    ...formData.value,
    name: formData.value.name.trim(),
    url: formData.value.url.trim(),
    keyword: formData.value.keyword?.trim() || ''
  }

  if (nextData.type === 'webpage') {
    if (!nextData.keyword) {
      error('请填写匹配关键字')
      return
    }
    if (nextData.url.includes('{q}')) {
      error('网页 URL 不能包含 {q} 占位符')
      return
    }
    nextData.url = ensureUrlProtocol(nextData.url)
    if (!isHttpUrl(nextData.url)) {
      error('网页 URL 必须是有效的 http/https 地址')
      return
    }
  } else {
    if (!nextData.url.includes('{q}')) {
      error('URL 模板必须包含 {q} 占位符')
      return
    }
    nextData.url = ensureUrlProtocol(nextData.url)
    if (!isHttpUrl(nextData.url.replace('{q}', 'test'))) {
      error('URL 模板必须是有效的 http/https 地址')
      return
    }
    nextData.keyword = ''
  }

  emit('save', nextData)
}

function ensureUrlProtocol(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url
  }
  return `https://${url}`
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
</script>
<template>
  <DetailPanel :title="isEditing ? '编辑网页快开' : '添加网页快开'" @back="$emit('back')">
    <div class="editor-wrapper">
      <div class="editor-content">
        <div class="form-group">
          <label class="form-label">类型 *</label>
          <div class="type-segment">
            <button
              type="button"
              class="type-option"
              :class="{ active: formData.type === 'webpage' }"
              @click="formData.type = 'webpage'"
            >
              网页
            </button>
            <button
              type="button"
              class="type-option"
              :class="{ active: formData.type === 'search' }"
              @click="formData.type = 'search'"
            >
              搜索引擎
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">名称 *</label>
          <input
            v-model="formData.name"
            type="text"
            class="input"
            :placeholder="isWebpage ? '例如：ZTools 官网' : '例如：Google 搜索'"
          />
        </div>

        <div v-if="isWebpage" class="form-group">
          <label class="form-label">匹配关键字 *</label>
          <input v-model="formData.keyword" type="text" class="input" placeholder="例如：官网" />
          <p class="form-hint">在主搜索框输入该关键字时打开这个网页</p>
        </div>

        <div class="form-group">
          <label class="form-label">{{ urlLabel }}</label>
          <input v-model="formData.url" type="text" class="input" :placeholder="urlPlaceholder" />
          <p class="form-hint">{{ urlHint }}</p>
        </div>

        <div class="form-group">
          <label class="form-label">图标</label>
          <div class="icon-row">
            <div class="icon-preview">
              <img
                v-if="formData.icon"
                :src="formData.icon"
                class="preview-img"
                alt=""
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
              <div v-else class="i-z-search font-size-24px"></div>
            </div>
            <button
              class="btn btn-sm"
              :disabled="isFetchingIcon || !formData.url"
              @click="handleFetchFavicon"
            >
              {{ isFetchingIcon ? '获取中...' : '自动获取' }}
            </button>
          </div>
          <p class="form-hint">根据 URL 自动获取网站图标</p>
        </div>
      </div>

      <div class="editor-footer">
        <button class="btn" @click="$emit('back')">取消</button>
        <button class="btn btn-solid" @click="handleSave">保存</button>
      </div>
    </div>
  </DetailPanel>
</template>

<style scoped>
.editor-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.form-group {
  margin-bottom: 20px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 8px;
}

.form-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  margin-bottom: 0;
}

.type-segment {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
}

.type-option {
  min-width: 88px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.type-option:hover {
  color: var(--text-color);
}

.type-option.active {
  color: var(--primary-color);
  background: var(--primary-light-bg);
}

.icon-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon-preview {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: 1px solid var(--control-border);
  background: var(--control-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.preview-img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.preview-placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--divider-color);
}
</style>
