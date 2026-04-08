import Image from 'next/image'

interface LogoProps {
  className?: string
  variant?: 'horizontal' | 'vertical'
}

export function Logo({ className, variant = 'horizontal' }: LogoProps) {
  if (variant === 'vertical') {
    return (
      <div className={`flex items-center ${className ?? ''}`}>
        <Image
          src="/logos/logo-vertical.svg"
          alt="Off Course Amsterdam — Your Friend With A Boat"
          width={220}
          height={240}
          priority
          className="w-52 sm:w-64 h-auto"
        />
      </div>
    )
  }

  return (
    <div className={`flex items-center ${className ?? ''}`}>
      <Image
        src="/logos/logo-horizontal.svg"
        alt="Off Course Amsterdam — Your Friend With A Boat"
        width={193}
        height={44}
        priority
        className="h-11 w-auto"
      />
    </div>
  )
}
