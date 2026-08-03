---
name: write-graph-blog
description: Writes Off Course Amsterdam blog content grounded in the project's knowledge graph (kg_entities/kg_relationships in Supabase), following the brand voice in CLAUDE.md and the hard lessons from this project's Jordaan pilot — one clear thesis instead of a fact list, landmarks ordered by the graph's own spatial relationships instead of by theme, dry sparse humor instead of one-liner jokes, every hedge the graph flags (disputed, medium-confidence, refuted) preserved honestly in the prose, an honest link back to a real Off Course cruise product, schema.org JSON-LD generated from each entity's own schema_type, properly licensed images sourced and verified (not grabbed from a random image search) with graph-grounded alt text, and internal links to other blog posts covering the same topic (tracked as blog_post entities in the graph). Use this whenever Beer asks to write, draft, or revise a blog post, article, or AEO/GEO content piece for Off Course Amsterdam — especially anything touching an Amsterdam neighborhood, canal, landmark, or piece of history — even if he doesn't name the skill or mention the knowledge graph directly.
---

# Write Graph Blog

This project's blog content has one job that most blog-writing doesn't: it needs to
get **cited by LLMs** (ChatGPT, Perplexity, Gemini), not just rank in Google. That
only works if the underlying facts are actually true and verifiable — which is why
this project built a knowledge graph (`kg_entities` + `kg_relationships`, migration
`104_knowledge_graph.sql`) instead of letting the model improvise Amsterdam history
from general training.

Writing well *from* that graph turned out to be its own skill, separate from
building the graph in the first place. The first attempt at a Jordaan piece got
almost everything factually right and still needed three rounds of correction —
geography was scrambled, the humor landed corny, and it read like an annotated
encyclopedia entry with no reason for anyone to care. A second piece, written as a
practical guide instead of a narrative essay, exposed two more: it never linked to
anything Off Course actually sells, and separately, the graph's own `schema_type`
field on every entity — stored from day one specifically for this — had never once
been turned into real structured data. Each of these is a specific, avoidable
mistake. This file exists so the next piece doesn't repeat them.

It's also worth being honest about what these eight items are actually for. This
project's stated goal is getting cited by LLMs (GEO), but a blog post that only
does that is doing half a job — it builds citation authority, but nobody clicks
through and nobody books a cruise. Items 1–5 below are mostly about the citation
half; items 6–9 are about the half that was missing. Both matter, and neither
substitutes for the other.

## The nine things that actually go wrong

### 1. Writing without a thesis

A blog built by stringing verified graph facts together in whatever order they were
queried reads like a Wikipedia page — accurate, and forgettable. It satisfies the
citation goal and completely misses the point of anyone reading it.

Before writing a single paragraph, find **one sentence the piece is actually
arguing**. Look at the facts you've pulled and ask what they add up to, not just
what they say individually. The best theses fall directly out of graph data that's
already there — they're not invented on top of it. For the Jordaan piece, the facts
"laid out along old drainage ditches, not a grid" + "built fast and cheap for the
working class" + "hofjes built so nobody's widow got forgotten" + "a folk-song
genre that came out of people who had each other and not much else" all point the
same direction: *this neighborhood was never designed to be beautiful, and that's
exactly why people love it more than the planned merchant canals next door.* That
thesis then decides which facts make the cut and which don't — not "mention
everything verified."

If nothing suggests itself, that's a signal the graph doesn't have enough facts yet
on this topic, or the wrong facts — go research more (see step 2) rather than
falling back to a fact list.

### 2. Inventing or assuming facts instead of pulling them from the graph

Every factual claim in the piece — a date, a name, an address, a "why" — needs to
trace back to something in `kg_entities`/`kg_relationships`, not to general
knowledge or a plausible-sounding assumption. That discipline is the entire reason
this graph is worth having: a fact an LLM can trust to cite is a fact that's been
adversarially checked, not one that merely sounds right.

Query the graph with the bundled script before writing anything:

```bash
export $(grep -E '^SUPABASE_MANAGEMENT_TOKEN=' .env.local | xargs)
python3 .claude/skills/write-graph-blog/scripts/query_graph.py --search "jordaan"
python3 .claude/skills/write-graph-blog/scripts/query_graph.py --type canal
python3 .claude/skills/write-graph-blog/scripts/query_graph.py --full westerkerk
python3 .claude/skills/write-graph-blog/scripts/query_graph.py --types
```

`--full <slug>` is usually the most useful call — it returns one entity's complete
`facts` blob plus every relationship touching it in either direction, which is
exactly what you need to place that entity correctly relative to everything around
it (see step 3). If a query shape isn't covered by the script, fall back to the raw
Management API `curl` pattern documented in this project's `CLAUDE.md` (Supabase
section) — same project ID, same auth.

