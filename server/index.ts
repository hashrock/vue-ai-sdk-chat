import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamText, tool, type CoreMessage } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
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

// Tools定義
const tools = {
  read_file: tool({
    description: 'Read the contents of a file at the specified path',
    parameters: z.object({
      path: z.string().describe('Relative path to the file within LOCAL_PATH'),
    }),
    execute: async ({ path: filePath }) => {
      try {
        const fullPath = validatePath(filePath)
        const content = await fs.readFile(fullPath, 'utf-8')
        return { success: true, content, path: filePath }
      } catch (error: any) {
        return { success: false, error: error.message, path: filePath }
      }
    },
  }),
  write_file: tool({
    description: 'Write content to a file at the specified path. Creates the file if it does not exist.',
    parameters: z.object({
      path: z.string().describe('Relative path to the file within LOCAL_PATH'),
      content: z.string().describe('Content to write to the file'),
    }),
    execute: async ({ path: filePath, content }) => {
      try {
        const fullPath = validatePath(filePath)
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, content, 'utf-8')
        return { success: true, path: filePath }
      } catch (error: any) {
        return { success: false, error: error.message, path: filePath }
      }
    },
  }),
  list_files: tool({
    description: 'List all files and directories in the specified directory',
    parameters: z.object({
      path: z.string().optional().describe('Relative path to the directory within LOCAL_PATH. Defaults to root.'),
    }),
    execute: async ({ path: dirPath = '.' }) => {
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
  }),
  delete_file: tool({
    description: 'Delete a file at the specified path',
    parameters: z.object({
      path: z.string().describe('Relative path to the file within LOCAL_PATH'),
    }),
    execute: async ({ path: filePath }) => {
      try {
        const fullPath = validatePath(filePath)
        await fs.unlink(fullPath)
        return { success: true, path: filePath }
      } catch (error: any) {
        return { success: false, error: error.message, path: filePath }
      }
    },
  }),
  rename_file: tool({
    description: 'Rename or move a file from one path to another',
    parameters: z.object({
      from: z.string().describe('Current relative path to the file within LOCAL_PATH'),
      to: z.string().describe('New relative path to the file within LOCAL_PATH'),
    }),
    execute: async ({ from, to }) => {
      try {
        const fromPath = validatePath(from)
        const toPath = validatePath(to)
        await fs.rename(fromPath, toPath)
        return { success: true, from, to }
      } catch (error: any) {
        return { success: false, error: error.message, from, to }
      }
    },
  }),
  create_directory: tool({
    description: 'Create a new directory at the specified path',
    parameters: z.object({
      path: z.string().describe('Relative path to the directory within LOCAL_PATH'),
    }),
    execute: async ({ path: dirPath }) => {
      try {
        const fullPath = validatePath(dirPath)
        await fs.mkdir(fullPath, { recursive: true })
        return { success: true, path: dirPath }
      } catch (error: any) {
        return { success: false, error: error.message, path: dirPath }
      }
    },
  }),
}

// Chat endpoint
app.post('/api/chat', async (c) => {
  try {
    const { messages } = await c.req.json()

    const result = streamText({
      model: anthropic(MODEL),
      messages: messages as CoreMessage[],
      tools,
      maxSteps: 10,
    })

    // カスタムストリームをHonoのレスポンスに変換
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        try {
          for await (const chunk of result.fullStream) {
            const data = `0:${JSON.stringify(chunk)}\n`
            controller.enqueue(encoder.encode(data))
          }
        } catch (error) {
          console.error('Stream error:', error)
        } finally {
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
