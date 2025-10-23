<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { marked } from 'marked'
import 'highlight.js/styles/github-dark.css'
import hljs from 'highlight.js'

// Configure marked with highlight.js
marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code).value
  },
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
    return marked.parse(content) as string
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
  const currentInput = input.value
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
            assistantMessage.content += data.textDelta
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
            <div v-for="(tool, toolIndex) in message.toolInvocations" :key="toolIndex" class="tool-pill">
              <span class="tool-icon">🛠️</span>
              <span class="tool-name">{{ getToolDisplayName(tool.toolName) }}</span>
              <span v-if="tool.state === 'result'" class="tool-status success">✓</span>
              <span v-else-if="tool.state === 'call'" class="tool-status pending">⋯</span>
              <span v-else class="tool-status error">✗</span>
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
  max-width: 900px;
  margin: 0 auto;
  background: #ffffff;
}

.chat-header {
  padding: 1.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.chat-header h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  background: #f7f9fc;
}

.message {
  margin-bottom: 1.5rem;
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-header {
  margin-bottom: 0.5rem;
}

.role-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.message.user .role-badge {
  background: #e3f2fd;
  color: #1976d2;
}

.message.assistant .role-badge {
  background: #f3e5f5;
  color: #7b1fa2;
}

.message-content {
  padding: 1rem;
  border-radius: 12px;
  line-height: 1.6;
}

.message.user .message-content {
  background: #e3f2fd;
  color: #1a1a1a;
}

.message.assistant .message-content {
  background: white;
  color: #1a1a1a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.markdown-content :deep(pre) {
  background: #1e1e1e;
  padding: 1rem;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.5rem 0;
}

.markdown-content :deep(code) {
  font-family: 'Courier New', monospace;
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
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.tool-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: #f0f4ff;
  border: 1px solid #d0d7ff;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 500;
  color: #4c51bf;
}

.tool-icon {
  font-size: 1rem;
}

.tool-status {
  font-size: 0.75rem;
  margin-left: 0.25rem;
}

.tool-status.success {
  color: #10b981;
}

.tool-status.pending {
  color: #f59e0b;
}

.tool-status.error {
  color: #ef4444;
}

.typing-indicator {
  display: flex;
  gap: 0.25rem;
  padding: 0.5rem 0;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
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
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-10px);
  }
}

.input-form {
  display: flex;
  gap: 0.75rem;
  padding: 1.5rem;
  background: white;
  border-top: 1px solid #e5e7eb;
}

.message-input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  font-size: 1rem;
  outline: none;
  transition: border-color 0.2s;
}

.message-input:focus {
  border-color: #667eea;
}

.message-input:disabled {
  background: #f3f4f6;
  cursor: not-allowed;
}

.send-button {
  padding: 0.75rem 2rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.send-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
</style>
