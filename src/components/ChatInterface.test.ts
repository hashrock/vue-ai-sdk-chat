import { describe, it, expect } from 'vitest'
import { marked } from 'marked'

describe('ChatInterface formatMessage', () => {
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

  it('should return empty string for empty content', () => {
    const result = formatMessage('')
    expect(result).toBe('')
  })

  it('should return empty string for null/undefined', () => {
    // @ts-ignore - testing runtime behavior
    const result = formatMessage(null)
    expect(result).toBe('')
  })

  it('should not return undefined for any input', () => {
    const result1 = formatMessage('')
    const result2 = formatMessage('test')
    const result3 = formatMessage('# Hello')

    expect(result1).not.toContain('undefined')
    expect(result2).not.toContain('undefined')
    expect(result3).not.toContain('undefined')
  })

  it('should format markdown correctly', () => {
    const result = formatMessage('# Hello World')
    expect(result).toContain('<h1')
    expect(result).toContain('Hello World')
    expect(result).not.toContain('undefined')
  })

  it('should handle plain text without undefined', () => {
    const result = formatMessage('Plain text')
    expect(result).toContain('Plain text')
    expect(result).not.toContain('undefined')
  })

  it('should format code blocks without undefined', () => {
    const result = formatMessage('```js\nconst x = 1;\n```')
    expect(result).toContain('const x = 1')
    expect(result).not.toContain('undefined')
  })
})

describe('Message filtering', () => {
  interface Message {
    role: 'user' | 'assistant'
    content: string
  }

  const filterMessages = (messages: Message[]) => {
    return messages.filter(
      m => m.role === 'user' || (m.role === 'assistant' && m.content && m.content.trim())
    )
  }

  it('should include all user messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'user', content: '' },
    ]
    const filtered = filterMessages(messages)
    expect(filtered).toHaveLength(2)
  })

  it('should exclude assistant messages with empty content', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: '' },
      { role: 'assistant', content: 'World' },
    ]
    const filtered = filterMessages(messages)
    expect(filtered).toHaveLength(2)
    expect(filtered[0].content).toBe('Hello')
    expect(filtered[1].content).toBe('World')
  })

  it('should exclude assistant messages with whitespace-only content', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: '   ' },
      { role: 'assistant', content: '\n\t' },
    ]
    const filtered = filterMessages(messages)
    expect(filtered).toHaveLength(1)
  })

  it('should include assistant messages with actual content', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]
    const filtered = filterMessages(messages)
    expect(filtered).toHaveLength(2)
  })
})
