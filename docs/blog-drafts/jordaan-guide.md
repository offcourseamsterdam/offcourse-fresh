# A Guide to the Jordaan (For People Who Hate Guides)

*(Draft blog post — generated via the `write-graph-blog` skill, testing a guide/sections format against the same knowledge graph. Every fact below traces to a verified graph entity — see "Where this came from" at the bottom.)*

---

Most guides to a neighborhood are really just checklists wearing a nicer outfit. This isn't going to be that, because the Jordaan doesn't really reward checklist behavior — the whole point of the place is that nothing in it was built to be on a list.

Here's the thing that runs through almost everything worth knowing about this neighborhood, water or land: none of it was built to impress anyone. It was built cheap and fast for people nobody was building anything nice for, and it got loved later, by accident, through use. That's true of the churches. It's true of the almshouses. And, it turns out, it's just as true of the bars.

## A neighborhood that was never actually designed

Quick version, because you'll want this before anything else makes sense: the Jordaan went up in the early 1600s as Het Nieuwe Werck — the New Work — housing for the working class and the immigrants nobody else was planning for. Nobody bothered surveying a grid. The streets and canals just follow whatever drainage ditches and footpaths were already sitting on the farmland, which is why everything meets the Prinsengracht at odd angles instead of straight ones. One of the interior canals, the Goudsbloemgracht, began life as a literal farm path called the Fransche Pad, running alongside a ditch dug by medieval peat farmers. The city just widened what was already there.

The name itself is a small mystery on top of that. The popular theory says it's from the French *jardin* — garden, for all the flower-named streets and canals — though there's an older, competing story that locals just started calling the Prinsengracht "the river Jordan" and it stuck. Nobody's settled which one's true, and honestly, that fits.

## What you'll pass from the water

Coming in from the Brouwersgracht — the Jordaan's northern edge — the first stretch already makes the point. Right at the corner sits 't Papeneiland, a squat 1641 house with step gables on two sides, and a few doors down at Prinsengracht 1A, three gable stones carved around 1620 by a builder named Egbert Daelder show three saints. Nobody commissioned a monument. Someone just wanted a good story on their front wall.

The Noorderkerk holds down Noordermarkt just past that, thrown up fast in the 1620s to keep pace with how quickly the neighborhood was filling in. Keep heading south and the Anne Frank House appears right on the water, beside the Westerkerk — whose tower has quietly worn a copy of the Imperial Crown of Austria since 1489. Rembrandt is buried somewhere inside that church; nobody recorded exactly where, because a poor man's grave didn't come with a name plate in the 1600s. His memorial stone wasn't added until 1909.

