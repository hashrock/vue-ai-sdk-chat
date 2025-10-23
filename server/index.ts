import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamText, type CoreMessage, jsonSchema } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.MODEL || 'claude-3-5-sonnet-20241022'

if (!LOCAL_PATH) {
  throw new Error('LOCAL_PATH environment variable is required')
}

if (!ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY environment variable is required')
}

// パスの検証とセキュリティチェック
function validatePath(filePath: string): string {
  const resolvedPath = path.resolve(LOCAL_PATH, filePath)
  const normalizedLocalPath = path.resolve(LOCAL_PATH)

  if (!resolvedPath.startsWith(normalizedLocalPath)) {
    throw new Error('Access denied: Path is outside of LOCAL_PATH')
  }

  return resolvedPath
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

// Tools definition using jsonSchema with explicit type field
const tools = {
  read_file: {
    description: 'Read the contents of a file at the specified path',
    parameters: jsonSchema({
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file within LOCAL_PATH',
        },
      },
      required: ['path'],
    }),
    execute: toolExecutors.read_file,
  },
  write_file: {
    description: 'Write content to a file at the specified path. Creates the file if it does not exist.',
    parameters: jsonSchema({
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file within LOCAL_PATH',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    }),
    execute: toolExecutors.write_file,
  },
  list_files: {
    description: 'List all files and directories in the specified directory',
    parameters: jsonSchema({
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the directory within LOCAL_PATH. Defaults to root.',
        },
      },
      required: [],
    }),
    execute: toolExecutors.list_files,
  },
  delete_file: {
    description: 'Delete a file at the specified path',
    parameters: jsonSchema({
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file within LOCAL_PATH',
        },
      },
      required: ['path'],
    }),
    execute: toolExecutors.delete_file,
  },
  rename_file: {
    description: 'Rename or move a file from one path to another',
    parameters: jsonSchema({
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Current relative path to the file within LOCAL_PATH',
        },
        to: {
          type: 'string',
          description: 'New relative path to the file within LOCAL_PATH',
        },
      },
      required: ['from', 'to'],
    }),
    execute: toolExecutors.rename_file,
  },
  create_directory: {
    description: 'Create a new directory at the specified path',
    parameters: jsonSchema({
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the directory within LOCAL_PATH',
        },
      },
      required: ['path'],
    }),
    execute: toolExecutors.create_directory,
  },
}

// Chat endpoint
app.post('/api/chat', async (c) => {
  try {
    const { messages } = await c.req.json()

    const result = streamText({
      model: anthropic(MODEL),
      system: 'You are a helpful assistant. After using any tool, always explain what you did and show the results to the user in a clear and friendly way.',
      messages: messages as CoreMessage[],
      tools,
      maxSteps: 10,
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

serve({
  fetch: app.fetch,
  port,
})
