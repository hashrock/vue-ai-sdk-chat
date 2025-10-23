<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { marked } from 'marked'

// Configure marked
marked.setOptions({
  breaks: true,
})

interface ToolInvocation {
  toolName: string
  state: 'call' | 'result' | 'error'
  args?: any
  result?: any
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  toolInvocations?: ToolInvocation[]
}

const messagesContainer = ref<HTMLElement | null>(null)
const messages = ref<Message[]>([])
const input = ref('')
const isLoading = ref(false)

const scrollToBottom = async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

const formatMessage = (content: string) => {
  if (!content) return ''
  try {
    // Use marked synchronously
    const result = marked.parse(content, { async: false })
    return result as string
  } catch (error) {
    console.error('Error parsing markdown:', error)
    return content
  }
}

const getToolDisplayName = (toolName: string): string => {
  const names: Record<string, string> = {
    read_file: 'Read File',
    write_file: 'Write File',
    list_files: 'List Files',
    delete_file: 'Delete File',
    rename_file: 'Rename File',
    create_directory: 'Create Directory',
  }
  return names[toolName] || toolName
}

const handleSubmit = async (e: Event) => {
  e.preventDefault()

  if (!input.value.trim() || isLoading.value) return

  const userMessage: Message = {
    role: 'user',
    content: input.value,
  }

  messages.value.push(userMessage)
  input.value = ''
  isLoading.value = true

  try {
    const response = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: messages.value
          .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content && m.content.trim()))
          .map(m => ({
            role: m.role,
            content: m.content,
          })),
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to fetch response')
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No reader available')

    const decoder = new TextDecoder()
    let assistantMessage: Message = {
      role: 'assistant',
      content: '',
      toolInvocations: [],
    }
    messages.value.push(assistantMessage)

    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('0:')) continue

        try {
          const jsonStr = line.substring(2)
          const data = JSON.parse(jsonStr)

          if (data.type === 'text-delta') {
            const textContent = data.textDelta || data.text || ''
            assistantMessage.content += textContent
          } else if (data.type === 'tool-call') {
            if (!assistantMessage.toolInvocations) {
              assistantMessage.toolInvocations = []
            }
            assistantMessage.toolInvocations.push({
              toolName: data.toolName,
              state: 'call',
              args: data.args,
            })
          } else if (data.type === 'tool-result') {
            if (assistantMessage.toolInvocations) {
              const tool = assistantMessage.toolInvocations.find(
                t => t.toolName === data.toolName
              )
              if (tool) {
                tool.state = 'result'
                tool.result = data.result
              }
            }
          }

          scrollToBottom()
        } catch (err) {
          console.error('Error parsing line:', line, err)
        }
      }
    }
  } catch (error) {
    console.error('Error:', error)
    messages.value.push({
      role: 'assistant',
      content: 'Sorry, an error occurred while processing your request.',
    })
  } finally {
    isLoading.value = false
    scrollToBottom()
  }
}
</script>

<template>
  <div class="chat-container">
    <div class="chat-header">
      <h1>AI Chat with File Operations</h1>
    </div>

    <div ref="messagesContainer" class="messages-container">
      <div v-for="(message, index) in messages" :key="index" class="message" :class="message.role">
        <div class="message-header">
          <span class="role-badge">{{ message.role === 'user' ? 'You' : 'AI' }}</span>
        </div>

        <div class="message-content">
          <div v-if="message.content && message.content.trim()" v-html="formatMessage(message.content)" class="markdown-content"></div>

          <!-- Tool invocations -->
          <div v-if="message.toolInvocations && message.toolInvocations.length > 0" class="tool-invocations">
            <div v-for="(tool, toolIndex) in message.toolInvocations" :key="toolIndex" class="tool-section">
              <div class="tool-pill">
                <span class="tool-icon">🛠️</span>
                <span class="tool-name">{{ getToolDisplayName(tool.toolName) }}</span>
                <span v-if="tool.state === 'result'" class="tool-status success">✓</span>
                <span v-else-if="tool.state === 'call'" class="tool-status pending">⋯</span>
                <span v-else class="tool-status error">✗</span>
              </div>
              <div v-if="tool.result" class="tool-result">
                <pre>{{ JSON.stringify(tool.result, null, 2) }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="isLoading" class="message assistant loading">
        <div class="message-header">
          <span class="role-badge">AI</span>
        </div>
        <div class="message-content">
          <div class="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>
    </div>

    <form @submit.prevent="handleSubmit" class="input-form">
      <input
        v-model="input"
        :disabled="isLoading"
        placeholder="Type your message here..."
        class="message-input"
      />
      <button type="submit" :disabled="isLoading || !input.trim()" class="send-button">
        Send
      </button>
    </form>
  </div>
</template>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 1200px;
  margin: 0 auto;
  background: #fff;
}

.chat-header {
  padding: 1rem;
  border-bottom: 1px solid #e0e0e0;
}

.chat-header h1 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 500;
  color: #333;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.message {
  margin-bottom: 1rem;
}

.message-header {
  margin-bottom: 0.25rem;
}

.role-badge {
  font-size: 0.75rem;
  font-weight: 500;
  color: #666;
  text-transform: uppercase;
}

.message-content {
  padding: 0.75rem;
  border-radius: 4px;
  line-height: 1.5;
  text-align: left;
}

.message.user .message-content {
  background: #f5f5f5;
  color: #333;
}

.message.assistant .message-content {
  background: #fafafa;
  color: #333;
  border: 1px solid #e0e0e0;
}

.markdown-content :deep(pre) {
  background: #f5f5f5;
  padding: 0.75rem;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0.5rem 0;
  border: 1px solid #e0e0e0;
}

.markdown-content :deep(code) {
  font-family: monospace;
  font-size: 0.9em;
}

.markdown-content :deep(p) {
  margin: 0.5rem 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

.tool-invocations {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.tool-section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.tool-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 0.85rem;
  color: #666;
  width: fit-content;
}

.tool-result {
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 0.5rem;
  font-size: 0.85rem;
  overflow-x: auto;
}

.tool-result pre {
  margin: 0;
  font-family: monospace;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.tool-icon {
  font-size: 0.9rem;
}

.tool-status {
  font-size: 0.75rem;
}

.tool-status.success {
  color: #4caf50;
}

.tool-status.pending {
  color: #ff9800;
}

.tool-status.error {
  color: #f44336;
}

.typing-indicator {
  display: flex;
  gap: 0.25rem;
  padding: 0.5rem 0;
}

.typing-indicator span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #999;
  animation: typing 1.4s infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    opacity: 0.3;
  }
  30% {
    opacity: 1;
  }
}

.input-form {
  display: flex;
  gap: 0.5rem;
  padding: 1rem;
  border-top: 1px solid #e0e0e0;
}

.message-input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1rem;
  outline: none;
}

.message-input:focus {
  border-color: #999;
}

.message-input:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}

.send-button {
  padding: 0.5rem 1rem;
  background: #333;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
}

.send-button:hover:not(:disabled) {
  background: #555;
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
