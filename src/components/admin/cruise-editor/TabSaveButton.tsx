'use client'

import { useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function TabSaveButton({ saving, onClick }: { saving: boolean; onClick: () => void | Promise<void> }) {
  const [saved, setSaved] = useState(false)

  async function handleClick() {
    await onClick()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="pt-6">
      <Button
        onClick={handleClick}
        disabled={saving}
        size="sm"
        className={saved ? 'bg-emerald-600 hover:bg-emerald-600' : ''}
      >
        {saving && <Loader2 className="animate-spin w-3.5 h-3.5 mr-1" />}
        {saved && <Check className="w-3.5 h-3.5 mr-1" />}
        {saving ? 'Saving…' : saved ? 'Saved!' : 'Save changes'}
      </Button>
    </div>
  )
}
