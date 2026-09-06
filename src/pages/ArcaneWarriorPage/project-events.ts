import { ApiError } from './stage-a-api.js'

export async function readProjectEvents(response: Response, onEvent: (id: string) => void) {
  if (!response.ok) throw new ApiError('UNAUTHORIZED', response.status)
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('Invalid event stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', event = '', id = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      if (buffer.length > 1_000_000) throw new Error('Event too large')
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1)
        if (!line) { if (event === 'project.changed' && /^\d+$/.test(id)) onEvent(id); event = ''; id = '' }
        else if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('id:')) id = line.slice(3).trim()
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
