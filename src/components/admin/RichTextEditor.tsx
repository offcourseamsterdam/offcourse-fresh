'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Heading2,
  List,
  ListOrdered,
  Link as LinkIcon,
  Eraser,
} from 'lucide-react'
import { useEffect } from 'react'

interface RichTextEditorProps {
  /** Current HTML content. */
  value: string
  /** Called whenever the editor content changes. Receives the cleaned HTML. */
  onChange: (html: string) => void
  /** Optional placeholder shown when the editor is empty. */
  placeholder?: string
  /** Optional Tailwind class extension for the container. */
  className?: string
}

/**
 * Minimal HTML-output rich text editor for admin forms.
 *
 * Why TipTap: it parses input HTML through its schema and drops unknown
 * attributes (inline `style`, `color`, `font-family` from pasted Google Docs /
 * Notion content). So just loading dirty content into the editor cleans it.
 * Output on save is minimal semantic HTML (`<p>`, `<strong>`, `<em>`, `<h2>`,
 * `<ul>`, `<ol>`, `<li>`, `<a>`, `<br>`).
 *
 * Deliberately limited: no color picker, no font family, no font size.
 * That's exactly the source of the noise we're trying to avoid.
 */
export function RichTextEditor({ value, onChange, placeholder, className = '' }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Trim StarterKit down to what's actually useful in cruise descriptions.
        // Disabling stuff we don't want exposed in the toolbar avoids accidental insertion.
        heading: { levels: [2] },
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        code: false,
        strike: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: value,
    immediatelyRender: false, // Next.js SSR safety
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[140px] px-3 py-2 focus:outline-none [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2',
      },
    },
    onUpdate({ editor }) {
      const html = editor.getHTML()
      // TipTap returns '<p></p>' for empty content; normalize to empty string.
      onChange(html === '<p></p>' ? '' : html)
    },
  })

  // Sync external value changes (e.g. parent resets the form)
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    // Avoid infinite loop: only set content if the external value differs.
    if (value !== current && value !== (current === '<p></p>' ? '' : current)) {
      editor.commands.setContent(value || '', { emitUpdate: false })
    }
  }, [value, editor])

  if (!editor) {
    return <div className="rounded-md border border-zinc-200 min-h-[140px] bg-zinc-50" />
  }

  return (
    <div className={`rounded-md border border-zinc-200 bg-white focus-within:border-zinc-400 transition-colors ${className}`}>
      <Toolbar editor={editor} />
      <EditorContent
        editor={editor}
        data-placeholder={placeholder}
        className="text-sm text-zinc-900"
      />
    </div>
  )
}

// ── Toolbar ─────────────────────────────────────────────────────────────────

function Toolbar({ editor }: { editor: Editor }) {
  function setLink() {
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('URL', previousUrl ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  function clearFormatting() {
    editor.chain().focus().unsetAllMarks().clearNodes().run()
  }

  const btnBase = 'p-1.5 rounded hover:bg-zinc-100 transition-colors text-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed'
  const btnActive = 'bg-zinc-900 text-white hover:bg-zinc-800'

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-zinc-200 bg-zinc-50">
      <button
        type="button"
        title="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`${btnBase} ${editor.isActive('bold') ? btnActive : ''}`}
      >
        <BoldIcon className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        title="Italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`${btnBase} ${editor.isActive('italic') ? btnActive : ''}`}
      >
        <ItalicIcon className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        title="Heading"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={`${btnBase} ${editor.isActive('heading', { level: 2 }) ? btnActive : ''}`}
      >
        <Heading2 className="w-3.5 h-3.5" />
      </button>
      <div className="w-px h-4 bg-zinc-200 mx-1" />
      <button
        type="button"
        title="Bullet list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`${btnBase} ${editor.isActive('bulletList') ? btnActive : ''}`}
      >
        <List className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        title="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`${btnBase} ${editor.isActive('orderedList') ? btnActive : ''}`}
      >
        <ListOrdered className="w-3.5 h-3.5" />
      </button>
      <div className="w-px h-4 bg-zinc-200 mx-1" />
      <button
        type="button"
        title="Link"
        onClick={setLink}
        className={`${btnBase} ${editor.isActive('link') ? btnActive : ''}`}
      >
        <LinkIcon className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        title="Clear formatting"
        onClick={clearFormatting}
        className={btnBase}
      >
        <Eraser className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
