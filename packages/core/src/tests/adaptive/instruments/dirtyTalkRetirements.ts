import type { BankRetirements } from '../bank';

/**
 * 74 §3.6.25 — pet names retired INTO another name, and where each one's marks go.
 *
 * Generated from the 2026-08-19 purge and then frozen: 184 of these are a name and its own possessive
 * ("love" / "my love"), which the owner cut because the "my" decides nothing and doubled the taps; the
 * last is `papi`, which sat in two registers meaning the same thing in both and so could hold a love in
 * one and a hard no in the other. In every case the survivor says what the retired one said, so a mark
 * on the retired key MOVES to it rather than dying with the word.
 *
 * A name cut with nowhere to move to — "my paperweight", the animal-sex names — is NOT listed here. Those
 * are derived: an entry whose family belongs to this bank but whose key no longer does was retired
 * outright, which needs no list and cannot go stale.
 *
 * Frozen on purpose. A later purge adds rows; it never rewrites these, or a mark migrated once would move
 * again to somewhere its owner never chose.
 */
export const DIRTY_TALK_NAME_RETIREMENTS: BankRetirements = {
  // 74 §3.6.29 — `names-playful` was down to these two after the four purges, which renders as an almost
  // empty register card. They move into `names-rough-mild`, where the register actually reads, and their
  // marks move with them rather than dying with the family.
  'names-playful:freak': 'names-rough-mild:freak',
  'names-playful:my-little-freak': 'names-rough-mild:my-little-freak',
  'names-breeding:my-broodmare': 'names-breeding:broodmare',
  'names-feminising:my-beauty-queen': 'names-feminising:beauty-queen',
  'names-feminising:my-little-lady': 'names-feminising:little-lady',
  'names-feminising:my-sissy': 'names-feminising:sissy',
  'names-feminising:my-sissy-doll': 'names-feminising:sissy-doll',
  'names-feminising:my-sissy-maid': 'names-feminising:sissy-maid',
  'names-hard-power:my-captain': 'names-hard-power:captain',
  'names-hard-power:my-daddy': 'names-hard-power:daddy',
  'names-hard-power:my-dominatrix': 'names-hard-power:dominatrix',
  'names-hard-power:my-goddess': 'names-hard-power:goddess',
  'names-hard-power:my-king': 'names-hard-power:king',
  'names-hard-power:my-ma-am': 'names-hard-power:ma-am',
  'names-hard-power:my-madam': 'names-hard-power:madam',
  'names-hard-power:my-master': 'names-hard-power:master',
  'names-hard-power:my-mistress': 'names-hard-power:mistress',
  'names-hard-power:my-mommy': 'names-hard-power:mommy',
  'names-hard-power:my-owner': 'names-hard-power:owner',
  'names-hard-power:my-queen': 'names-hard-power:queen',
  'names-hard-power:my-sir': 'names-hard-power:sir',
  'names-innocence:my-innocent-girl': 'names-innocence:innocent-girl',
  'names-masculine:my-animal': 'names-masculine:animal',
  'names-masculine:my-bear': 'names-masculine:bear',
  'names-masculine:my-beast': 'names-masculine:beast',
  'names-masculine:my-big-daddy': 'names-masculine:big-daddy',
  'names-masculine:my-big-guy': 'names-masculine:big-guy',
  'names-masculine:my-big-man': 'names-masculine:big-man',
  'names-masculine:my-brute': 'names-masculine:brute',
  'names-masculine:my-cowboy': 'names-masculine:cowboy',
  'names-masculine:my-giant': 'names-masculine:giant',
  'names-masculine:my-grizzly': 'names-masculine:grizzly',
  'names-masculine:my-hero': 'names-masculine:hero',
  'names-masculine:my-knight': 'names-masculine:knight',
  'names-masculine:my-lion': 'names-masculine:lion',
  'names-masculine:my-monster': 'names-masculine:monster',
  'names-masculine:my-papa-bear': 'names-masculine:papa-bear',
  'names-masculine:my-rogue': 'names-masculine:rogue',
  'names-masculine:my-soldier': 'names-masculine:soldier',
  'names-masculine:my-stud': 'names-masculine:stud',
  'names-masculine:my-tank': 'names-masculine:tank',
  'names-masculine:my-titan': 'names-masculine:titan',
  'names-masculine:my-viking': 'names-masculine:viking',
  'names-masculine:my-warrior': 'names-masculine:warrior',
  'names-masculine:my-wolf': 'names-masculine:wolf',
  'names-masculine:papi': 'names-other-tongues:papi',
  'names-object:my-cumdump': 'names-object:cumdump',
  'names-object:my-cumrag': 'names-object:cumrag',
  'names-object:my-doormat': 'names-object:doormat',
  'names-object:my-fucktoy': 'names-object:fucktoy',
  'names-object:my-hole': 'names-object:hole',
  'names-petplay:my-bad-dog': 'names-petplay:bad-dog',
  'names-petplay:my-cat': 'names-petplay:cat',
  'names-petplay:my-good-dog': 'names-petplay:good-dog',
  'names-petplay:my-hound': 'names-petplay:hound',
  'names-petplay:my-mutt': 'names-petplay:mutt',
  'names-petplay:my-piggy': 'names-petplay:piggy',
  'names-petplay:my-pony': 'names-petplay:pony',
  'names-petplay:my-pony-girl': 'names-petplay:pony-girl',
  'names-petplay:my-pup-boy': 'names-petplay:pup-boy',
  'names-petplay:my-puss': 'names-petplay:puss',
  'names-petplay:my-pussycat': 'names-petplay:pussycat',
  'names-petplay:my-rabbit': 'names-petplay:rabbit',
  'names-petplay:my-stray': 'names-petplay:stray',
  'names-playful:my-freak': 'names-playful:freak',
  'names-praise:my-golden-boy': 'names-praise:golden-boy',
  'names-praise:my-golden-girl': 'names-praise:golden-girl',
  'names-praise:my-good-boy': 'names-praise:good-boy',
  'names-praise:my-good-girl': 'names-praise:good-girl',
  'names-roleplay:my-headmaster': 'names-roleplay:headmaster',
  'names-roleplay:my-sensei': 'names-roleplay:sensei',
  'names-rough-heavy:my-bimbo': 'names-rough-heavy:bimbo',
  'names-rough-heavy:my-bitch': 'names-rough-heavy:bitch',
  'names-rough-heavy:my-brainless-slut': 'names-rough-heavy:brainless-slut',
  'names-rough-heavy:my-cocksucker': 'names-rough-heavy:cocksucker',
  'names-rough-heavy:my-cum-dumpster': 'names-rough-heavy:cum-dumpster',
  'names-rough-heavy:my-depraved-slut': 'names-rough-heavy:depraved-slut',
  'names-rough-heavy:my-dick-sucker': 'names-rough-heavy:dick-sucker',
  'names-rough-heavy:my-fuck-puppet': 'names-rough-heavy:fuck-puppet',
  'names-rough-heavy:my-fucking-slut': 'names-rough-heavy:fucking-slut',
  'names-rough-heavy:my-fuckpig': 'names-rough-heavy:fuckpig',
  'names-rough-heavy:my-insatiable-slut': 'names-rough-heavy:insatiable-slut',
  'names-rough-heavy:my-little-whore': 'names-rough-heavy:little-whore',
  'names-rough-heavy:my-manwhore': 'names-rough-heavy:manwhore',
  'names-rough-heavy:my-nasty-girl': 'names-rough-heavy:nasty-girl',
  'names-rough-heavy:my-sex-slave': 'names-rough-heavy:sex-slave',
  'names-rough-heavy:my-skank': 'names-rough-heavy:skank',
  'names-rough-heavy:my-slag': 'names-rough-heavy:slag',
  'names-rough-heavy:my-slut': 'names-rough-heavy:slut',
  'names-rough-heavy:my-whore': 'names-rough-heavy:whore',
  'names-rough-mild:my-bad-boy': 'names-rough-mild:bad-boy',
  'names-rough-mild:my-bad-girl': 'names-rough-mild:bad-girl',
  'names-rough-mild:my-easy-girl': 'names-rough-mild:easy-girl',
  'names-rough-mild:my-firecracker': 'names-rough-mild:firecracker',
  'names-rough-mild:my-flirt': 'names-rough-mild:flirt',
  'names-rough-mild:my-harlot': 'names-rough-mild:harlot',
  'names-rough-mild:my-hellcat': 'names-rough-mild:hellcat',
  'names-rough-mild:my-hellion': 'names-rough-mild:hellion',
  'names-rough-mild:my-hussy': 'names-rough-mild:hussy',
  'names-rough-mild:my-little-sinner': 'names-rough-mild:little-sinner',
  'names-rough-mild:my-little-sneak': 'names-rough-mild:little-sneak',
  'names-rough-mild:my-minx': 'names-rough-mild:minx',
  'names-rough-mild:my-naughty-boy': 'names-rough-mild:naughty-boy',
  'names-rough-mild:my-rebel': 'names-rough-mild:rebel',
  'names-rough-mild:my-siren': 'names-rough-mild:siren',
  'names-rough-mild:my-sneaky-thing': 'names-rough-mild:sneaky-thing',
  'names-rough-mild:my-spitfire': 'names-rough-mild:spitfire',
  'names-rough-mild:my-temptress': 'names-rough-mild:temptress',
  'names-rough-mild:my-tramp': 'names-rough-mild:tramp',
  'names-rough-mild:my-wayward-girl': 'names-rough-mild:wayward-girl',
  'names-rough-mild:my-wild-thing': 'names-rough-mild:wild-thing',
  'names-rough-mild:my-wildcat': 'names-rough-mild:wildcat',
  'names-service:my-servant': 'names-service:servant',
  'names-service:my-slave': 'names-service:slave',
  'names-service:my-submissive': 'names-service:submissive',
  'names-sharing:my-beta': 'names-sharing:beta',
  'names-sharing:my-cuck': 'names-sharing:cuck',
  'names-sharing:my-cuckquean': 'names-sharing:cuckquean',
  'names-soft-power:my-baby-girl': 'names-soft-power:baby-girl',
  'names-soft-power:my-brat': 'names-soft-power:brat',
  'names-soft-power:my-bunny': 'names-soft-power:bunny',
  'names-soft-power:my-bunny-girl': 'names-soft-power:bunny-girl',
  'names-soft-power:my-cub': 'names-soft-power:cub',
  'names-soft-power:my-doll': 'names-soft-power:doll',
  'names-soft-power:my-kitten': 'names-soft-power:kitten',
  'names-soft-power:my-kitty': 'names-soft-power:kitty',
  'names-soft-power:my-lamb': 'names-soft-power:lamb',
  'names-soft-power:my-little-angel': 'names-soft-power:little-angel',
  'names-soft-power:my-little-miss': 'names-soft-power:little-miss',
  'names-soft-power:my-little-prince': 'names-soft-power:little-prince',
  'names-soft-power:my-little-thing': 'names-soft-power:little-thing',
  'names-soft-power:my-mouse': 'names-soft-power:mouse',
  'names-soft-power:my-pet': 'names-soft-power:pet',
  'names-soft-power:my-pillow-princess': 'names-soft-power:pillow-princess',
  'names-soft-power:my-pretty-pet': 'names-soft-power:pretty-pet',
  'names-soft-power:my-princess': 'names-soft-power:princess',
  'names-soft-power:my-puppy': 'names-soft-power:puppy',
  'names-soft-power:my-sweet-baby': 'names-soft-power:sweet-baby',
  'names-soft-power:my-tiny-thing': 'names-soft-power:tiny-thing',
  'names-warm:my-angel': 'names-warm:angel',
  'names-warm:my-angel-baby': 'names-warm:angel-baby',
  'names-warm:my-beloved': 'names-warm:beloved',
  'names-warm:my-boo': 'names-warm:boo',
  'names-warm:my-darling': 'names-warm:darling',
  'names-warm:my-dear': 'names-warm:dear',
  'names-warm:my-dearest': 'names-warm:dearest',
  'names-warm:my-gem': 'names-warm:gem',
  'names-warm:my-jewel': 'names-warm:jewel',
  'names-warm:my-love': 'names-warm:love',
  'names-warm:my-lovely': 'names-warm:lovely',
  'names-warm:my-peach': 'names-warm:peach',
  'names-warm:my-precious-one': 'names-warm:precious-one',
  'names-warm:my-sugar': 'names-warm:sugar',
  'names-warm:my-sweet-love': 'names-warm:sweet-love',
  'names-warm:my-sweet-thing': 'names-warm:sweet-thing',
  'names-warm:my-sweetest': 'names-warm:sweetest',
  'names-worthless:my-bug': 'names-worthless:bug',
  'names-worthless:my-dog': 'names-worthless:dog',
  'names-worthless:my-failure': 'names-worthless:failure',
  'names-worthless:my-insect': 'names-worthless:insect',
  'names-worthless:my-leech': 'names-worthless:leech',
  'names-worthless:my-little-nothing': 'names-worthless:little-nothing',
  'names-worthless:my-loser': 'names-worthless:loser',
  'names-worthless:my-maggot': 'names-worthless:maggot',
  'names-worthless:my-mongrel': 'names-worthless:mongrel',
  'names-worthless:my-nobody': 'names-worthless:nobody',
  'names-worthless:my-parasite': 'names-worthless:parasite',
  'names-worthless:my-peasant': 'names-worthless:peasant',
  'names-worthless:my-reject': 'names-worthless:reject',
  'names-worthless:my-roach': 'names-worthless:roach',
  'names-worthless:my-scum': 'names-worthless:scum',
  'names-worthless:my-slug': 'names-worthless:slug',
  'names-worthless:my-trash': 'names-worthless:trash',
  'names-worthless:my-worm': 'names-worthless:worm',
  'names-worthless:my-wretch': 'names-worthless:wretch',
  'names-yours:my-husband': 'names-yours:husband',
  'names-yours:my-wife': 'names-yours:wife',
  'names-yours:my-wifey': 'names-yours:wifey',
};

