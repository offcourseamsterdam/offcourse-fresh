export function LocationSection() {
  return (
    <section className="bg-texture-sand min-h-screen flex items-center justify-center py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">

        {/* Section header */}
        <div className="text-center mb-14">
          <h2 className="font-briston text-[48px] sm:text-[64px] lg:text-[72px] text-accent leading-none mb-3">
            WHERE WE&apos;LL MEET
          </h2>
          <p className="font-palmore text-[32px] sm:text-[40px] text-primary leading-tight">
            smooth sailing ahead (probably)
          </p>
        </div>

        {/* 2-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">

          {/* Left — text */}
          <div>
            <p className="font-briston text-[22px] text-primary mb-4 tracking-wide">
              READY TO FLOAT?
            </p>
            <p className="font-avenir text-ink text-base leading-relaxed mb-4">
              We&apos;ll meet you at one of the most beautiful canals in the heart of Amsterdam.
              Right in the city centre, close to the Jordaan — easy to find, hard to leave.
            </p>
            <p className="font-avenir text-ink text-base leading-relaxed mb-6">
              5 minutes walking from central station. Find us at the large dock on the canal side.
            </p>
          </div>

          {/* Right — Google Maps embed */}
          <div className="rounded-2xl overflow-hidden shadow-2xl aspect-[4/3] lg:aspect-auto lg:h-96">
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
        </div>
      </div>
    </section>
  )
}
