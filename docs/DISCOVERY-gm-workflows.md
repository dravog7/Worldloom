# DISCOVERY: How GMs & Worldbuilders Actually Manage Campaign Notes

**Product:** Worldloom (lightweight desktop app; campaign world = folder of markdown files; live-preview editing, wikilinks, backlinks, search; planned AI contradiction auditor with bring-your-own API key; one-time purchase ~$29–49)
**Date:** 2026-10-12
**Researcher:** Hermes discovery subagent
**Method:** 31 web_search queries issued (25 returned results; a cluster of late queries returned empty due to a flaky search backend — retried with alternate phrasing); 10 Reddit threads deep-extracted in a real browser (post body + comments); 5 marketing/vendor pages fetched directly (Campfire pricing, Obsidian pricing, Saga20 comparison, NovelOS, Penpoint); G2/Capterra/Trustpilot blocked by bot protection (403) and could not be mined — see Limitations.
**Confidence labels:** High = multiple independent direct sources; Medium = one strong direct source or several consistent snippets; Low = single snippet, weak, or inferred.

**Source shorthand:** quotes marked `[reddit]` were read verbatim in a browser; `[snippet]` = from a search-result excerpt (verbatim but less context); `[vendor]` = vendor's own page; `[synthesis]` = my inference from the above.

---

## 1. Executive summary

1. **The market is fragmentary, not tool-loyal.** Most GMs run hybrid stacks — Google Docs/OneNote + Discord + a VTT + sometimes a wiki. "One big document that balloons" is the single most common migration trigger. **[High]**
2. **Obsidian is the most-recommended dedicated tool in GM communities, and simultaneously the one non-technical GMs bounce off.** It wins on ownership/free/local; it loses on markdown syntax, visual formatting limits, and setup rabbit holes. **[High]**
3. **Markdown friction is real but specific:** non-programmer GMs don't quit over `#` headings; they quit over "no colored text, no fonts, can't position images," plugin/template tinkering, and intangibility of syntax. Several say markdown became easy after a week. The pain is *visual formatting + perceived complexity*, not the file format itself. **[High]**
4. **Lock-in fear is loud, genuine, and concentrated in exactly the buyer segment that pays.** "The company could implode tomorrow and you would still have all your files" is a recurring buying argument for Obsidian; Notion export is widely mocked ("databases come out as flat csvs and you lose the relations"). But a Notion-side counterpoint: most users never think about portability at all. Sell ownership to the payer, don't build features for the 0.01%. **[High]**
5. **Subscription fatigue is explicit and quotable.** "I actively avoid stuff with subscriptions… not a subscription that quickly adds up to incredible sums. On top of that — I want full control over my data." Foundry VTT's $50 one-time license is praised as "insanely cheap one time license cost (no subscriptions)"; a pay-once worldbuilding app at $45 (NovelOS) already exists as a positioning precedent. **[High]**
6. **Price anchors are brutal for subscriptions, forgiving for one-time.** LegendKeeper at $90/yr drew "not cool enough to be worth a hundred bucks a year"; Campfire's own poll (n=282 on r/worldbuilding) had 34 of 74 knowledgeable voters say "too overpriced to be worth it"; yet the same people happily buy lifetime deals (Foundry, WA lifetime on sale, Campfire lifetime ~$15/module). A $29–49 one-time price sits *below* the annual cost of every major subscription competitor. **[High]**
7. **World Anvil's core complaint is "prep time turns into formatting time"** plus a steep interface; its free tier is public-only (no private notes without paying $54/yr). Kanka's core complaint is upload caps and rigidity ("you're stuck with their structure"). Campfire's is nickel-and-dime module perception + clunky UI. **[High]**
8. **Player sharing matters less than it looks.** GMs value it as a nice-to-have ("players didn't really end up utilizing it" is a recurring outcome); most share a one-pager or recaps, not the wiki. Secrets/visibility (GM-only content in the same tree) is the real requirement — and Notion can't do it, which is why GMs there maintain duplicate pages. **[Medium-High]**
9. **The AI-contradiction idea has validated demand and early competition.** Wikis "go stale somewhere in the first dozen sessions" is documented (Saga20, Oct 2026), and consistency-linting products/plugins already exist (Obsidian plugin "Codex Narrative Engine" — "entity indexing, consistency linting, and dead-link detection"; Narralogy — "catch contradictions and plot holes"). Separately, GMs are allergic to AI trained on their table: "uploading private conversations to some sketchy AI cashgrab sounds very questionable" — BYO-key + no-training is the right framing. **[Medium-High]**
10. **Discovery happens on Reddit recommendation threads and YouTube tool roundups**, often via word-of-mouth repetition ("I'm seeing quite a few people mention Obsidian, I'll probably give it shot"). Awareness is low even inside communities: 74% of a r/worldbuilding poll had never heard of Campfire. Being *recommended in threads* is the growth engine that matters. **[High]**

---

## 2. Personas (from observed behavior, not invented)

### P1 — "Committed Homebrew GM" (primary buyer)
Runs a weekly/biweekly long campaign; hundreds of notes across NPCs/locations/quests/session logs; preps between work and session, often on a laptop/commute ("Since I prep on the train to work, having everything synced between my PC and laptop helps a lot" [reddit, r/rpg 1lqpsgl]). Currently hybrid: Google Docs "one big document" or OneNote + Discord + Roll20/Foundry + spreadsheet. Pain: bloat, search, remembering what was told to players. Willing to pay ~$30 once; hostile to another monthly fee. Not a developer; uses "Obsidian (needs a subscription to be cross-platform)" — a *wrong* belief stated in a recommendation thread [reddit, r/DMAcademy 1pgzvix], i.e., tool facts are murky for this persona.

