'use client'

import { useState, useEffect } from 'react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { TextField, SelectField, TextAreaField } from '@/components/admin/ui/fields'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'

interface Channel {
  id: string
  name: string
  color: string | null
}

interface EditingPartner {
  id: string
  name: string
  email?: string | null
  contact_name?: string | null
  phone?: string | null
  website?: string | null
  notes?: string | null
  channel_id?: string | null
}

interface PartnerModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editing?: EditingPartner | null
}

export function PartnerModal({ open, onClose, onSaved, editing }: PartnerModalProps) {
  const [channels, setChannels] = useState<Channel[]>([])
  const { saving, error, setError, run } = useAdminSave()

  // Form state
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState('')
  const [email, setEmail] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')
  const [notes, setNotes] = useState('')

  // Load channels on mount
  useEffect(() => {
    if (!open) return
    fetch('/api/admin/tracking/channels')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setChannels(json.data)
      })
      .catch(() => {})
  }, [open])

  // Reset/prefill form when opening
  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '')
      setChannelId(editing?.channel_id ?? '')
      setEmail(editing?.email ?? '')
      setContactName(editing?.contact_name ?? '')
      setPhone(editing?.phone ?? '')
      setWebsite(editing?.website ?? '')
      setNotes(editing?.notes ?? '')
      setError(null)
    }
  }, [open, editing, setError])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (!channelId) { setError('Please select a channel'); return }

    run(async () => {
      await adminMutate(
        editing ? `/api/admin/tracking/affiliates/${editing.id}` : '/api/admin/tracking/affiliates',
        editing ? 'PUT' : 'POST',
        {
          name: name.trim(),
          channel_id: channelId,
          email: email.trim() || null,
          contact_name: contactName.trim() || null,
          phone: phone.trim() || null,
          website: website.trim() || null,
          notes: notes.trim() || null,
        },
      )
      onSaved()
      onClose()
    })
  }

  return (
    <AdminFormModal
      open={open}
      title={editing ? 'Edit Partner' : 'New Partner'}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitLabel={editing ? 'Save Changes' : 'Create Partner'}
    >
      <TextField
        label="Name *"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Sarah (Instagram)"
        autoFocus
      />

      <SelectField label="Channel *" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
        <option value="">Select a channel...</option>
        {channels.map((ch) => (
          <option key={ch.id} value={ch.id}>{ch.name}</option>
        ))}
      </SelectField>

      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="partner@example.com"
        />
        <TextField
          label="Contact name"
          type="text"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextField label="Phone" type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <TextField
          label="Website"
          type="text"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://..."
        />
      </div>

      <TextAreaField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
    </AdminFormModal>
  )
}
