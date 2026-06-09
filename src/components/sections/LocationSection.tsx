import { SafeImage } from '@/components/ui/SafeImage'
import { sectionRootStyle, roleColor, type SectionStyle } from '@/lib/homepage/section-styles'

export function LocationSection({ sectionStyle }: { sectionStyle?: SectionStyle }) {
  const polaroid = sectionStyle?.decoration_image_url
  const polaroid2 = sectionStyle?.decoration_image_url_2
  return (
    <section className="bg-texture-sand min-h-screen flex items-center justify-center py-20" style={sectionRootStyle(sectionStyle)}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">

        {/* Section header */}
        <div className="text-center mb-14">
          <h2 className="font-briston text-[48px] sm:text-[64px] lg:text-[72px] leading-none mb-3" style={{ color: roleColor('h2', '#990000') }}>
            WHERE WE&apos;LL MEET
          </h2>
          <p className="font-palmore text-[32px] sm:text-[40px] leading-tight" style={{ color: roleColor('h3', '#343499') }}>
            smooth sailing ahead (probably)
          </p>
        </div>

        {/* 2-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">

          {/* Left — text */}
          <div>
            <p className="font-briston text-[34px] sm:text-[40px] mb-4 tracking-wide" style={{ color: '#a2e07d' }}>
              READY TO FLOAT?
            </p>
            <p className="font-avenir text-base leading-relaxed mb-4" style={{ color: roleColor('body', '#1f2937') }}>
              We&apos;ll meet you at one of the most beautiful canals in the heart of Amsterdam.
              Right in the city centre, close to the Jordaan — easy to find, hard to leave.
            </p>
            <p className="font-avenir text-base leading-relaxed mb-6" style={{ color: roleColor('body', '#1f2937') }}>
              5 minutes walking from central station. Find us at the large dock on the canal side.
            </p>

            {/* Decorative Polaroids — admin-uploaded, side by side with a slight
               overlap + opposite tilts. Each is a fraction of a width-capped
               container, and the second is anchored inside it (right-0), so the
               pair fits the column and never bleeds past the screen edge. */}
            {(polaroid || polaroid2) && (
              <div className="relative mt-8 w-full max-w-[440px]">
                {/* First polaroid — in flow (gives the block its height), front-left */}
                {polaroid && (
                  <div className={`relative ${polaroid2 ? 'w-[58%]' : 'w-3/5'} bg-white p-2 pb-5 shadow-polaroid -rotate-6 transition-transform hover:rotate-0 duration-300`} style={{ zIndex: 2 }}>
                    <div className="relative aspect-square overflow-hidden bg-[#e5e7eb]">
                      <SafeImage src={polaroid} alt="" fill sizes="(max-width: 640px) 45vw, 220px" className="object-cover" />
                    </div>
                  </div>
                )}
                {/* Second polaroid — overlaps to the right, anchored inside the container */}
                {polaroid2 && (
                  <div className={`absolute top-3 ${polaroid ? 'right-0 w-[58%]' : 'left-0 w-3/5'} bg-white p-2 pb-5 shadow-polaroid rotate-6`} style={{ zIndex: 1 }}>
                    <div className="relative aspect-square overflow-hidden bg-[#e5e7eb]">
                      <SafeImage src={polaroid2} alt="" fill sizes="(max-width: 640px) 45vw, 220px" className="object-cover" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right — Google Maps embed + CTA */}
          <div className="flex flex-col items-center gap-7">
            <div className="w-full rounded-2xl overflow-hidden shadow-2xl aspect-[4/3] lg:aspect-auto lg:h-96">
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2435.9583774393947!2d4.886!3d52.378!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x47c609b5e3ba9d07%3A0x0!2sHerenmarkt+93A%2C+1013EC+Amsterdam!5e0!3m2!1sen!2snl!4v1700000000000"
                width="100%"
                height="100%"
                style={{ border: 0, minHeight: '320px' }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Off Course Amsterdam departure point"
              />
            </div>
            <a
              href="#cruise-results"
              className="inline-block font-avenir font-bold text-lg px-10 py-4 rounded-full hover:opacity-90 transition-opacity shadow-lg"
              style={{ backgroundColor: '#fec200', color: '#e2611a' }}
            >
              Find your canal~cruise
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
