import { Link } from '@/i18n/navigation'
import { Logo } from '@/components/ui/Logo'
import { Mail, Phone, MapPin } from 'lucide-react'

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="bg-texture-yellow">
      <div className="max-w-7xl mx-auto px-6 lg:px-12 py-16">

        {/* Main 3-column grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 items-start">

          {/* Left — Navigate */}
          <div>
            <h3 className="font-palmore text-[32px] sm:text-[40px] text-primary mb-6 leading-none">
              NAVIGATE
            </h3>
            <ul className="space-y-3">
              {[
                { href: '/', label: 'Home' },
                { href: '/cruises', label: 'Our Cruises' },
                { href: '/crew', label: 'About the Crew' },
                { href: '/merch', label: 'Merch' },
              ].map((l) => (
                <li key={l.href}>
                  <Link href={l.href}
                    className="font-avenir text-base text-primary hover:text-accent transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Center — Logo + mission + socials */}
          <div className="flex flex-col items-center text-center">
            <Logo variant="vertical" className="mb-6" />
            <p className="font-palmore text-[22px] sm:text-[26px] text-primary leading-snug max-w-sm">
              we create boats with vibes so good, the effect is instant. you&rsquo;re relaxed, connected, and fully present.
            </p>

            {/* Social icons */}
            <div className="flex items-center gap-5 mt-6">
              <a href="https://www.instagram.com/off.courseamsterdam/" target="_blank" rel="noopener noreferrer"
                className="text-primary hover:text-accent transition-colors">
                {/* Instagram */}
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                  <circle cx="12" cy="12" r="4"/>
                  <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none"/>
                </svg>
              </a>
              <a href="https://www.tiktok.com/@offcourse020" target="_blank" rel="noopener noreferrer"
                className="text-primary hover:text-accent transition-colors">
                {/* TikTok */}
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.26 8.26 0 0 0 4.83 1.55V6.79a4.85 4.85 0 0 1-1.06-.1z"/>
                </svg>
              </a>
            </div>
          </div>

          {/* Right — Get in Touch */}
          <div className="md:text-right">
            <h3 className="font-palmore text-[32px] sm:text-[40px] text-primary mb-6 leading-none">
              GET IN TOUCH
            </h3>
            <ul className="space-y-4">
              <li>
                <a href="mailto:cruise@offcourseamsterdam.com"
                  className="font-avenir text-base text-primary hover:text-accent transition-colors flex items-center gap-2 md:justify-end">
                  <Mail size={16} className="shrink-0" />
                  cruise@offcourseamsterdam.com
                </a>
              </li>
              <li>
                <a href="https://wa.me/31645351618" target="_blank" rel="noopener noreferrer"
                  className="font-avenir text-base text-primary hover:text-accent transition-colors flex items-center gap-2 md:justify-end">
                  <Phone size={16} className="shrink-0" />
                  +316 45 35 16 18
                </a>
              </li>
              <li>
                <div className="font-avenir text-base text-primary flex items-start gap-2 md:justify-end">
                  <MapPin size={16} className="shrink-0 mt-0.5" />
                  <span>Herenmarkt 93A 1013EC<br />Amsterdam The Netherlands</span>
                </div>
              </li>
            </ul>
          </div>

        </div>

        {/* Bottom bar */}
        <div className="border-t border-primary/20 mt-14 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="font-avenir text-sm text-primary/60">
            © {year} Off Course Amsterdam. All rights reserved.
          </p>
          <div className="flex gap-6">
            <Link href="/privacy"
              className="font-avenir text-sm text-primary/60 hover:text-primary transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms"
              className="font-avenir text-sm text-primary/60 hover:text-primary transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>

      </div>
    </footer>
  )
}