Slip around the back of the Westerkerk and you'll find the Homomonument — three plain pink granite triangles, unveiled in 1987. They're not called anything grander than that (despite what you might have heard — there's no "golden" anything here, just an honest inscription reading past, present, and future). One triangle sits at street level with a line of poetry; one steps down into the Keizersgracht and faces the National Monument on Dam Square; one's raised slightly and faces where the Dutch gay-rights organization COC used to have its office. Small, specific, unpretentious — the pattern again.

Duck into the interior canals and the flower-naming takes over — the Egelantiersgracht, the Bloemgracht — where Zon's Hofje and the Sint Andrieshofje both still quietly house people who need somewhere to land, and a row of four identical 1690s warehouses, Pakhuis de Arend, sit with not one ounce of decoration beyond what the job needed. Further south, the Houseboat Museum is a literal 1914 cargo ship someone actually lived on, before opening it to strangers in 1997.

## Where to actually sit down after

This is the part most guides skip, and it's the part locals actually care about.

Three of the best-known brown cafés in the Jordaan sit within a couple of blocks of each other on the Westerstraat. **Café Nol** looks like an ordinary bar from the outside — by day, it basically is one — but after dark it turns into something else: neon, mirrors, red carpet, a mixed crowd of neighborhood regulars and newcomers singing along to old Amsterdam folk songs, the same tradition behind the city's own Jordaanlied genre. A few doors down, **Het Monumentje** occupies a corner that used to be a launderette, and before that a tobacco shop — no one set out to build a beloved local institution there, it just kept being a place on that corner. And **De Blaffende Vis** — "The Barking Fish" — has carried that name only since 1988; the café's own telling traces the building back to a small liquor shop around 1916, though nobody's been able to independently confirm that part, so take it as the bar's own folklore rather than settled history. What it does promise, and delivers: no complicated menu, no pretense, just a place where people who grew up here and people who just arrived end up at the same table.

Over on the Brouwersgracht, **Café Thijssen** has held its corner since 1990, named for a statue at its door — not a war hero, not a merchant prince, but Theo Thijssen, a local schoolteacher and author. Eight beer taps, a Monday pub quiz, and the kind of crowd the café itself describes as residents, students, businesspeople, and people who enjoy life, which is a nice way of saying: everyone.

And if you want the deepest end of this pattern, walk to the Bloemstraat for **Café Chris**, which opened in 1624 and is, by most informed local opinion, the oldest café in the Jordaan — though not the oldest in Amsterdam full stop; that honor belongs to Café Karpershoek, over by Centraal Station. Four hundred years of people just... showing up.

None of these places were built to become anyone's favorite bar. They became that anyway. That's about the most Jordaan thing there is.

If that's the kind of Amsterdam you're after — the unplanned, unpretentious, actually-lived-in kind — [Off Course's private canal cruise](https://offcourseamsterdam.com/en/cruises/off-beaten-path-hidden-gems-canal-cruise) runs on the same idea: small groups, local captains, and a route built around exactly this neighborhood's kind of secret.

Want the fuller story of how this neighborhood got this way before you go looking for a table? [INTERNAL LINK: docs/blog-drafts/jordaan-from-the-water.md "our longer piece on why the Jordaan was never actually designed"] follows the same route from the water, in more depth.

---

## Where this came from

*(Internal note for Beer, not for publishing — shows the graph→blog link. Generated via the `write-graph-blog` skill.)*

| Guide claim | Graph entity | Confidence |
|---|---|---|
| Built ~1612–13 as "Het Nieuwe Werck," working-class/immigrant quarter | `jordaan` | high |
| Streets follow old drainage ditches, not a grid; Goudsbloemgracht's Fransche Pad origin | `jordaan` (facts.layout), `goudsbloemgracht` | high — spot-checked across 8+ sources |
| Jordaan name origin disputed (jardin theory vs. river-Jordan nickname) | `jordaan` (facts.etymology) | high — explicitly stored as disputed theory, not settled fact |
| 't Papeneiland corner house (1641) + Prinsengracht 1A/3/5 gable stones | `t-papeneiland-huis`, `prinsengracht-1a-gevelstenen` | high |
| Noorderkerk built 1620s to serve the growing Jordaan | `noorderkerk` | high |
| Anne Frank House, Westerkerk (1620–31, Imperial Crown 1489) | `anne-frank-house`, `westerkerk` | high |
| Rembrandt buried 1669, unmarked, memorial added 1909 | `rembrandt-van-rijn` | high — his Rozengracht residence is deliberately **not** asserted; unverified in the graph |
| Homomonument past/present/future triangles + what each faces | `homomonument` | high — "Golden Triangle" deliberately never used; checked across 6 sources, not a real term |
| Egelantiersgracht/Bloemgracht, Sint Andrieshofje, Pakhuis de Arend, Houseboat Museum | `egelantiersgracht`, `bloemgracht`, `sint-andrieshofje`, `pakhuis-de-arend`, `houseboat-museum` | high, except Sint Andrieshofje's exact founder detail — medium, split verification vote, kept to founding year only |
| Café Nol — day/night transformation, folk-singing tradition | `cafe-nol` | high; operating-since-1966 date is medium confidence (secondary aggregators only), so deliberately left out of the prose |
| Het Monumentje — prior launderette/tobacco-shop use | `het-monumentje` | medium — cross-corroborated across independent listings, but the café's own primary site couldn't be fetched (SSL issue); exact opening date omitted from the prose for this reason |
| De Blaffende Vis — name since 1988, self-reported ~1916 origin | `de-blaffende-vis` | high on the 1988 naming; the 1916 origin is explicitly flagged in the graph as unverified café folklore, and written that way in the prose |
| Café Thijssen — 1990, named after Theo Thijssen statue, character details | `cafe-thijssen` | high |
| Café Chris — 1624, oldest in the Jordaan (not oldest in Amsterdam) | `cafe-chris` | high — the "built for Westertoren workers" detail was refuted during research and is deliberately excluded |
| Closing cruise link — thematic fit, not a specific-route claim | `jordaan` → `hidden-gems-private-cruise` (`recommends-cruise`) | high on the positioning match; the cruise entity is a thin pointer by design, no price/duration/route duplicated from `cruise_listings` |

Deliberately **excluded**: Kris de Bruyne writing his hit song at Het Monumentje, and any Café-Chris/De Blaffende Vis stories tied to specific real people's criminal histories — neither survived verification, and the latter involves claims about a living person that were never independently confirmed.

## Schema markup

*(Paste into WordPress's schema field once approved — every entity below also appears in the provenance table above it, and every `schema_type` is copied directly from that entity's `kg_entities` row, not invented.)*

```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "A Guide to the Jordaan (For People Who Hate Guides)",
  "about": {
    "@type": "Place",
    "name": "The Jordaan",
    "description": "The Jordaan is a district in Amsterdam's Centrum borough, laid out from about 1612–1613 as part of the city-expansion project Het Nieuwe Werck (the Third Expansion) to house working-class residents and immigrants."
  },
  "mentions": [
    { "@type": "Canal", "name": "Goudsbloemgracht", "description": "Began life as the Fransche Pad, a farm path along a polder drainage ditch, before being widened into a canal." },
    { "@type": "LandmarksOrHistoricalBuildings", "name": "'t Papeneiland building (Prinsengracht 2)", "address": "Prinsengracht 2" },
    { "@type": "LandmarksOrHistoricalBuildings", "name": "Prinsengracht 1A, 3 & 5 (De Justitie / De Koning van Engeland)" },
    { "@type": "Church", "name": "Noorderkerk", "address": "Noordermarkt 44, 1015 NA Amsterdam", "geo": { "@type": "GeoCoordinates", "latitude": 52.379, "longitude": 4.886 } },
    { "@type": "Museum", "name": "Anne Frank House", "address": "Prinsengracht 263-267, 1016 GV Amsterdam", "geo": { "@type": "GeoCoordinates", "latitude": 52.37525, "longitude": 4.88432 } },
    { "@type": "Church", "name": "Westerkerk" },
    { "@type": "Person", "name": "Rembrandt van Rijn", "description": "Buried 8 October 1669 in an unmarked grave in the Westerkerk." },
    { "@type": "LandmarksOrHistoricalBuildings", "name": "Homomonument", "description": "Unveiled 1987, designed by Karin Daan; three triangles representing past, present, and future." },
    { "@type": "Canal", "name": "Egelantiersgracht" },
    { "@type": "Canal", "name": "Bloemgracht" },
    { "@type": "LandmarksOrHistoricalBuildings", "name": "Sint Andrieshofje", "address": "Egelantiersgracht 105-141" },
    { "@type": "LandmarksOrHistoricalBuildings", "name": "Pakhuis de Arend" },
    { "@type": "Museum", "name": "Houseboat Museum (Woonbootmuseum)", "address": "Prinsengracht 296 K, 1016 HW Amsterdam" },
    { "@type": "BarOrPub", "name": "Café Nol", "address": "Westerstraat 109, Jordaan, Amsterdam" },
    { "@type": "BarOrPub", "name": "Het Monumentje", "address": "Westerstraat 120, 1015 MP Amsterdam" },
    { "@type": "BarOrPub", "name": "De Blaffende Vis", "address": "Westerstraat 118, 1015 MN Amsterdam" },
    { "@type": "BarOrPub", "name": "Café Thijssen", "address": "Brouwersgracht 107, 1015 GD Amsterdam" },
    { "@type": "BarOrPub", "name": "Café Chris", "address": "Bloemstraat 42, Amsterdam" },
    {
      "@type": "TouristTrip",
      "name": "Off Course Private Hidden Gems Cruise",
      "description": "Small-group private canal cruise with local captains, built around the same hidden-gems-over-hotspots positioning as this piece.",
      "url": "https://offcourseamsterdam.com/en/cruises/off-beaten-path-hidden-gems-canal-cruise"
    }
  ]
}
```
