import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamText, type CoreMessage, stepCountIs } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import fs from 'fs/promises'
import path from 'path'
import 'dotenv/config'

const app = new Hono()

// CORS設定
app.use('/*', cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
}))

// 環境変数チェック
const LOCAL_PATH = process.env.LOCAL_PATH
const PROVIDER = process.env.PROVIDER || 'anthropic'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.MODEL || (PROVIDER === 'openai' ? 'gpt-4o' : 'claude-3-5-sonnet-20241022')

if (!LOCAL_PATH) {
  throw new Error('LOCAL_PATH environment variable is required')
}

if (PROVIDER === 'anthropic' && !ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY environment variable is required')
}

if (PROVIDER === 'openai' && !OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required')
}

// Select AI model based on provider
const aiModel = PROVIDER === 'openai' ? openai(MODEL) : anthropic(MODEL)

// パスの検証（無効化: セキュリティチェックなし）
function validatePath(filePath: string): string {
  // LOCAL_PATHとの相対パス解決のみ行う
  return path.resolve(LOCAL_PATH!, filePath)
}

// ツール実行関数
const toolExecutors = {
  read_file: async ({ path: filePath }: { path: string }) => {
    try {
      const fullPath = validatePath(filePath)
      const content = await fs.readFile(fullPath, 'utf-8')
      return { success: true, content, path: filePath }
    } catch (error: any) {
      return { success: false, error: error.message, path: filePath }
    }
  },
  write_file: async ({ path: filePath, content }: { path: string; content: string }) => {
    try {
      const fullPath = validatePath(filePath)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content, 'utf-8')
      return { success: true, path: filePath }
    } catch (error: any) {
      return { success: false, error: error.message, path: filePath }
    }
  },
  list_files: async ({ path: dirPath = '.' }: { path?: string }) => {
    try {
      const fullPath = validatePath(dirPath)
      const entries = await fs.readdir(fullPath, { withFileTypes: true })
      const files = entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }))
      return { success: true, files, path: dirPath }
    } catch (error: any) {
      return { success: false, error: error.message, path: dirPath }
    }
  },
  delete_file: async ({ path: filePath }: { path: string }) => {
    try {
      const fullPath = validatePath(filePath)
      await fs.unlink(fullPath)
      return { success: true, path: filePath }
    } catch (error: any) {
      return { success: false, error: error.message, path: filePath }
    }
  },
  rename_file: async ({ from, to }: { from: string; to: string }) => {
    try {
      const fromPath = validatePath(from)
      const toPath = validatePath(to)
      await fs.rename(fromPath, toPath)
      return { success: true, from, to }
    } catch (error: any) {
      return { success: false, error: error.message, from, to }
    }
  },
  create_directory: async ({ path: dirPath }: { path: string }) => {
    try {
      const fullPath = validatePath(dirPath)
      await fs.mkdir(fullPath, { recursive: true })
      return { success: true, path: dirPath }
    } catch (error: any) {
      return { success: false, error: error.message, path: dirPath }
    }
  },
}

// Tools definition using inputSchema (correct property name)
const tools = {
  read_file: {
    description: 'Read the contents of a file at the specified path',
    inputSchema: z.object({
      path: z.string().describe('Relative path to the file within LOCAL_PATH'),
    }),
    execute: toolExecutors.read_file,
  },
  write_file: {
    description: 'Write content to a file at the specified path. Creates the file if it does not exist.',
    inputSchema: z.object({
      path: z.string().describe('Relative path to the file within LOCAL_PATH'),
      content: z.string().describe('Content to write to the file'),
    }),
    execute: toolExecutors.write_file,
  },
  list_files: {
    description: 'List all files and directories in the specified directory',
    inputSchema: z.object({
      path: z.string().optional().describe('Relative path to the directory within LOCAL_PATH. Defaults to root.'),
    }),
    execute: toolExecutors.list_files,
  },
  delete_file: {
    description: 'Delete a file at the specified path',
    inputSchema: z.object({
      path: z.string().describe('Relative path to the file within LOCAL_PATH'),
    }),
    execute: toolExecutors.delete_file,
  },
  rename_file: {
    description: 'Rename or move a file from one path to another',
    inputSchema: z.object({
      from: z.string().describe('Current relative path to the file within LOCAL_PATH'),
      to: z.string().describe('New relative path to the file within LOCAL_PATH'),
    }),
    execute: toolExecutors.rename_file,
  },
  create_directory: {
    description: 'Create a new directory at the specified path',
    inputSchema: z.object({
      path: z.string().describe('Relative path to the directory within LOCAL_PATH'),
    }),
    execute: toolExecutors.create_directory,
  },
}

// Chat endpoint
app.post('/api/chat', async (c) => {
  try {
    const { messages } = await c.req.json()

    // ツールスキーマをログ出力
    console.log('=== Tools Schema Debug ===')
    console.log(JSON.stringify(tools, null, 2))

    const result = streamText({
      model: aiModel,
      system: 'You are a helpful assistant. After using any tool, always explain what you did and show the results to the user in a clear and friendly way.',
      messages: messages as CoreMessage[],
      tools,
      stopWhen: stepCountIs(10), // Allow multiple tool calls and follow-up responses
      async onStepFinish({ toolCalls }) {
        // ツール呼び出しがあった場合の処理
        for (const toolCall of toolCalls) {
          console.log('Tool called:', toolCall.toolName)
        }
      },
    })

    // カスタムストリームをHonoのレスポンスに変換
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        try {
          for await (const chunk of result.fullStream) {
            console.log('Stream chunk:', chunk.type)
            const data = `0:${JSON.stringify(chunk)}\n`
            controller.enqueue(encoder.encode(data))
          }
        } catch (error) {
          console.error('Stream error:', error)
        } finally {
          console.log('Stream ended')
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error: any) {
    console.error('Error in chat endpoint:', error)
    return c.json({ error: error.message }, 500)
  }
})

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    localPath: LOCAL_PATH,
  })
})

const port = parseInt(process.env.PORT || '3000')
console.log(`🚀 Server is running on http://localhost:${port}`)
console.log(`📁 LOCAL_PATH: ${LOCAL_PATH}`)
console.log(`🤖 AI Provider: ${PROVIDER} (${MODEL})`)

serve({
  fetch: app.fetch,
  port,
})
