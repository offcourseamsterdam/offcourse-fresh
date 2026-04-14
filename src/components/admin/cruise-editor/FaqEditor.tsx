'use client'

import { inputCls } from './shared'

export function FaqEditor({
  faqs,
  onChange,
}: {
  faqs: Array<{ question: string; answer: string }>
  onChange: (f: Array<{ question: string; answer: string }>) => void
}) {
  function update(i: number, field: 'question' | 'answer', val: string) {
    const next = [...faqs]
    next[i] = { ...next[i], [field]: val }
    onChange(next)
  }
  function remove(i: number) {
    onChange(faqs.filter((_, idx) => idx !== i))
  }
  function add() {
    onChange([...faqs, { question: '', answer: '' }])
  }
  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-zinc-600">FAQs</label>
      {faqs.map((faq, i) => (
        <div key={i} className="border border-zinc-200 rounded-lg p-3 space-y-2 bg-white">
          <div className="flex items-start justify-between gap-2">
            <input
              className={inputCls}
              placeholder="Question"
              value={faq.question}
              onChange={e => update(i, 'question', e.target.value)}
            />
            <button
              onClick={() => remove(i)}
              className="text-zinc-400 hover:text-red-500 text-xs mt-2 flex-shrink-0"
            >
              ×
            </button>
          </div>
          <textarea
            className={`${inputCls} min-h-[80px] resize-y`}
            placeholder="Answer"
            value={faq.answer}
            onChange={e => update(i, 'answer', e.target.value)}
          />
        </div>
      ))}
      <button
        onClick={add}
        className="text-xs text-zinc-500 hover:text-zinc-900 underline"
      >
        + Add FAQ
      </button>
    </div>
  )
}
