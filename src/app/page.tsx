import { redirect } from 'next/navigation'

// Redirect root to default locale. next-intl middleware handles this,
// but this file satisfies the Next.js route type validator.
export default function RootPage() {
  redirect('/en')
}
