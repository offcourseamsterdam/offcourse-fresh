'use client'

import { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'

interface StepAccordionProps {
  title: string
  summary?: string
  stepNumber: number
  isActive: boolean
  isCompleted: boolean
  onReopen?: () => void
  children: ReactNode
}

export function StepAccordion({
  title,
  summary,
  stepNumber,
  isActive,
  isCompleted,
  onReopen,
  children,
}: StepAccordionProps) {
  return (
    <div className="border-b border-zinc-100 last:border-b-0">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={isCompleted && onReopen ? onReopen : undefined}
        disabled={!isCompleted || !onReopen}
        className={`w-full flex items-center gap-3 py-4 px-1 text-left transition-colors ${
          isCompleted && onReopen ? 'cursor-pointer hover:bg-zinc-50/50' : 'cursor-default'
        }`}
      >
        {/* Step indicator */}
        <div
          className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300 ${
            isCompleted
              ? 'bg-emerald-500 text-white'
              : isActive
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-zinc-100 text-zinc-400'
          }`}
        >
          {isCompleted ? <Check className="w-3.5 h-3.5" /> : stepNumber}
        </div>

        <div className="flex-1 min-w-0">
          <span
            className={`text-sm font-medium ${
              isActive ? 'text-[var(--color-primary)]' : isCompleted ? 'text-zinc-700' : 'text-zinc-400'
            }`}
          >
            {title}
          </span>
          {isCompleted && summary && (
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{summary}</p>
          )}
        </div>

        {isCompleted && onReopen && (
          <ChevronDown className="w-4 h-4 text-zinc-400 flex-shrink-0" />
        )}
      </button>

      {/* Content — animated open/close */}
      <AnimatePresence initial={false}>
        {isActive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-5 px-1">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
