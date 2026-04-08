'use client'

import { inputCls } from './shared'

export function ListEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string
  items: Array<{ text: string }>
  onChange: (items: Array<{ text: string }>) => void
  placeholder?: string
}) {
  function update(i: number, text: string) {
    const next = [...items]
    next[i] = { ...next[i], text }
    onChange(next)
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i))
  }
  function add() {
    onChange([...items, { text: '' }])
  }
  function move(i: number, dir: -1 | 1) {
    const next = [...items]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-zinc-600">{label}</label>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={inputCls}
            value={item.text}
            placeholder={placeholder}
            onChange={e => update(i, e.target.value)}
          />
          <button
            onClick={() => move(i, -1)}
            className="text-zinc-400 hover:text-zinc-600 text-xs px-1"
          >
            ↑
          </button>
          <button
            onClick={() => move(i, 1)}
            className="text-zinc-400 hover:text-zinc-600 text-xs px-1"
          >
            ↓
          </button>
          <button
            onClick={() => remove(i)}
            className="text-zinc-400 hover:text-red-500 text-xs px-1"
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="text-xs text-zinc-500 hover:text-zinc-900 underline mt-1"
      >
        + Add item
      </button>
    </div>
  )
}
