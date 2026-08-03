// One-off demo: run the two Homomonument candidate photos through Gemini
// vision-verification, against the exact facts already claimed for them in
// kg_entities.facts.images. Run with: npx tsx scripts/verify-graph-image-demo.ts
import { readFileSync } from 'node:fs'
import { verifyGraphImage } from '../src/lib/ai/verify-graph-image'

const CANDIDATES = [
  {
    label: 'hero (Amsterdam_Homomonument_01.jpg, CC0)',
    path: '/private/tmp/claude-501/-Users-beer-Developer-offcourse-fresh/53e37da4-2f21-4138-96e4-0c9b5c093b93/scratchpad/images/homomonument3.jpg',
    claimedFacts:
      'The Homomonument on the Keizersgracht in Amsterdam: three pink granite triangles forming a memorial; one triangle is flush with the pavement (street level, bearing a line from a 1917 poem); one steps down into the Keizersgracht canal water and is used as a site for present-day remembrance (flowers, candles); one is a raised podium about 60cm above street level. The whole thing is unveiled 1987, designed by Karin Daan.',
  },
  {
    label: 'supporting (Homomonument_Amsterdam.JPG, CC BY-SA 3.0 NL)',
    path: '/private/tmp/claude-501/-Users-beer-Developer-offcourse-fresh/53e37da4-2f21-4138-96e4-0c9b5c093b93/scratchpad/images/homomonument2.jpg',
    claimedFacts:
      'The Homomonument sits directly behind the Westerkerk, one canal over on the Keizersgracht. One of its three triangles steps down into the canal water where people sit and put their hands in the water.',
  },
]

async function main() {
  for (const c of CANDIDATES) {
    const buf = readFileSync(c.path)
    const result = await verifyGraphImage({
      base64: buf.toString('base64'),
      mimeType: 'image/jpeg',
      entityName: 'Homomonument',
      claimedFacts: c.claimedFacts,
    })
    console.log(`\n=== ${c.label} ===`)
    console.log(JSON.stringify(result, null, 2))
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
