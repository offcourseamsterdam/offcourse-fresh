import { describe, it, expect, vi } from 'vitest'
import { draftReviewReply } from './draft-reply'

function claudeReturning(text: string) {
  const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] })
  return { client: { messages: { create } } as never, create }
}

describe('draftReviewReply', () => {
  it('returns the drafted reply text', async () => {
    const { client } = claudeReturning('Sophie! So glad the sunset cruise hit the spot.')

    const reply = await draftReviewReply(
      { platform: 'google', reviewerName: 'Sophie', reviewText: 'Amazing sunset cruise!', rating: 5 },
      { claude: client },
    )

    expect(reply).toBe('Sophie! So glad the sunset cruise hit the spot.')
  })

  it('names the correct platform in the prompt sent to Claude', async () => {
    const { client, create } = claudeReturning('Great, thanks!')

    await draftReviewReply(
      { platform: 'getyourguide', reviewerName: 'Tariq', reviewText: 'Loved it', rating: 5 },
      { claude: client },
    )

    const call = create.mock.calls[0][0]
    expect(call.messages[0].content).toContain('Review on GetYourGuide by Tariq')
  })

  it('falls back to the raw platform string when it has no display label', async () => {
    const { client, create } = claudeReturning('Thanks!')

    await draftReviewReply(
      { platform: 'unknown-source', reviewerName: 'Ann', reviewText: 'Nice trip', rating: 5 },
      { claude: client },
    )

    expect(create.mock.calls[0][0].messages[0].content).toContain('Review on unknown-source by Ann')
  })

  it('includes recent replies in the prompt so Claude avoids repeating phrasing', async () => {
    const { client, create } = claudeReturning('Thanks!')

    await draftReviewReply(
      {
        platform: 'google',
        reviewerName: 'Ann',
        reviewText: 'Nice trip',
        rating: 5,
        recentReplies: ['Ann! Glad you had fun.', 'Joe, that sunset though.'],
      },
      { claude: client },
    )

    const prompt = create.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('DO NOT repeat these phrases')
    expect(prompt).toContain('1. "Ann! Glad you had fun."')
    expect(prompt).toContain('2. "Joe, that sunset though."')
  })

  it('omits the recent-replies block entirely when there are none yet', async () => {
    const { client, create } = claudeReturning('Thanks!')

    await draftReviewReply(
      { platform: 'google', reviewerName: 'Ann', reviewText: 'Nice trip', rating: 5 },
      { claude: client },
    )

    expect(create.mock.calls[0][0].messages[0].content).not.toContain('Previous replies')
  })

  it('throws when Claude returns an empty reply, instead of silently saving nothing', async () => {
    const { client } = claudeReturning('')

    await expect(
      draftReviewReply({ platform: 'google', reviewerName: 'Ann', reviewText: 'Nice trip', rating: 5 }, { claude: client }),
    ).rejects.toThrow('Claude returned an empty reply')
  })
})
