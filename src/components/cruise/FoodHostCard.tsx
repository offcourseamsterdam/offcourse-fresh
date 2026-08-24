import Image from 'next/image'
import { ChefHat } from 'lucide-react'

interface FoodHostCardProps {
  name: string
  bio: string | null
  photoUrl: string | null
}

/** Mirrors BoatCard's layout (photo top, info below) for a listing's food host —
 * used in the "The Boat" / "The Food" two-column split on single-boat food-cruise
 * listings (see CruiseContentSections). */
export function FoodHostCard({ name, bio, photoUrl }: FoodHostCardProps) {
  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm">
      <div className="relative w-full aspect-[16/10] bg-zinc-100">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={name}
            fill
            className="object-cover"
            sizes="(min-width: 640px) 50vw, 100vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-300">
            <ChefHat className="w-10 h-10" />
          </div>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-avenir font-bold text-lg text-[var(--color-primary)]">
          {name}
        </h3>
        {bio && (
          <p className="text-sm text-[var(--color-ink)] mt-2">
            {bio}
          </p>
        )}
      </div>
    </div>
  )
}
