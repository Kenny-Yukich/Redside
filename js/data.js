// data.js — Redside knowledge base
// All content written for a beginner. Every water links to the official ODFW
// rules; the app never states a bag limit or season as gospel, because those change.
// Home base is Madras, OR. driveMin = rough one-way drive from Madras (for sorting).

export const HOME = { name: "Madras, OR", lat: 44.6335, lon: -121.1295 };

// ODFW Central Zone recreation report — the weekly "what's biting" + stocking source.
export const ODFW_CENTRAL = "https://myodfw.com/recreation-report/fishing-report/central-zone";
export const ODFW_REGS = "https://myodfw.com/oregon-sport-fishing-regulations";

// A plain-language glossary. The advisor and water pages link terms here so a
// beginner is never left guessing what a word means.
export const GLOSSARY = {
  troll: "Trolling means slowly dragging a lure or bait behind a moving boat so it swims through the water. Most lake fishing here is trolling.",
  "wedding ring": "A small spinner rig with colored beads and a tiny blade, usually tipped with a piece of white corn or a worm. The classic kokanee and trout troller.",
  kokanee: "A landlocked sockeye salmon that lives its whole life in a lake. Small (11-15 in here), delicious, and caught by trolling flashy little lures. Fights hard for its size.",
  redside: "The wild native rainbow trout of the Deschutes, named for the bright crimson stripe down its side. Strong out of proportion to its size. Almost always released.",
  "bull trout": "A big native char, protected almost everywhere. Lake Billy Chinook is one of the only places in Oregon you can legally keep one (over 24 in). Caught on big lures that look like a smaller fish.",
  "dry fly": "A fly that floats on the surface, imitating an adult insect. When trout are 'rising' (eating bugs off the top), a dry fly is how you catch them.",
  nymph: "A fly fished underwater imitating an immature insect. Trout eat far more underwater than on top, so nymphing catches fish even when nothing is rising.",
  streamer: "A larger fly fished on a sinking line and stripped back to imitate a baitfish or leech. The go-to for big, meat-eating brown trout.",
  "salmonfly hatch": "A once-a-year event (mid-May to early June on the lower Deschutes) when 3-inch stoneflies crawl out and trout gorge on them. The most exciting dry-fly fishing of the year.",
  callibaetis: "A mayfly that hatches on calm lake afternoons in summer. When you see them, tie on a matching dry fly and cast to rising fish.",
  chironomid: "A tiny midge larva. Fished under a bobber, deep and slow, it's one of the deadliest stillwater flies once you learn to trust it.",
  powerbait: "A moldable scented dough you press onto a hook. Floats a worm-and-hook rig off the bottom for stocked trout. The easiest way to catch a planted rainbow.",
  spinner: "A lure with a blade that spins and flashes as you reel it in. Cast it out, reel it back — the simplest lure to fish from the bank.",
  spoon: "A curved metal lure that wobbles and flashes. Great trolled for kokanee and trout.",
  dodger: "A flat blade that doesn't spin but sways, throwing flash ahead of your lure to attract fish. Common in front of a wedding ring for kokanee.",
  "ice-off": "When a high mountain lake's winter ice melts off in spring. The first few weeks after ice-off are often the best fishing of the year.",
};

