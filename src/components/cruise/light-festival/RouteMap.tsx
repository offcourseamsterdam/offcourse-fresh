import { pinnedArtworks } from '@/lib/cruise/light-festival'

// Illustrated (not geographic) map of the canal ring with the artwork pins and a
// little boat sailing the route. Pure SVG + CSS animation, so it renders on the
// server and costs no client JS. Animations live in globals.css (.lf-map-*).
const ROUTE = 'M 90 380 C 140 250, 260 170, 400 170 S 650 250, 700 380'
const PIN_POSITIONS: [number, number][] = [[150, 290], [280, 185], [470, 162], [610, 230], [690, 350]]

export function RouteMap() {
  const pins = pinnedArtworks().slice(0, PIN_POSITIONS.length)

  return (
    <div className="relative rounded-2xl overflow-hidden bg-[#1b1b5a] aspect-[16/9] border border-white/10 shadow-2xl">
      <svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full" role="img" aria-label="Illustrated route past the light artworks">
        <rect width="800" height="450" fill="#1b1b5a" />
        <path d="M0 60 C 200 30, 600 90, 800 50 L 800 0 L 0 0 Z" fill="#26267a" />
        <text x="400" y="36" textAnchor="middle" fill="#6c6cc4" className="font-briston" style={{ fontSize: 20, letterSpacing: '0.2em' }}>HET IJ</text>
        {[
          'M 60 420 C 110 270, 250 150, 400 150 S 690 270, 740 420',
          'M 120 440 C 160 310, 270 215, 400 215 S 640 310, 680 440',
          'M 180 460 C 210 360, 300 280, 400 280 S 590 360, 620 460',
          'M 400 60 L 400 460',
        ].map(d => (
          <path key={d} d={d} fill="none" stroke="#2f2f88" strokeWidth={14} strokeLinecap="round" />
        ))}
        <path d={ROUTE} className="lf-map-route" fill="none" stroke="#fec201" strokeWidth={3} strokeDasharray="10 8" />
        {pins.map((pin, i) => {
          const [x, y] = PIN_POSITIONS[i]
          return (
            <a key={pin.number} href="#artworks" className="cursor-pointer group">
              <title>{`Artwork ${pin.number}`}</title>
              <g transform={`translate(${x} ${y})`}>
                <circle className="lf-map-halo group-hover:scale-150 transition-transform" r={20} fill={pin.pinColor} />
                <circle r={13} fill={pin.pinColor} />
                <text y={5} textAnchor="middle" className="font-avenir" style={{ fontSize: 13, fontWeight: 700 }} fill="#111">{pin.number}</text>
              </g>
            </a>
          )
        })}
        <g className="lf-map-boat" style={{ offsetPath: `path("${ROUTE}")` }}>
          <rect x={-16} y={-7} width={32} height={14} rx={6} fill="#fff" />
          <rect x={-8} y={-13} width={14} height={8} rx={2} fill="#fec201" />
        </g>
      </svg>
      <a
        href="#artworks"
        className="absolute left-3 bottom-3 rounded-lg bg-white/95 px-3 py-1.5 text-xs text-[#1f2937] hover:bg-white transition-colors shadow-md flex items-center gap-1.5"
      >
        <span className="font-bold text-[#333399]">Your route</span>
        <span>· the festival route, artwork by artwork &rarr;</span>
      </a>
    </div>
  )
}