If a fact you need for the thesis simply isn't in the graph yet, that's a real gap,
not something to paper over. Run the `deep-research` skill/workflow to fill it in
(adversarial multi-vote verification, same as every existing fact in the graph),
then seed the verified result into `kg_entities`/`kg_relationships` before writing.
Never invent a historical claim to complete a paragraph — an unverified "fact" in a
piece meant to be cited by an AI is worse than a shorter piece without it.

### 3. Ordering landmarks by theme instead of by the graph's own geography

If the piece follows a route — a boat ride, a walk, "here's what you pass" — the
order things appear in the text has to match where they actually are, not how
neatly they group by subject. The first Jordaan draft grouped "churches" together
and "water culture" stops together, which stranded the Homomonument (which sits
*directly behind* the Westerkerk) three paragraphs away from the Westerkerk, next
to an unrelated stop much further down the canal. It read as scrambled because it
was.

The graph stores exactly the relationships needed to get this right:
`near`, `north-of` / `south-of`, `located-on`, `points-toward`. Pull them for every
entity you plan to include (`--full <slug>` surfaces all of them at once) and let
*that* — not subject-matter grouping — decide paragraph order. Two landmarks the
graph marks as `near` each other belong in the same paragraph or the same breath,
even if one is a 17th-century church and the other a 20th-century monument.

If a positional relationship you need doesn't exist yet, add it — it's cheap, and
it's exactly the kind of fact a future piece will otherwise have to re-derive from
scratch or get wrong again.

For a long straight stretch (a single canal with many landmarks strung along it),
adding an explicit relationship between every pair gets expensive fast. Cheaper
alternative: store `facts.approx_house_number` on each entity that sits on that
canal, then sort by it. It doesn't replace `near`/`north-of` for genuinely tight
clusters (two things across the water from each other still need an explicit
relationship — a house number alone won't tell you that), but for "what comes
next heading this direction" over a long stretch, it's the simpler signal.

### 4. Overwriting the joke budget

Off Course's tone (full detail in `CLAUDE.md` → "Tone of Voice") calls for dry,
subtle humor — "a wink, not a punchline" — inside an otherwise warm, low-key
poetic, conversational voice. It's easy to overcorrect this into a joke at the end
of every paragraph, which reads as try-hard rather than dry. The first Jordaan
draft did exactly that ("Amsterdam's relationship with beer has always been more
about the branding than the follow-through") and got called corny for it, directly.

The fix isn't removing humor — it's density. If a line is clearly *building to* a
punchline, that's the tell. Either cut it or flatten it into a plain observation
and trust the facts and the imagery to carry the paragraph instead. One real wink
per piece lands harder than five forced ones.

Also respect the hard content rules already in `CLAUDE.md` without restating them
here: never translate "Off Course" or the boat names, never reach for corporate-tour
or luxury-coded language ("exclusive," "embark on a journey," "curated experience"),
mention sustainability naturally rather than preachily.

### 5. Smoothing over the graph's own hedges

Some facts in the graph are explicitly marked uncertain: an etymology stored as a
disputed `theory` rather than settled fact, a `confidence: medium` entity backed by
a single source, or a claim the research workflow *refuted* and noted so it doesn't
get reintroduced later. Writing prose that quietly resolves that uncertainty into
false confidence undoes the whole point of adversarial verification — it turns a
carefully-hedged fact back into an unverified one, just dressed up better.

Carry the hedge into the sentence. "The name's most popular theory is..." reads
just as well as a flat assertion and stays honest. If the graph flagged something
as refuted, don't use it — that's a fact that specifically failed verification, not
one that's merely unconfirmed.

### 6. Never closing the loop back to a booking

Off Course is a boat company, not a publication. A piece that gets cited by an LLM
but never mentions anything Off Course actually sells has done half its job. The
second Jordaan piece — 2,500 words of dense, well-sourced content — never once
linked to a cruise. That's not a tone problem, it's a business-function gap.

The graph records which cruise a topic connects to via a `recommends-cruise`
relationship (entity_type `cruise`) — query it the same way as anything else:

```bash
python3 .claude/skills/write-graph-blog/scripts/query_graph.py --full jordaan
```

These `cruise` entities are deliberately thin pointers, not a copy of the real
listing. Price, duration, and route live in the `cruise_listings` table (a
different system, and one that changes) — duplicating that into the graph would
just recreate the schema-drift risk this project has already been burned by once.
What the graph *does* record is a `cruise_listings_slug` (build the public URL as
`/{locale}/cruises/{slug}`) and a plain-language note on *why* this cruise fits —
usually a shared positioning (small groups, local captains, hidden gems over
hotspots) rather than a specific route claim.

That distinction matters for how you write the link: say what's true (this cruise
is built around the same philosophy as everything in this piece) rather than what
you can't verify (that this exact boat passes this exact canal — check the
`cruise_listings` row and FareHarbor route data directly if a piece genuinely needs
to make that claim; never infer it from the topic match alone). Match the cruise to
the piece's actual persona fit too — CLAUDE.md's Sierra/Tariq personas map to
specific cruise categories (shared vs. private), and the graph's `facts.persona_fit`
records which one a given cruise entity serves. One honest, on-voice mention is
enough. This is not the place for a hard sell or a banner — a single sentence
near the close, in the piece's own voice, does the job.