### P2 — "Worldbuilder-Author" (secondary buyer)
Solo, lore-first; may be writing a novel set in the world; spends on Campfire/WA/Scrivener; evaluates on structure vs freedom (WA prompts vs blank canvas). Cares about export and longevity ("I've had problems with older computers dying and losing my work"; moved to Campfire partly because "Google Docs isn't completely private… reports of people being locked out of their files, as well as their works being used to fuel AI" [reddit, r/worldbuilding 1088cyu]). Higher spend tolerance, higher visual-formatting need ("My brain works visually and I love that it is a visual novel creator essentially" — pro-Campfire modular pricing [same thread]).

### P3 — "Pragmatic Simplifier" (largest untapped pool)
Uses Google Docs/OneNote/binder because "it's free, and I already know how to use it" [reddit, 1088cyu]. Tool-hops and abandons: "Obsidian is another tool I started to use, put a lot of time into learning and setting up, and then I haven't used it almost at all. What's 'worth it' to me is google docs. I just type stuff and run games" [reddit, r/DMAcademy 1sysurl]. Also the "back to paper at the table" GM: "I shrugged off everything that was distracting me from focusing on the game… I moved back to paper for everything… I do use Obsidian, though. That helps a ton with prep. I just don't use it at the table" [reddit, r/rpg 1lqpsgl]. Will never search for "markdown app."

---

## 3. Jobs-to-be-Done map