/**
 * 74 §3.6.27 — whole REGISTERS the owner cut, and every mark in them goes.
 *
 * `names-kinship` was family terms as pre-agreed roleplay (sis, bro, step-mom, daddy's girl) and
 * `names-agegap` was the age-gap register (sugar daddy, milf, dilf, cougar). Both removed at the owner's
 * request, 2026-08-19. `daddy` and `mommy` STAY: they live in `names-hard-power` as D/s authority terms
 * alongside `my daddy dom`, which is a different register that happens to share a word.
 *
 * Listed rather than derived, because a family that has left the bank cannot be derived FROM the bank — the
 * §3.6.25 rule ("family still here, key gone") stops matching the moment the family goes, and the marks would
 * then outlive every screen that could change them.
 */
export const DIRTY_TALK_RETIRED_FAMILIES: readonly string[] = [
  'names-kinship',
  'names-agegap',
  // 74 §3.6.29 — down to two entries after the four purges. Its survivors moved into `names-rough-mild`
  // (see the mapping above), so a mark on either one migrates rather than being retired outright.
  'names-playful',
  /*
   * 74 §3.6.30 — retired whole, at the owner's direction, under the tightened criterion.
   *
   * The register was ADDED to fill a measured "the bank has essentially none of this" gap and was then
   * filled with ADMIRATION — handsome, hero, knight, warrior, soldier, my pilot, my trucker — which is
   * exactly the class the owner named: sayable in bed, but about character or occupation rather than sex.
   *
   * Retired rather than pruned to its 12 rough survivors (stud, beast, brute, caveman…), which was his call
   * made with the measurement in hand: those 12 exist in no other family, so this DOES remove that
   * vocabulary from the app. Nobody holds a mark in the register, so no answer is lost — only the words.
   *
   * The ~20 `names-masculine:my-X → names-masculine:X` rows above are now inert and stay, per the frozen
   * rule: `retireCutMarks` resolves a migration target that is no longer a live entry to `undefined` and
   * retires the mark outright, which is the right answer once the whole register has gone.
   */
  'names-masculine',
  /*
   * 74 §3.6.33 — retired whole at the owner's request, 2026-08-20.
   *
   * The breeding register (36 entries, tiers 4-5). Its one migration row
   * (`names-breeding:my-broodmare → names-breeding:broodmare`) was already inert after §3.6.32 cut the
   * target, and stays, per the frozen rule: a target that is no longer a live entry resolves to `undefined`
   * and the mark is retired outright rather than moved somewhere no screen can reach.
   */
  'names-breeding',
];