// month index 0=Jan ... 11=Dec. Values 0-100 = a rough seasonal "how good is it
// usually" curve per water. This drives the bite score before live data adjusts it.
export const WATERS = [
  {
    id: "haystack",
    name: "Haystack Reservoir",
    tagline: "The after-work default",
    type: "reservoir",
    lat: 44.4936, lon: -121.1503,
    driveMin: 18,
    gauge: null,
    regsUrl: ODFW_CENTRAL,
    intro:
      "The closest real fishing to Madras — a high-desert irrigation reservoir under Mt. Jefferson, maybe 15 minutes from town. It's not the most consistent water in Central Oregon, but it's stocked, it's easy, and you can be casting after work. A good place to learn without a big drive.",
    season: { best: "April–June, then October", note: "Best right after spring stocking and again when fall cools the water. Midsummer can go weedy and warm, and the level drops through the growing season for irrigation." },
    stocking: true,
    monthlyBase: [30, 30, 45, 75, 80, 65, 45, 40, 45, 70, 55, 35],
    species: [
      { name: "Rainbow trout", rank: "primary", beginner: true,
        how: "The easy one. Fish a worm-and-<term>powerbait</term> rig off the bottom, or cast a <term>spinner</term> from the bank. From a boat or kayak, <term>troll</term> anything small and shiny slowly along the shoreline.",
        gear: "A basic spinning rod, 6 lb line, a few #8 hooks, a small weight, a jar of PowerBait, and a pack of size-2 spinners. Under $40 all in.",
        when: "Best in the weeks right after the April/May stockings, and again in fall." },
      { name: "Black crappie & panfish", rank: "secondary", beginner: true,
        how: "Fish a small jig or a worm under a bobber near the dam and around any structure. Crappie school up — catch one and there are usually more right there.",
        gear: "Same spinning rod, a bobber, and a few small jigs or a container of worms.",
        when: "Late spring into summer, evenings especially." },
      { name: "Smallmouth & largemouth bass", rank: "secondary", beginner: false,
        how: "Cast soft-plastic baits or crankbaits around rocks and the shallower flats. More of a summer game once the water warms.",
        gear: "Spinning rod, some soft-plastic worms/grubs, a couple of crankbaits.",
        when: "Warm months, midday sun." },
    ],
    access: [
      "Boat ramp and campground on the reservoir (Crooked River National Grassland).",
      "Plenty of bank fishing near the dam and around the inlet — no boat needed.",
    ],
    local: [
      "Water level swings a lot late in summer for irrigation; it can be low and weedy by August.",
      "Views of Mt. Jefferson make it a nice trip even on a slow day.",
      "Electric-friendly small water — a kayak or float tube opens up a lot more of it.",
    ],
    regsNotes: [
      "Kokanee are present but the limit and rules differ from trout — always confirm current rules before you keep fish.",
    ],
  },
  {
    id: "billy-chinook",
    name: "Lake Billy Chinook",
    tagline: "Kokanee, bass, and a legal bull trout",
    type: "reservoir",
    lat: 44.5745, lon: -121.2760,
    driveMin: 30,
    gauge: "14087400", // Crooked R below Opal Springs feeds the Crooked arm
    gaugeLabel: "Crooked River inflow (Opal Springs)",
    regsUrl: ODFW_CENTRAL,
    intro:
      "A huge canyon reservoir where the Deschutes, Crooked, and Metolius rivers meet, about half an hour out. Three long 'arms', each fishes a little differently. It's one of the only places in Oregon you can legally keep a bull trout, it's loaded with easy-to-catch smallmouth bass, and it's a top kokanee lake. Great variety for a beginner.",
    season: { best: "Spring through fall (kokanee best May–Sept; bass all summer)", note: "Bull trout fishing is best in spring after the Metolius arm opens. Kokanee run through the warm months. Bass are easy all summer." },
    stocking: false,
    monthlyBase: [35, 35, 55, 70, 80, 82, 78, 75, 72, 60, 45, 35],
    species: [
      { name: "Kokanee", rank: "primary", beginner: true,
        how: "<term>Troll</term> a <term>wedding ring</term> tipped with white corn behind a small <term>dodger</term>, down 20-40 ft. Find the school on a fish finder and stay on that depth. They school tight, so when you get one, circle back through the same spot.",
        gear: "A trolling setup helps here: a rod, a small dodger, wedding rings (pink/red), and a can of white shoepeg corn. A fish finder is a big help.",
        when: "May through September." },
      { name: "Smallmouth bass", rank: "primary", beginner: true,
        how: "The easiest fish in the lake. Cast soft-plastic grubs or small crankbaits around the bridges and rocky banks of the Deschutes and Crooked arms. You'll catch numbers.",
        gear: "Spinning rod, a bag of soft-plastic grubs on jig heads, a couple of crankbaits. Cheap and effective.",
        when: "All summer, all day." },
      { name: "Bull trout", rank: "signature", beginner: false,
        how: "This is the trophy. <term>Troll</term> big crankbaits that look like a smaller fish, deep, mostly in the cooler Metolius arm in spring. A patience game.",
        gear: "Heavier trolling rod, large diving crankbaits, and — importantly — a tribal permit for the Metolius arm (see rules).",
        when: "Spring, after the Metolius arm opens (around March 1)." },
      { name: "Rainbow & brown trout", rank: "secondary", beginner: true,
        how: "Troll a worm behind a small spinner, or a small spoon, in the Deschutes arm. A nice bycatch while you're after kokanee.",
        gear: "Same trolling gear as kokanee; add a few worms and small spoons.",
        when: "Spring and fall." },
    ],
    access: [
      "Cove Palisades State Park has the main ramps and marina on the Deschutes and Crooked arms.",
      "Perry South Campground ramp for the Metolius arm (gravel road near the end).",
      "Shore fishing near the dam and around the marinas.",
    ],
    local: [
      "The three arms look alike from the water — note which one you're on so your buddy at the ramp finds you.",
      "It gets windy fast in the canyon; morning is usually calmest.",
      "The Metolius arm is the coldest, best bull-trout water — but it's Warm Springs tribal land.",
    ],
    regsNotes: [
      "Bull trout: only ONE may be kept and it must be at least 24 inches — everything else goes back unharmed. Rules change here often; read them fresh.",
      "The Metolius arm is on the Warm Springs Reservation: it requires a separate TRIBAL permit and has its own season (roughly March–October). Don't fish it without that permit.",
      "Rainbows over 20 in and kokanee over 16 in must be released here.",
    ],
  },
  {
    id: "lower-deschutes",
    name: "Lower Deschutes",
    tagline: "Wild redsides & summer steelhead",
    type: "river",
    lat: 44.7490, lon: -121.2560, // Warm Springs / Trout Creek area
    driveMin: 35,
    gauge: "14092500",
    gaugeLabel: "Deschutes near Madras",
    idealFlow: [1800, 4500], // rough fishable/wadeable window, cfs
    regsUrl: "https://myodfw.com/deschutes-river-mouth-pelton-dam-fishing",
    intro:
      "Oregon's most famous trout and steelhead river, running through a basalt canyon about 35 minutes from town. This is fly-fishing water — its wild 'redside' rainbows are strong beyond their size and rise eagerly to dry flies. It's the hardest of your waters to start on, but it's a bucket-list river in your backyard. Bank/wade fishing only — you cannot fish from a boat here.",
    season: { best: "Salmonflies mid-May–early June; caddis evenings all summer; steelhead late summer–fall", note: "The salmonfly hatch in late spring is the marquee event. Summer means evening caddis. Steelhead show up from July and build through the fall." },
    stocking: false,
    monthlyBase: [45, 45, 55, 70, 88, 85, 70, 72, 80, 78, 60, 50],
    species: [
      { name: "Redside rainbow trout", rank: "signature", beginner: false,
        how: "During the <term>salmonfly hatch</term> (mid-May to early June), fish a big foam <term>dry fly</term> tight to the banks — the takes are explosive. The rest of summer, fish a <term>nymph</term> under an indicator through riffles by day and a caddis <term>dry fly</term> in the evening. Wade carefully and fish the seams behind boulders.",
        gear: "A 9 ft 5-weight fly rod, floating line, 9 ft leaders, and a fly box with salmonfly dries, elk-hair caddis, and a few stonefly nymphs. Felt or rubber wading boots.",
        when: "Salmonflies mid-May to early June; caddis evenings June–August." },
      { name: "Summer steelhead", rank: "primary", beginner: false,
        how: "The classic method is 'swinging' a fly on a two-handed rod through steelhead runs — cast across, let it swing, take a step, repeat. It's a patient, meditative game measured in days, not fish.",
        gear: "A step up in gear (a switch or spey rod). Best learned with a guide or an experienced friend the first time.",
        when: "July through December; fall is prime." },
    ],
    access: [
      "Warm Springs boat ramp down to Trout Creek Campground is a popular ~10-mile wade-and-camp stretch (walk-in from the bank).",
      "Wade access near Maupin (farther downstream) along the access road — simplest place to start.",
      "You may float the river to reach spots, but you must get OUT of the boat to fish.",
    ],
    local: [
      "No fishing from a boat — this trips up newcomers. Beach the boat, then fish.",
      "The salmonfly hatch moves upstream over several weeks; a fly shop will tell you where it is right now.",
      "Rattlesnakes and poison oak in the canyon in warm months — watch your step.",
    ],
    regsNotes: [
      "NO BAIT on the entire lower river — artificial flies and lures only (soft-plastic worms count as bait here).",
      "Nearly everyone releases the wild redsides; wild steelhead MUST be released.",
      "There are seasonal closures on certain stretches (e.g. around Sherars Falls) — check the official page before you go.",
    ],
  },
  {
    id: "middle-deschutes",
    name: "Middle Deschutes",
    tagline: "Canyon trout, quiet and close",
    type: "river",
    lat: 44.3140, lon: -121.2960, // Steelhead Falls / Lower Bridge
    driveMin: 42,
    gauge: "14076500",
    gaugeLabel: "Deschutes near Culver",
    idealFlow: [250, 900],
    regsUrl: ODFW_CENTRAL,
    intro:
      "The stretch above Lake Billy Chinook — Steelhead Falls and Lower Bridge near Terrebonne, about 40 minutes out. Smaller and quieter than the famous lower river, with wild redsides and some big brown trout. The catch: irrigation pulls the flow way down from spring through summer, so it fishes best in the cooler months.",
    season: { best: "Winter and early spring (before irrigation draws the water down)", note: "Late fall through early spring is the window, when flows come back up and hatches are good. Late spring through summer the river is low and tough." },
    stocking: false,
    monthlyBase: [70, 75, 78, 55, 40, 30, 25, 25, 35, 60, 72, 72],
    species: [
      { name: "Redside rainbow trout", rank: "primary", beginner: false,
        how: "Fish <term>nymph</term>s under an indicator through the pocket water and pools, and watch for fish rising to blue-winged olive mayflies on cloudy winter afternoons. Cover water — the fish hold in the deeper pockets.",
        gear: "A 9 ft 5-weight fly rod, nymphs (stonefly and mayfly patterns), a few small dries.",
        when: "October through April." },
      { name: "Brown trout", rank: "secondary", beginner: false,
        how: "The bigger, warier fish. Strip a <term>streamer</term> through deeper runs, especially low light. Fewer but larger than the rainbows.",
        gear: "Same rod with a sink-tip line and a few streamers (woolly buggers, sculpin patterns).",
        when: "Fall and early spring, dawn and dusk." },
    ],
    access: [
      "Steelhead Falls trailhead (near Crooked River Ranch) — a short hike to canyon water.",
      "Lower Bridge day-use area near Terrebonne.",
      "Cline Falls and Tumalo state parks farther upstream.",
    ],
    local: [
      "Flows drop hard once irrigation season starts (~mid-April) — check the gauge before driving.",
      "Protected bull trout live below Big Falls; if you hook one, release it unharmed.",
      "The canyon is beautiful and rarely crowded compared to the lower river.",
    ],
    regsNotes: [
      "Artificial flies and lures only on most of this reach — confirm the current rules for the exact section you fish.",
      "Release any bull trout immediately; they're federally protected.",
    ],
  },
  {
    id: "crane-prairie",
    name: "Crane Prairie",
    tagline: "Trophy 'cranebow' rainbows",
    type: "reservoir",
    lat: 43.7860, lon: -121.7720,
    driveMin: 110,
    gauge: null,
    regsUrl: ODFW_CENTRAL,
    intro:
      "The flagship Cascade Lake — a shallow, food-rich reservoir past Bend (about 1¾ hours) famous for fat rainbow trout locals call 'cranebows.' A destination trip, not an after-work run, but the fish are big and it's beginner-friendly if you have a boat or float tube. Sits high, so it fishes from ice-off in spring through fall.",
    season: { best: "Late spring through fall (best after ice-off and again in fall)", note: "High-elevation lake: it's frozen or snowed-in early in the year. Fishing turns on after ice-off (typically May) and stays good into October." },
    stocking: true,
    monthlyBase: [10, 10, 15, 35, 75, 85, 80, 78, 82, 75, 40, 15],
    species: [
      { name: "Rainbow trout ('cranebows')", rank: "signature", beginner: true,
        how: "<term>Troll</term> a worm behind a small spinner, or cast and retrieve a <term>spinner</term> along the old river channels. Fly anglers do very well fishing <term>chironomid</term>s deep under an indicator, or <term>callibaetis</term> dries on calm afternoons.",
        gear: "Spinning: rod, spinners, worms. Fly: 5-weight, an indicator, chironomids and callibaetis patterns. A boat, pontoon, or float tube really helps.",
        when: "Ice-off (May) through October." },
      { name: "Kokanee", rank: "secondary", beginner: true,
        how: "<term>Troll</term> small <term>spoon</term>s or hoochies through the river channels where they school. A fun second target while you're after trout.",
        gear: "Trolling gear, small spoons/spinners, a fish finder to find the schools.",
        when: "Summer." },
      { name: "Largemouth bass", rank: "secondary", beginner: false,
        how: "Yes, bass in an alpine reservoir. Work soft plastics around the flooded timber and weed edges in summer.",
        gear: "Spinning rod, soft plastics.",
        when: "Warm summer days." },
    ],
    access: [
      "Crane Prairie Resort has a ramp, moorage, and basic supplies.",
      "Several Forest Service ramps and campgrounds (Quinn River, Rock Creek).",
      "Shallow and stumpy — a boat or float tube is close to essential; motor carefully.",
    ],
    local: [
      "Full of standing timber and stumps just under the surface — go slow, watch your prop.",
      "Wind can build in the afternoon; mornings are calmest and often best.",
      "Check that the access roads are clear of snow early in the season.",
    ],
    regsNotes: [
      "Trout here run large — some sections have had size or gear rules over the years, so confirm current rules.",
    ],
  },
  {
    id: "wickiup",
    name: "Wickiup Reservoir",
    tagline: "Giant browns & easy kokanee",
    type: "reservoir",
    lat: 43.6870, lon: -121.6910,
    driveMin: 120,
    gauge: null,
    regsUrl: ODFW_CENTRAL,
    intro:
      "Just south of Crane Prairie (about 2 hours), a big reservoir known for two things: fast, easy kokanee fishing, and genuinely huge brown trout — this is a place where a 10-pound-plus fish is a real possibility. A destination trip with a trophy ceiling. One catch: it's an irrigation reservoir that can be drawn down hard by late summer.",
    season: { best: "Kokanee early–mid summer; trophy browns spring and fall", note: "Kokanee fish well from early summer. The big browns are most catchable in spring and again in fall. Water level drops through summer, so check it before a long drive." },
    stocking: true,
    monthlyBase: [10, 10, 15, 40, 70, 82, 80, 65, 60, 70, 35, 12],
    species: [
      { name: "Kokanee", rank: "primary", beginner: true,
        how: "<term>Troll</term> a <term>wedding ring</term> or small <term>spoon</term> behind a <term>dodger</term> at the depth the schools are holding — a fish finder tells you where. Easy, fast fishing once you're on them.",
        gear: "Trolling rod, dodgers, wedding rings/spoons, white corn, fish finder.",
        when: "Early to mid summer." },
      { name: "Brown trout", rank: "signature", beginner: false,
        how: "The trophy. Strip big <term>streamer</term>s (zonkers, woolly buggers) on a fast-sinking line from a boat — a physical, active way to fish. Or troll large minnow-style plugs. These are big, smart, ambush fish.",
        gear: "A stout rod (7-weight fly or a trolling rod), fast-sinking line, big streamers or large Rapala-style plugs.",
        when: "Spring and fall, low light." },
      { name: "Rainbow trout", rank: "secondary", beginner: true,
        how: "<term>Troll</term> or cast <term>spinner</term>s and worms — a reliable, easier target alongside the kokanee.",
        gear: "Spinning rod, spinners, worms.",
        when: "Spring through fall." },
    ],
    access: [
      "Several Forest Service ramps and campgrounds around the reservoir.",
      "Best fished from a boat given its size; bank access is limited.",
    ],
    local: [
      "Drawn down for irrigation — by late summer ramps can be high and dry. Check the level first.",
      "Big, open water: watch the weather and wind.",
      "The brown-trout reputation is real but they're not easy — it's a numbers-down, size-up game.",
    ],
    regsNotes: [
      "Brown trout often have no size/number limit here (they're not native) — but always confirm current rules.",
    ],
  },
  {
    id: "east-lake",
    name: "East Lake",
    tagline: "Clear caldera lake, big variety",
    type: "reservoir",
    lat: 43.7250, lon: -121.2100,
    driveMin: 105,
    gauge: null,
    regsUrl: ODFW_CENTRAL,
    intro:
      "A clear, cold lake inside the Newberry Volcano caldera, about 1¾ hours past Bend (sits at ~6,400 ft, so it opens late and closes early). No inlet or outlet — just spring- and snow-fed water — which makes it exceptionally clear. Stuffed with variety: rainbows, big browns, kokanee, and even Atlantic salmon. Its twin, Paulina Lake, is right next door if one is slow.",
    season: { best: "Late spring through early fall", note: "High and cold: the road and lake open around late spring and the season closes in fall. Early season right after opening is often excellent, and it stays good through summer." },
    stocking: true,
    monthlyBase: [0, 0, 0, 15, 70, 85, 82, 80, 78, 55, 10, 0],
    species: [
      { name: "Rainbow trout", rank: "primary", beginner: true,
        how: "<term>Troll</term> a <term>spinner</term> and worm or a small <term>spoon</term>, or fish PowerBait off the bottom from shore. Recent reports have rainbows running a healthy 16-18 inches.",
        gear: "Spinning rod, spinners, spoons, worms, PowerBait.",
        when: "Opening (late spring) through fall." },
      { name: "Brown trout", rank: "signature", beginner: false,
        how: "Trophy browns over 24 inches are caught here. Troll large plugs or strip <term>streamer</term>s along the drop-offs, low light.",
        gear: "Stouter rod, large plugs or big streamers on a sinking line.",
        when: "Early season and fall." },
      { name: "Kokanee", rank: "primary", beginner: true,
        how: "<term>Troll</term> a <term>wedding ring</term> behind a <term>dodger</term> at the schooling depth. East Lake kokanee have run 13-15 inches — big for the region.",
        gear: "Trolling gear, dodgers, wedding rings, corn, fish finder.",
        when: "Summer." },
      { name: "Atlantic salmon", rank: "secondary", beginner: true,
        how: "A quirky bonus species stocked here — caught the same ways as the trout, trolling or from the bank. A fun one to check off.",
        gear: "Same as trout.",
        when: "Summer." },
    ],
    access: [
      "East Lake Resort and Forest Service campgrounds ring the lake, with ramps.",
      "Good bank access at the day-use areas and campgrounds.",
      "Natural hot springs bubble up along parts of the shore — a nice mid-trip soak.",
    ],
    local: [
      "High elevation: snow can linger and the road opens late — confirm it's accessible in spring.",
      "Water is gin-clear, so fish can be spooky in bright sun; early and late are best.",
      "Paulina Lake next door fishes similarly — if East is slow, it's a two-minute drive to plan B.",
    ],
    regsNotes: [
      "Multiple species with different rules (trout vs kokanee vs salmon) — check the current limits before keeping fish.",
    ],
  },
];

export const WATER_BY_ID = Object.fromEntries(WATERS.map((w) => [w.id, w]));