| Job | Frequency | Current hacks | Evidence |
|---|---|---|---|
| Capture an idea fast (often away from PC) | Daily-ish | Discord-to-self, phone notes, "jotting down ideas when out and then organizing" on Obsidian mobile | [reddit 1sysurl, 1pgzvix] [High] |
| Prep a session in 30–120 min | Weekly | Lazy-DM-style Notion templates ("Notion.so — Specifically with the Lazy Dungeon Master templates" [reddit 1pgzvix]); one-page encounter docs in Google Docs | [High] |
| Look up an NPC/place/lore mid-session in <10 s | Every session | Ctrl-F in one big doc, Kanka entity links ("NPCs who live here" type stuff [reddit 1jyy70k]), memory | [High] |
| Keep lore consistent across a long campaign | Ongoing | Manual re-reading; nothing — "after each game someone must sit down and update the pages, and for most tables the habit fades somewhere in the first dozen sessions" [vendor, Saga20 Oct 2026] | [Medium] |
| Share recaps/handouts with players | Per session | Copy-paste to Discord/Google Doc; WA blog/diary; Obsidian Publish plugin; "one pager" | [High] |
| Hide GM secrets from players | Ongoing | Separate GM pages/vaults (Notion can't scope secrecy per-paragraph: "I can either use it for me as a GM or for my players… Can't do both" [reddit 1737v5l]) | [High] |
| Not lose years of work | Evergreen | Local files, self-hosted Kanka, Syncthing/Drive sync hacks, printed binders | [High] |
| Session transcription → recap | Growing | Saga20/GM Assistant/Craig recordings → summaries → "seed my Notion lore" [reddit 1rd548j] | [Medium] |

---

## 4. RQ1 — How notes are actually organized today

**Tool distribution (observed, not statistically representative):**
- **General notes:** Google Docs (most common default), OneNote, Notion, Obsidian; physical binders/notebooks have a vocal contingent.
- **Purpose-built wikis:** World Anvil, Kanka, LegendKeeper — a minority, usually after a bloat trigger or for player-facing sharing.
- **VTT-native:** Roll20 journals/Foundry journals exist but GMs routinely supplement elsewhere: "I'm a player in a virtual campaign that uses WorldAnvil. It's good for session write-ups and not as good for some other things. The DM has to supplement with Google sheets" [reddit 1pgzvix].
- **Discord** is universal glue: voice, recaps, and "my encounter notes/quests in Discord chats to myself" [reddit 1pgzvix].

**Hybrid setups are the norm, and proud of it:** "My adhd ass makes it IMPOSSIBLE to keep notes organized, I have my 'main quests' and history on Google Docs, I have my character notes in Roll20, and I have my encounter notes/quests in Discord chats to myself" [reddit 1pgzvix]. Another: a "3-fold system" — Excel "Enchiridion" + notebook campaign bible + binder of statblocks [reddit 1pgzvix]. A modern 5-tool stack: "Notion (World builder)… Saga20 (Campaign tracker)… Syrinscape… Lost Atlas (Maps)… Shieldmaiden (Combat encounters)" [reddit 1rd548j].

**Typical migration trigger:** a single document that outgrows itself. "My current campaign has been going for twice as long as any of my previous campaigns, and the one doc I use for notes is starting to balloon a bit" [reddit 1sysurl OP]. World Anvil and Kanka users describe the same wall as upload caps instead (see RQ2).

**Session-prep workflow, in their words:**
1. Template-driven skeleton (Lazy DM Notion template is named repeatedly: [reddit 1pgzvix, 1737v5l]).
2. Scene/encounter one-pagers with read-aloud text: "If u can plan things 'encounter based' and have a page for each encounter it works well for me. I also put in read aloud txt and attempt to plan dialogue" [reddit 1sysurl].
3. Post-session: transcription tools produce recaps that GMs paste into their lore base ("I just take those summaries and use them to seed my Notion lore so everything stays consistent without me having to write up my own session recaps" [reddit 1rd548j]).
4. Prep tool ≠ table tool: Obsidian/paper for prep; the table gets a clean one-pager (see P3).

**[High confidence on "hybrid + bloat-trigger + template-driven prep"; Medium on transcription workflow (enthusiast-led, ~2025+ trend).]**

---

## 5. RQ2 — Ranked pain table (with evidence)

| # | Pain | Tools affected | Evidence (short quote) | Conf. |
|---|---|---|---|---|
| 1 | **Subscription fatigue / recurring cost resentment** | All SaaS competitors | "it's yet more services demanding long term subscriptions in this ever hungrier subscription economy" [reddit 1rd548j]; "I actively avoid stuff with subscriptions… not a subscription that quickly adds up to incredible sums" [reddit 1rd548j] | High |
| 2 | **Ownership/lock-in anxiety** | Notion, WA, LK, Campfire-online | "You OWN your notes locally (Notion is not local)" [reddit 1sysurl]; "all files are in a non-proprietary format (Markdown); the company could implode tomorrow and you would still have all your files" [reddit 1737v5l]; "the reason its so painful is notion's data model doesn't map cleanly to files, databases come out as flat csvs and you lose the relations, rollups" [snippet, r/Notion 1uladm0] | High |
| 3 | **Prep time → formatting time / setup overhead** | WA, Obsidian (setup), Campfire | "that same depth can turn prep time into formatting time, so they end up with pages to fill when they needed a session plan" [vendor Saga20]; "I found myself spending a lot of time learning the new tool… rather than just doing the minimum things I wanted to do" [reddit 1sysurl] | High |
| 4 | **Steep/clunky UI** | WA (worst), Kanka, Campfire | "Am I an idiot or is worldanvil really hard to use?" [thread title, snippet r/DMAcademy usj5gi]: "it was definitely challenging to use and my players didn't really end up utilizing it either" [snippet]; "I found the interface clunky compared to Obsidian. The organization feels a bit rigid, you're stuck with their structure instead of being able to organize things how your brain works" [reddit 1lqpsgl, Kanka] | High |
| 5 | **Storage/upload caps** | Kanka, WA | "i have hit a cap on images i can upload and im not willing to pay for more store… I want the storage to be off my own PC so i can upload as much as i want" [reddit 1jyy70k]; "spoke to a rep about the upload limit which completely put me off using it. Basically no matter which tier I…" [snippet, r/worldbuilding 1ioi11t] | High |
| 6 | **No rich text / visual formatting** | Obsidian/markdown tools | "No rich text or document formatting… my brain works visually, so I tend to like to color-code and use fonts and boxes… No fonts, no custom font sizes, no colored text or highlighting" [reddit 1sysurl]; "I just can't follow along a page full of black and white mono-stylized text while trying to improvise and run the game" [reddit 1sysurl] | High |
| 7 | **Notion slowness & broken export** | Notion | "Laggy as hell, every click or scroll takes a second of delay" [snippet r/Notion 1pedvtz]; "Very worried about losing all my data on Notion" [snippet thread title 1gj1o2s]; a custom 1.8GB Notion→Obsidian migration tool had to be written because "existing tools failed" [snippet r/ObsidianMD 1nyw5c4] | High |
| 8 | **Free-tier privacy walls** | WA (public-only free tier), LK (read-only after trial) | "nothing stays hidden, no article can be made private, and a player hunting around can always find the villain's real name" [vendor Saga20 on WA free tier] | Medium |
| 9 | **Plugin/template rabbit holes** | Obsidian | "obsidian felt a bit overwhelming with so many plugins and template tinkering" [reddit 1rd548j]; "I wasted so many hours on obsidian" [snippet thread title r/ObsidianMD 1j12tn7] | High |
| 10 | **Sync friction** | Obsidian (self-managed), all local tools | "when inspiration hits, you gotta either pull out your computer or sync the vault to your phone… still a bit of a hassle/annoying" [reddit 1sysurl]; community workarounds = Google Drive folder, Syncthing, iCloud, NAS [reddit 1pgzvix, 1lqpsgl, 1jyy70k] | High |
| 11 | **Link/structure breakage fears** | Obsidian | "it was too easy to break the links, which was supposedly the whole point of obsidian, unbreakable links…" [reddit 1sysurl] | Low-Med |
| 12 | **Engagement-bait/contest spam, dark-mode-only UI fiasco** | WA | "they're constantly spamming you with vlogs and ads for contests and automatically entering any page you write… to their 'worldember' contest" [reddit 1sysurl] | Low-Med (single very negative commenter) |
| 13 | **Desktop→web migration resentment** | Campfire | "I loved it when it was a desktop app… But then they switched to Blaze, all online, with modules you had to pay for separately" [reddit 1088cyu] | Medium |
| 14 | **AI-consent concerns around session data** | AI note/summarizer tools | "Uploading private conversations to some sketchy AI cashgrab sounds very questionable. I'm very surprised the players are ok with that" [reddit 1rd548j] | Medium |

**Counter-evidence worth keeping:** a WA defender: "My table used World Anvil to 'manage' Raven's Purge… it was quite helpful for both GM and players to have a mutual 'official' information source" [reddit 1sysurl]; a Kanka fan thread exists [snippet r/rpg r5dk2a]; WA loyalists exist [snippet r/dndnext n8ni8h]. Pain is distributional, not universal.

---

## 6. RQ3 — The markdown knowledge gap

**What the evidence actually says (more nuanced than "markdown scares GMs"):**

- **Intimidation is real for the target buyer.** In a thread explicitly asking non-programmers about Obsidian: "Trying to write in markdown syntax (easy once you know, but can be intimidating for those unfamiliar)" and "if I came to it with no technical know-how I would have found it intimidating" [reddit r/ObsidianMD 1by9per, top comment]. "Markdown seems so out of my league" [same thread]. "I had to accept that Obsidian is not a WYSIWYG environment of simple drag and drop like OneNote or PowerPoint" [same thread, user who joined *specifically for TTRPG management*].
- **But many non-programmers clear the hurdle in days.** "You only really need two and a half commands to get start with Obsidian: # Sections, [[Wikilinks]], [Markdown link]" [same thread]; "No, I went from total newb to up and running in a few hours" [same thread]; "Markdown syntax… was mostly easy enough to understand though I forget things sometimes… Creating templates that uses 'codes', dataviewjs, or coding type stuff can be really really challenging" [same thread] — i.e., **basic syntax is learnable; the power-user layer is the wall.**
- **The deeper complaint is visual expressiveness, not syntax.** See pain #6: no colors, fonts, boxes, image positioning. GMs think in visual spatial layouts ("my brain works visually"), and markdown files render as uniform text. This is a product gap Worldloom's live-preview WYSIWYG can close without hiding portability.
- **Markdown is simultaneously the moat and the barrier.** "All files stored as text in standardized Markdown format… You can even drop Obsidian one day and still read and edit your notes in any Markdown viewer" [reddit 1sysurl, listed under Pros] vs "The fact that obsidian is markdown makes it awkward to draw and type in the same place" [reddit 1jyy70k].
- **Misinformation is rampant and matters commercially.** A GM stated flatly that Obsidian "needs a subscription to be cross-platform" [reddit 1pgzvix OP] — false (Obsidian is "Free without limits. No sign-up required"; Sync is an optional $4/mo add-on [vendor, obsidian.md/pricing, Oct 2026]) — and others had to correct him in-thread. Non-technical GMs do not research pricing pages; they act on thread vibes.
- One contested datapoint: the r/ObsidianMD "Why I quit using Obsidian" post complains about "the peculiar Markdown syntax, which is straightforward but somewhat tedious to grasp for the first time" [reddit 1f8990g], but commenters suspect it's troll/AI-written ("This has to be troll post"). Treat as weak.

**Finding (Medium-High confidence):** For Worldloom's persona (non-developer, 50–2000 notes), **"markdown hidden behind a live preview" is the correct default, and "your files are plain markdown" should be sold as *insurance*, not as something to learn.** Nobody in this evidence base asks to *see* syntax; several ask to *not* see it. A visible-markdown power mode can exist for the minority who want it.

---

## 7. RQ4 — Lock-in / data-ownership fears

**Direct evidence GMs fear losing years of lore:**
- Buying criteria explicitly include survivability: "all files are yours, on your machine… the company could implode tomorrow and you would still have all your files and be able to use them" [reddit 1737v5l].
- "I want full control over my data. If these services shut down or change their prices/terms, once you are committed, you are shit out of luck. Both the VTT and worldbuilding wiki I use I am hosting myself" [reddit 1rd548j].
- Notion users: "Very worried about losing all my data on Notion" [snippet 1gj1o2s]; "Does anyone else feel uncomfortable with how 'locked in' Notion makes you?" — OP notes "there's no option to export in Markdown format in a way that would make it easy to move to another platform" [reddit 1ndedvc]; exports lose database structure [snippet 1uladm0].
- Fear extends to *providers using content*: Campfire adopter citing "reports of people being locked out of their files, as well as their works being used to fuel AI" [reddit 1088cyu]; and to AI summarizer tools (consent, above).
- Obsidian's markdown portability is repeatedly the #1 pro in recommendation threads [reddit 1sysurl, 1737v5l, 1f8990g-thread comments: "Obsidian having '.md' extension allows it to be opening in the basic text editor found on any OS"].
- Even 2018-era: "world building platform with easy export. Thing is, I don't want to [lose it]" [snippet r/worldbuilding 8y1u5z]; a 2021 markdown adopter: "I don't like proprietary databases that lock my content behind a paywall, which rules our World Anvil" [snippet, Medium "World-building with Markdown"].

**Essential counter-evidence (prevents over-indexing):** "Most users don't care about lock-in. They don't even think about it. Anyone who thinks about ideas like data portability is in a small minority – probably 1% of 1%. A lot of them just so happen to congregate on this subreddit" [reddit r/Notion 1ndedvc, top-voted reply]. **[High confidence that (a) the paying, tool-switching minority cares intensely, (b) the median GM doesn't think about it, (c) it's cheap for Worldloom to win anyway since local files are the architecture — so lead with it in copy aimed at switchers, but don't expect it to convert P3 alone.]**

---

## 8. RQ5 — Sharing with players

- **It happens, but modestly.** Recaps, handouts, "one pager: here's what you need to know for the campaign — and let's be honest, the players aren't going to be interested in anything more" [snippet r/DMAcademy r46j1b]. WA campaign diaries/blog used as shared chronicles [reddit 1sysurl]; Foundry/roll20 journals per player [snippet r/DnD 1jw87z7].
- **GM-side value > player-side value.** "I can give my players access to certain notes about world lore, session recaps, and their character backstories. Way better than trying to remember what I've told them vs what they shouldn't know yet" [reddit 1lqpsgl] — sharing as *discipline aid* for the GM.
- **Adoption by players is weak.** "my players didn't really end up utilizing it either" (WA, after a paid year) [snippet usj5gi]; "I have one player who won't do email or google docs to share info at all" [snippet r/rpg jfnevi].
- **The hard requirement is secrets, not public wikis.** Notion cannot scope visibility inside a page, forcing duplicate GM/player pages [reddit 1737v5l OP + Garqu workaround]. LegendKeeper's differentiators cited: page shared with party while "a passage stays back, through secrets and granular permissions"; "The project owner alone pays. Guests are free and unlimited, so your players never meet a paywall" [vendor Saga20].
- **Implication (Medium-High):** sharing should be v1-lightweight (export a read-only HTML/PDF pack, or a "player view" toggle on notes) — enough to remove a switching objection; building a full hosted wiki platform pits Worldloom against WA/LK where they're strong and where server costs kill a one-time price.

---

## 9. RQ6 — Pricing behavior

**What competitors charge (verified Oct 2026):**
| Tool | Model | Source |
|---|---|---|
| Obsidian | App free forever; Sync $4/mo (annual) or $5/mo; Publish $8/mo; Catalyst $25 one-time; Commercial $50/user/yr | [vendor obsidian.md/pricing] |
| World Anvil | Free (public only, ads, caps); Master $54/yr (privacy begins); Grandmaster $99/yr; Sage $300/yr | [vendor via Saga20 comparison] |
| Kanka | Free (unlimited entries, 10 members/campaign, low upload caps ~3MiB files/5MiB maps, self-hostable); paid $49.92–$249.84/yr | [vendor via Saga20] |
| LegendKeeper | 14-day trial, then view/export only; Pro $9/mo or $90/yr; unlimited free guests | [vendor via Saga20] |
| Campfire | Free with hard element caps; Standard $12/mo annual ($19 monthly) for all modules; historically lifetime-per-module (~$15/module, $375 all-modules lifetime cited by third parties) | [vendor campfirewriting.com/pricing; reddit 1088cyu; snippet writeabookai.com] |
| Foundry VTT (adjacent) | ~$50 one-time, praised relentlessly | [snippet r/FoundryVTT + r/Solo_Roleplaying] |
| NovelOS (novelists, pay-once peer) | $45 pay once, offline | [vendor novelos.studio] |

**Behavioral findings:**
- **Willingness to pay exists and is healthy for value delivered:** "I spend maybe 30-something bucks a month on all this stuff. Is it worth it? For me, yeah" [reddit 1lqpsgl]; WA lifetime bought on sale ("100% worth it… Is it worth using? Not currently" [reddit 1sysurl]); Campfire lifetime modules [reddit 1088cyu].
- **But free alternatives (Obsidian, Google Docs, OneNote, Kanka-free) set a hard ceiling on *subscription* value:** "I think its less that Campfire is overpriced, and more that options like Obsidian or Google Docs are entirely free" [reddit 1088cyu]; "One note is free. Why would I pay for this?" [same]; "$100/year" for LegendKeeper repeatedly judged "not worth it" for its one differentiator (interactive maps) [reddit 1737v5l].
- **Modular/lifetime pricing is praised when done honestly, resented when nickel-and-diming:** pro — "I love that I only pay monthly for the ones I need instead of a costly subscription for everything I don't" [reddit 1088cyu]; con — the whole "It cost A LOT of money. They hype up the whole .99c thing" complaint thread [same]; "If it takes you say, 3 years to complete a project, you will have spent $450… It is vastly overpriced" [same].
- **Ratings poll (r/worldbuilding, Jan 2023, n=282, self-selected):** Campfire "too overpriced to be worth it" 34; "overpriced but good" 13; "not overpriced but just not worth it" 13; "good and fair price" 11; never heard of it 208. → **Of 74 who knew it, ~64% said overpriced.** [reddit poll, verbatim tallies read in browser]
- **One-time purchase is a winning badge in adjacent categories:** Foundry — "Best part is an insanely cheap one time license cost (no subscriptions) that gives you access to all future versions" [reddit 1rd548j]; "A second recommendation for Foundry. It's a one-time purchase for $50" [snippet r/Solo_Roleplaying].
- **AI pricing tolerance is untested in this niche;** no direct evidence found for what GMs would pay for AI features. The BYO-key model neatly sidesteps the "sketchy AI cashgrab" suspicion [reddit 1rd548j]. **[Low confidence — open question.]**

**Conclusion (High):** $29–49 one-time is squarely supported: below WA's $54/yr, below LK's $90/yr, above "free," and in the proven one-time band ($45 NovelOS, $50 Foundry, $30 MythScribe per internal research). The risk is not price level — it's **convincing P3 that a paid tool beats the free doc they already have**, which requires a demonstrated "aha" (fast capture + instant search + backlinks visible in 5 minutes) rather than feature lists.

---

## 10. RQ7 — Discovery channels

- **Reddit recommendation threads are the primary discovery surface.** Obsidian is proposed unprompted in nearly every "how do you organize" thread, sometimes 5+ times per thread [observed across 1pgzvix, 1sysurl, 1jyy70k, 1i87x55]. Conversion is visible: "I had never heard of it until now, but I'm seeing quite a few people mention Obsidian, I'll probably give it shot" [reddit 1sysurl OP].
- **YouTube tool roundups** list the same canon (World Anvil, Campfire, Obsidian, Notion, LegendKeeper, OneNote, Google Docs) [snippet, multiple videos 2023–2026]; creators also launch their own tools from these audiences ("Since making this video, I built my own worldbuilding app" [snippet YouTube BllWRvd4CuE]).
- **Founder-community posting works:** Kanka's dev posted version updates on r/rpg [snippet r5dk2a/9mzgzk]; LegendKeeper's founder announced on r/worldbuilding ("I quit my job to build my dream world-building app" [snippet hx3087]).
- **Word of mouth crosses use-cases:** "I've since moved over to World Anvil, after seeing my husband use it" [reddit 1088cyu].
- **Awareness gap is large even in-community:** 208/282 poll respondents had never heard of Campfire [reddit poll]. **[High: niche tools win by saturating ~10–20 recurring threads + a few YouTube listicles, not by ads.]**

---

## 11. Implications for Worldloom

| Area | Recommendation | Evidence basis | Conf. |
|---|---|---|---|
| Positioning | "Your campaign, as a folder you own forever. One price." — ownership + one-time, in that order | Lock-in quotes (RQ4); Foundry praise (RQ6) | High |
| Editor | **Live preview WYSIWYG by default; syntax hidden.** Market "no markup to learn" — do not lead with "markdown" as a feature word; it filters P3 out | RQ3; "if you can use MS Word you can use Obsidian" aspiration [1by9per] | High |
| Differentiator #1 | **Visual calm at the table:** clean rendered pages, headings/callouts that render (not raw), readable during play | "black and white mono-stylized text while trying to improvise" [1sysurl] | High |
| Differentiator #2 | **AI contradiction auditor as "continuity editor":** frame for long-campaign staleness; BYO API key + explicit "your lore never trains anything" badge | Saga20 staleness finding; AI-consent quote [1rd548j]; existing plugin/product competition | Medium-High |
| Sync | Solve it explicitly: either first-party cheap sync or blessed Google Drive/iCloud folder mode with conflict guard. Every Obsidian GM in this study runs a homemade sync hack | RQ2 #10; workarounds [1pgzvix, 1sysurl, 1lqpsgl] | High |
| Mobile | Minimum viable = fast capture + read (not full edit) on phone; full edit later | Inspiration-capture pain [1sysurl]; Obsidian mobile complaints [snippet 13nquf8] | Medium |
| Import/escape | Ship importers early: Notion export (messy md+csv), Obsidian vault open-as-folder, Google Docs paste cleanup. "Bring your mess" is a acquisition wedge | Notion export threads; migration tool story [1nyw5c4] | High |
| Sharing | v1: export player pack (read-only HTML/PDF) + per-note "player-visible" toggle; not a hosted wiki | RQ5 | Medium-High |
| Out of scope (v1) | Maps/pins, calendars, statblocks, VTT, generators, publishing platform — free or commodity elsewhere; WA/Kanka own structured depth | RQ2 table; Saga20 | High |
| Pricing | $39 (or $29 launch/$49 standard) one-time; optional later paid *major-version* upgrade or cheap sync add-on; NEVER subscription for core | RQ6 | High |
| Templates | Ship "Lazy-GM-style" session-prep template as onboarding (solves blank-page fear, mimics proven Notion adoption path) | Template references [1pgzvix, 1737v5l] | Medium-High |
| Messaging to avoid | Don't say "for developers," "markdown-native," "graph view," "plugins" in primary copy; don't promise player engagement features as core | RQ3 misinformation; P3 persona | Medium |
| Discovery plan | Saturate r/DMAcademy, r/rpg, r/Worldbuilding, r/dndnext recommendation threads with genuinely helpful answers + a free template; court YouTube listicle creators; post dev-journey build threads (LK/Kanka precedent) | RQ7 | High |

---

## 12. Open questions for the CTO

1. **Sync:** build first-party sync (cost, encryption, mobile) or officially support Drive/iCloud folder vaults with conflict handling? Evidence says homemade sync is the #1 Obsidian tax, and a chunk of GMs *believe* Obsidian charges for cross-platform — a myth Worldloom could kill with one pricing-page sentence. [Priority: high]
2. **Contradiction auditor scope:** does v1 detect only cross-note factual contradictions, or also "staleness" (lore not updated after sessions)? The documented failure mode is stale wikis, not just contradictions [Saga20]. Where does it sit vs. existing Obsidian-plugin competition (Codex Narrative Engine)?
3. **BYO-key UX for non-developers:** the target persona has never held an API key. What's the onboarding path (provider pick, key paste, cost estimate per audit run)? Will they pay OpenAI/Anthropic directly?
4. **Secrets model:** GM-only notes within the same folder tree — by convention (folder/`_gm` suffix), frontmatter flag, or separate vault? Notion's failure here is a wedge; Obsidian users hack it with two vaults [1737v5l].
5. **Trial/refund policy** for a one-time purchase (competitors use 14-day trials — LK — or free tiers; one-time needs a refund window or demo to convert skeptics who've been burned by tool-hopping [1sysurl abandonment quote]).
6. **Windows-first desktop app** matches the evidence's prep locus (PC/laptop/commute), but is macOS demand real enough for v1? (Not measured in this study.)
7. **Vault size claim (50–2000 notes):** trivial for local files — is this a marketing segment definition rather than a technical constraint? Confirm before writing copy that implies limits.

---

## 13. Limitations & sample bias

- **Reddit-dominant sample:** vocal minority, skewed tech-comfortable, US/EU, English; r/ObsidianMD threads have survivorship bias (quitters post, but stay in the sub); r/worldbuilding poll (n=282) is self-selected. Treat distributions as *signal of vocabulary and failure modes*, not market shares.
- **G2/Capterra/Trustpilot could not be mined** (bot protection 403 on fetch; these tools also have thin B2B-review presence). Review-site sentiment is missing; forum sentiment substitutes.
- **YouTube comments were not extracted** (video pages; comment mining not feasible at this budget). Discovery-channel claims rest on thread observation + roundup existence.
- **Search backend flaked** on ~6 late queries (returned empty); equivalent ground was covered via earlier queries and browser extraction.
- **Prices verified Oct 2026** from vendor pages (Obsidian, Campfire) and Saga20's dated comparison (WA/Kanka/LK) — vendor pricing changes; re-verify before public comparison charts.
- **No direct interviews/surveys were conducted**; all evidence is naturally-occurring public statements. Quotes are verbatim from browser-extracted pages or marked `[snippet]`.

---

## 14. Source list

**Deep-extracted Reddit threads (post + comments read in browser):**
1. r/DMAcademy — "What are you using to organize your campaigns?" (Dec 2025) — https://www.reddit.com/r/DMAcademy/comments/1pgzvix/
2. r/rpg — "My experience with paid D&D/TTRPG tools after 3+ years as a DM/Player" (Jul 2025) — https://www.reddit.com/r/rpg/comments/1lqpsgl/
3. r/ObsidianMD — "Did any of you had a hard time learning obsidian? (non programmers)" (Apr 2024) — https://www.reddit.com/r/ObsidianMD/comments/1by9per/
4. r/DMAcademy — "Are tools like 'World Anvil' worth it?" (Apr 2026) — https://www.reddit.com/r/DMAcademy/comments/1sysurl/
5. r/worldbuilding — "What's you opinion on Campfire Writing" (poll, n=282, Jan 2023) — https://www.reddit.com/r/worldbuilding/comments/1088cyu/
6. r/rpg — "Need tips on choosing Notion or Legendkeeper for a campaign" (Oct 2023) — https://www.reddit.com/r/rpg/comments/1737v5l/
7. r/ObsidianMD — "Why I quit using Obsidian." (Sep 2024, authenticity contested) — https://www.reddit.com/r/ObsidianMD/comments/1f8990g/
8. r/rpg — "Need Campaign Manager Software recommendations" (Apr 2025) — https://www.reddit.com/r/rpg/comments/1jyy70k/
9. r/dndnext — "My favourite DM tools after testing 15 different apps over the last year" (Feb 2026) — https://www.reddit.com/r/dndnext/comments/1rd548j/
10. r/Notion — "Does anyone else feel uncomfortable with how 'locked in' Notion makes you?" (Sep 2025) — https://www.reddit.com/r/Notion/comments/1ndedvc/

**Search-snippet sources (verbatim excerpts via web_search):**
11. r/WorldAnvil — "Is World Anvil worth it?" (Oct 2024) — https://www.reddit.com/r/WorldAnvil/comments/1ftpm2s/
12. r/DnD — "Where do you guys keep your DM notes?" (Jun 2025) — https://www.reddit.com/r/DnD/comments/1lkcpl1/
13. r/DMAcademy — "Am I an idiot or is worldanvil really hard to use?" (May 2022) — https://www.reddit.com/r/DMAcademy/comments/usj5gi/
14. r/Notion — "Why can't I export my Notion data properly?" (Jul 2026) — https://www.reddit.com/r/Notion/comments/1uladm0/
15. r/Notion — "Why is Notion so dogshit at exporting content??" (Jun 2023) — https://www.reddit.com/r/Notion/comments/147liaw/
16. r/Notion — "Very worried about losing all my data on Notion" (Nov 2024) — https://www.reddit.com/r/Notion/comments/1gj1o2s/
17. r/ObsidianMD — "I migrated 1.8GB from Notion to Obsidian - existing tools failed, so I…" (Oct 2025) — https://www.reddit.com/r/ObsidianMD/comments/1nyw5c4/
18. r/worldbuilding — "What are your thoughts about WorldAnvil?" (Feb 2025) — https://www.reddit.com/r/worldbuilding/comments/1ioi11t/
19. r/worldbuilding — "Worldbuilding without a subscription?" (Jun 2022) — https://www.reddit.com/r/worldbuilding/comments/v7rmwt/
20. r/legendkeeper — "What are the differences between legendkeeper vs World anvil" (May 2023) — https://www.reddit.com/r/legendkeeper/comments/13hyrsb/
21. r/worldbuilding — "I quit my job to build my dream world-building app; it's LegendKeeper!" (Jul 2020) — https://www.reddit.com/r/worldbuilding/comments/hx3087/
22. r/FoundryVTT — "Is it a complete, one time purchase tool?" (Aug 2022) — https://www.reddit.com/r/FoundryVTT/comments/wl7ahz/
23. r/Solo_Roleplaying — "Using a virtual tabletop for solo roleplaying" (Mar 2024) — https://www.reddit.com/r/Solo_Roleplaying/comments/1bhupe4/
24. r/DMAcademy — "How do you share your world with your players?" (Nov 2021) — https://www.reddit.com/r/DMAcademy/comments/r46j1b/
25. r/dndnext — "Those of you who use a wiki for campaign notes…" (Sep 2021) — https://www.reddit.com/r/dndnext/comments/ph22qc/
26. r/rpg — "Running a campaign wiki. Is it worth it?" (Oct 2020) — https://www.reddit.com/r/rpg/comments/jfnevi/
27. r/DnD — "How do you organise your notes over a long-term campaign?" (Dec 2021) — https://www.reddit.com/r/DnD/comments/rine6a/
28. r/worldbuilding — "COMPARISONS of the best worldbuilding tools?" (Jan 2024) — https://www.reddit.com/r/worldbuilding/comments/19dnjcq/
29. r/ObsidianMD — "I wasted so many hours on obsidian and even became dependent…" (Mar 2025) — https://www.reddit.com/r/ObsidianMD/comments/1j12tn7/
30. r/Notion — "Notion is horrifically laggy and buggy and overall terrible UI…" (Dec 2025) — https://www.reddit.com/r/Notion/comments/1pedvtz/
31. r/rpg — "Campaign Management is amazing these days...OR...I love Kanka.io" (Nov 2021) — https://www.reddit.com/r/rpg/comments/r5dk2a/
32. r/dndnext — "Is World Anvil worth it?" (May 2021, pro-WA counterpoint) — https://www.reddit.com/r/dndnext/comments/n8ni8h/
33. r/worldbuilding — "After months of work, I actually feel my worldbuilding app is in a…" (Nov 2025) — https://www.reddit.com/r/worldbuilding/comments/1onem9p/
34. r/DMAcademy — "What is the best campaign management tool to use?" (Jan 2025) — https://www.reddit.com/r/DMAcademy/comments/1i87x55/
35. r/ObsidianMD — "I'm quitting Obsidian" (mobile experience) (May 2023) — https://www.reddit.com/r/ObsidianMD/comments/13nquf8/
36. r/worldbuilding — "How many of you use World Anvil or similar services?" (Jul 2018) — https://www.reddit.com/r/worldbuilding/comments/8y1u5z/
37. r/DnD — "Note-Taking: What Works for You as a Player?" (Apr 2025) — https://www.reddit.com/r/DnD/comments/1jw87z7/

**Vendor / article pages (fetched directly or via search):**
38. Saga20 — "World Anvil vs Kanka vs LegendKeeper (2026): Price and Fit" (Oct 7, 2026; prices "checked from each tool's own pricing page") — https://saga20.com/blog/world-anvil-vs-kanka-vs-legendkeeper/
39. Campfire — Pricing page (Oct 2026) — https://www.campfirewriting.com/pricing
40. Obsidian — Pricing page (Oct 2026) — https://obsidian.md/pricing
41. NovelOS — "Fantasia Archive Alternatives for Offline Worldbuilding" (Sep 29, 2026; $45 pay-once peer, Fantasia Archive free/OSS context) — https://novelos.studio/blog/fantasia-archive-alternatives-offline/
42. Penpoint — "Penpoint vs 5 Writing & Worldbuilding Apps Compared" (2026) — https://penpoint.app/compare
43. Obsidian Community Plugins — "Codex Narrative Engine" (consistency linting for campaign vaults) — https://community.obsidian.md/plugins/codex-narrative-engine
44. Narralogy — "Consistency checking. Catch contradictions and plot holes across your…" — https://www.narralogy.ai/
45. Summon Worlds — "How to Build a Fictional World with AI" (consistency checker framing) — https://www.summonworlds.com/how-to-master-worldbuilding-with-ai-a-complete-guide/
46. Medium — "World-building with Markdown" (Jul 2021, lock-in quote) — https://medium.com/@chrisgb/world-building-with-markdown-47e9c462e8f0 (403 on fetch; snippet only)
47. World Anvil — Free account changes blog (Apr 2024) — https://blog.worldanvil.com/announcements/update-free-account-changes/
48. YouTube — worldbuilding tool roundups (discovery evidence) — e.g. https://www.youtube.com/watch?v=BllWRvd4CuE , https://www.youtube.com/watch?v=1dG6Jw3XmEw , https://www.youtube.com/watch?v=wQ4DMySXdR8
49. RPGnet — "Solo gamers, how do you manage your solo games?" (Feb 2025) — https://forum.rpg.net/index.php?threads/solo-gamers-how-do-you-manage-your-solo-games.925936/
50. Storyflow — "The 12 Best Tools for Worldbuilding in 2026" — https://storyflow.so/blog/best-tools-worldbuilding-2026
51. Guideflow — "7 best worldbuilding software for 2026" — https://www.guideflow.com/blog/worldbuilding-software

**Total distinct sources cited: 51** (10 deep-extracted, 27 snippet-verified, 14 vendor/article).
