'use client'

/**
 * Form field primitives for admin modals/forms. The className strings are the
 * exact ones previously copy-pasted across PartnerModal, CampaignModal,
 * PromoCodeFormModal, ExtrasFormModal etc. — defined once here so a styling
 * tweak no longer means a find-and-replace across nine files.
 */

export const adminInputClass =
  'w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent'

export const adminTextAreaClass = `${adminInputClass} resize-none`

interface FieldProps {
  label: string
  /** Small grey helper text under the control. */
  hint?: string
  children: React.ReactNode
}

/** Label + control wrapper. Compose freely: grids of fields still work because this renders a plain div. */
export function Field({ label, hint, children }: FieldProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-zinc-400 mt-1">{hint}</p>}
    </div>
  )
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'>

export function TextField({ label, hint, ...input }: { label: string; hint?: string } & InputProps) {
  return (
    <Field label={label} hint={hint}>
      <input {...input} className={adminInputClass} />
    </Field>
  )
}

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'>

export function SelectField({ label, hint, children, ...select }: { label: string; hint?: string } & SelectProps) {
  return (
    <Field label={label} hint={hint}>
      <select {...select} className={adminInputClass}>
        {children}
      </select>
    </Field>
  )
}

type TextAreaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>

export function TextAreaField({ label, hint, ...textarea }: { label: string; hint?: string } & TextAreaProps) {
  return (
    <Field label={label} hint={hint}>
      <textarea {...textarea} className={adminTextAreaClass} />
    </Field>
  )
}
