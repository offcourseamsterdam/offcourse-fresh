import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/usage', () => ({ meteredMessage: vi.fn() }))

import { meteredMessage } from '@/lib/ai/usage'
import { detectCateringConfirmation } from './detect-confirmation'

function toolResponse(classification: string) {
  return {
    id: 'msg_1',
    content: [{ type: 'tool_use', id: 'tu_1', name: 'classify_catering_reply', input: { classification } }],
    usage: { input_tokens: 10, output_tokens: 5 },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('detectCateringConfirmation', () => {
  it('classifies a clear confirmation reply as confirmed', async () => {
    vi.mocked(meteredMessage).mockResolvedValue(toolResponse('confirmed') as never)

    const result = await detectCateringConfirmation('Sounds good, order confirmed for Saturday!')

    expect(result).toBe('confirmed')
    expect(meteredMessage).toHaveBeenCalledWith(
      'catering_confirmation_detect',
      expect.objectContaining({ tool_choice: { type: 'tool', name: 'classify_catering_reply' } }),
    )
  })

  it('classifies a reply asking a question as needs_reply', async () => {
    vi.mocked(meteredMessage).mockResolvedValue(toolResponse('needs_reply') as never)

    const result = await detectCateringConfirmation('Do you want the vegetarian platter instead?')

    expect(result).toBe('needs_reply')
  })

  it('classifies an out-of-office auto-reply as unclear', async () => {
    vi.mocked(meteredMessage).mockResolvedValue(toolResponse('unclear') as never)

    const result = await detectCateringConfirmation('I am out of office until Monday. For urgent matters contact...')

    expect(result).toBe('unclear')
  })

  it('fails closed to unclear on an API error — never a false confirmation', async () => {
    vi.mocked(meteredMessage).mockRejectedValue(new Error('Anthropic API down'))

    const result = await detectCateringConfirmation('Confirmed, see you then!')

    expect(result).toBe('unclear')
  })

  it('fails closed to unclear when the model returns no tool_use block', async () => {
    vi.mocked(meteredMessage).mockResolvedValue({
      id: 'msg_2',
      content: [{ type: 'text', text: 'confirmed' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    } as never)

    const result = await detectCateringConfirmation('Confirmed!')

    expect(result).toBe('unclear')
  })

  it('fails closed to unclear when the tool input has an unrecognized classification value', async () => {
    vi.mocked(meteredMessage).mockResolvedValue(toolResponse('yes') as never)

    const result = await detectCateringConfirmation('Yep!')

    expect(result).toBe('unclear')
  })
})