### 7. Leaving the graph's schema_type unused

Every `kg_entities` row already carries a `schema_type` (`Place`, `BarOrPub`,
`LandmarksOrHistoricalBuildings`, `Person`, `Event`, `TouristTrip`, and so on) —
recorded specifically so a blog post grounded in that entity could emit real
schema.org structured data, not just prose. Nothing has done that yet. A piece
that's dense and well-sourced but has no machine-readable markup on the page is
still only half-executing the GEO strategy — the prose helps an LLM *read* the
page; the markup helps it (and search engines generally) *parse* it with
certainty.

For every entity load-bearing enough to appear in the piece's provenance table,
emit a schema.org JSON-LD object using that entity's own `schema_type`, `name`,
`summary` (as `description`), and `facts.address`/`facts.coordinates` where
present — don't invent fields the graph doesn't have. Wrap the whole piece in a
top-level `BlogPosting`, with the individual entity objects nested under `about` or
`mentions` (mentions is usually the more accurate relationship — the piece is
*about* the Jordaan, and *mentions* the Westerkerk, the Homomonument, Café
Thijssen, and so on). If the piece links to a `cruise` entity per item 6, include
that as a `TouristTrip` mention too, using its `cruise_listings_slug` to build the
`url`.

Output this as its own fenced ` ```json ` block in the draft, clearly labeled, so
Beer can paste it into the WordPress post's custom schema field (or wherever WP SEO
AI accepts raw JSON-LD) once the piece is approved — this project's actual blog
runs on headless WordPress (see item below), so nothing here is live until it's
pasted in by hand.

### 8. Publishing with no images, or images that were never actually looked at

Every SEO check on a draft from this skill has flagged the same thing: zero images, so zero image-alt signal on the page. That's a real gap — but the fix isn't to grab whatever comes up first in a Google Images search. Most of what's there is someone else's copyrighted photo, and using it on a commercial blog without checking the license is a real legal exposure, not a technicality.

In order of fit for this project's content:

1. **Off Course's own photos, first.** A cruise that already passes near a landmark almost certainly has real footage of it — rights-cleared by default, on-brand by default (the "warm, candid, golden-hour" style in `CLAUDE.md` already matches), and it reinforces the piece's own closing CTA (item 6) instead of just illustrating it.
2. **Wikimedia Commons, for anything specific and local.** Named Dutch landmarks, hofjes, gable stones, individual cafés — Amsterdam has unusually thorough open-license photo coverage of exactly this kind of thing. Stronger for this project's content than generic stock sites.
3. **Unsplash / Pexels / Pixabay, for the famous and photogenic.** Good for well-known landmarks or general mood shots; don't expect them to have a specific small café's interior.

Whatever the source, **actually look at the photo before using it** — this isn't optional. A file named `Homomonument-overview.jpg` on Commons turned out to be a parked delivery van and someone's Tesla with the monument barely in frame; the filename and category were no guide at all. Check the resolution too (a 500px-wide file makes a soft, blurry hero image) and pick the role accordingly — hero image or smaller inline shot.

Before using anything, verify the license on the specific file's own page — Commons in particular mixes CC0 (no attribution needed), CC-BY, and CC-BY-SA (both require a credit line) on the same site. Store what you find as a `facts.images` array on the entity itself, the same discipline as `sources`:

```json
"images": [{
  "role": "hero", "url": "...", "source_page": "...", "source": "Wikimedia Commons",
  "photographer": "...", "date": "...", "license": "CC0 1.0",
  "attribution_required": false, "attribution_text": "...",
  "alt_text": "...", "verified_against": "which graph fact this photo actually confirms"
}]
```

Write alt text from the entity's own verified facts, not a generic description — "The Homomonument's canal-step triangle, where flowers are left in remembrance" does real SEO work and stays accurate; "photo of a monument" does neither. The `verified_against` field matters too: a photo is worth more when it visually confirms something already in the graph (a `near` relationship, a described feature) rather than just being a nice picture of the subject.

Before trusting your own eyeballing of a candidate photo, run it through `src/lib/ai/verify-graph-image.ts` (Gemini vision, same `GOOGLE_AI_API_KEY` as the rest of this project's image pipeline — there is no OpenAI integration here, don't add one). Pass it the entity name and the exact facts you're claiming the photo shows; it returns `matches_claim`, a confidence score, a plain description, and an `additional_observations` array. Two things to know about that array: (1) it's genuinely useful as a skeptic — it will correctly refuse to confirm a claim it can't verify from pixels alone (no visible sign/label = low confidence, even if the general scene matches), which is a real signal, not a bug to work around; (2) most of what it notices (a parked car, floating leaves, a passing boat) is incidental to that one photo, not a durable fact about the landmark — don't promote those into `kg_entities.facts`. Store the whole verification result as `ai_vision_check` on the image entry instead, same treatment as any other unconfirmed lead in this project.

### 9. Writing every piece as if it's the only one

Every SEO check has also flagged the same second thing: one internal link per draft, always the cruise CTA, nothing else. That's fine when there's only one piece in existence. It stops being fine the moment a second one exists — right now the narrative piece and the guide cover a lot of the same ground (Anne Frank House, Westerkerk, Homomonument, half the cafés) and neither one so much as gestures at the other. A reader finishing one has no way to find the other, and neither does an internal-linking crawler.

The graph tracks this the same way it tracks everything else: each piece is its own entity.

```bash
python3 .claude/skills/write-graph-blog/scripts/query_graph.py --type blog_post
```

`entity_type: blog_post`, `schema_type: BlogPosting`. Facts record `draft_path` and `status` (`draft` until it's actually posted — `published_url` stays `null` until then, don't invent one). Relationship: `blog_post --about--> <topic entity>` — **always the most specific entity the piece is actually a deep-dive on, never the neighborhood by default.** A piece that's really about the Homomonument links `about: homomonument`, not `about: jordaan`, even though it's also Jordaan content. Linking everything to the neighborhood makes every post look related to every other post, which defeats the entire point of tracking this — the two existing Jordaan pieces both link `about: jordaan` only because neither one is actually a deep-dive on anything narrower than the neighborhood itself; that's the exception, not the pattern to copy.

Before finishing a new piece, query which existing `blog_post` entities share an `about` topic with it. If one exists, link to it — in the piece's own voice, as a real sentence ("we've also written about..."), not a "related posts" widget bolted on the bottom. If the target hasn't actually been published to WordPress yet, don't fake a URL: write `[INTERNAL LINK: <draft_path> "<natural anchor text>"]` as a placeholder so Beer can drop in the real link once it's live, the same convention as marking an unresolved fact — visible and honest, not silently skipped. Once a piece *is* published, go back and turn its siblings' placeholders into real links; an internal-linking web that only ever points forward in time doesn't do much for either post.

This is the same job as item 6 (linking to a cruise) applied one level wider — every piece should leave a reader, and a crawler, somewhere else useful to go.

## Output

Write the draft as a markdown file under `docs/blog-drafts/<slug>.md` — this is a
**review draft** for Beer, not a publish target. The project's actual blog runs on
headless WordPress via the WP SEO AI plugin (`docs/features/wordpress-blog.md`);
the finished copy gets pasted in there by hand once it's approved. Never describe a
draft from this skill as "published" or "live."

Structure the file as:

```markdown
# <Working Title>

<the article body, written in full — no placeholder text, including the one
honest link to a real cruise product per item 6, in-voice, near the close>

---

## Where this came from

*(Internal note, strip before publishing — shows the graph→blog link.)*

| Blog claim | Graph entity | Confidence |
|---|---|---|
| ... | `slug` | high / medium — reason |

## Schema markup

*(Paste into WordPress's schema field once approved — see item 7.)*

​```json
{ "@context": "https://schema.org", "@type": "BlogPosting", "mentions": [ ... ] }
​```
```

The provenance table isn't decoration — it's what makes the thesis-and-facts
approach checkable. Every load-bearing claim in the body should have a row. Flag
anything medium-confidence or disputed the same way the graph flags it, so Beer (or
anyone else reviewing) can see at a glance which facts are rock-solid and which are
worth a second research pass before this goes further. The schema block is the same
discipline applied to structured data instead of prose — every entity in it should
also appear in the provenance table above it.
