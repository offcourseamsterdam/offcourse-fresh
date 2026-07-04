import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

let anthropicClient: Anthropic | null = null
let geminiClient: GoogleGenerativeAI | null = null

export function getClaude(): Anthropic {
  if (anthropicClient) return anthropicClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  anthropicClient = new Anthropic({ apiKey })
  return anthropicClient
}

export function getGemini(): GoogleGenerativeAI {
  if (geminiClient) return geminiClient
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')
  geminiClient = new GoogleGenerativeAI(apiKey)
  return geminiClient
}

// Quality text (translations, blog, image metadata). Sonnet 4 retired 2026-06-15;
// 4.6 is the same tier ($3/$15 per Mtok), cheaper and more capable.
export const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const GEMINI_MODEL = 'gemini-2.5-flash'
