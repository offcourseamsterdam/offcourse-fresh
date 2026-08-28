// @vitest-environment jsdom
//
// Uses DOMParser, same reason sanitize-html.test.ts overrides the environment.
import { describe, it, expect } from 'vitest'
import { stripQuotedReply } from './strip-quoted-reply'

describe('stripQuotedReply', () => {
  it('strips a Gmail quote block', () => {
    const result = stripQuotedReply(
      '<div>Sounds good, see you then!</div><div class="gmail_quote">On Mon, Aug 10, 2026, Sarah wrote:<br>Can we book Saturday?</div>',
    )
    expect(result).toContain('Sounds good')
    expect(result).not.toContain('Can we book Saturday')
  })

  it('strips a Yahoo quote block with a dynamically-hashed class prefix', () => {
    const result = stripQuotedReply(
      '<div>Thanks!</div><div class="ydp83873803yahoo_quoted">On Tuesday, Suha wrote:<br>What time works?</div>',
    )
    expect(result).toContain('Thanks!')
    expect(result).not.toContain('What time works')
  })

  it('strips an Outlook reply header and everything after it', () => {
    const result = stripQuotedReply(
      '<div>Works for me.</div><div id="divRplyFwdMsg">From: Jordan<br>Sent: Monday<br>Subject: Re: Booking</div><hr><div>Original message text</div>',
    )
    expect(result).toContain('Works for me')
    expect(result).not.toContain('Original message text')
    expect(result).not.toContain('divRplyFwdMsg')
  })

  it('strips an Apple Mail cite blockquote', () => {
    const result = stripQuotedReply(
      '<div>See you Saturday!</div><blockquote type="cite">On Aug 10, 2026, Tariq wrote:<br>Can we do 5pm?</blockquote>',
    )
    expect(result).toContain('See you Saturday')
    expect(result).not.toContain('Can we do 5pm')
  })

  it('leaves plain HTML with no quote block untouched', () => {
    const result = stripQuotedReply('<p>Hello <b>there</b></p>')
    expect(result).toBe('<p>Hello <b>there</b></p>')
  })

  it('falls back to the original HTML if stripping would leave nothing', () => {
    const html = '<div class="gmail_quote">Only quoted content here</div>'
    const result = stripQuotedReply(html)
    expect(result).toBe(html)
  })
})
