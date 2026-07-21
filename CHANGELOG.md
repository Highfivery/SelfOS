# Changelog

## [0.43.1](https://github.com/Highfivery/SelfOS/compare/v0.43.0...v0.43.1) (2026-07-21)


### Bug Fixes

* **together:** don't force-navigate back to a session when its turn resolves after switching ([#308](https://github.com/Highfivery/SelfOS/issues/308)) ([2a7ef93](https://github.com/Highfivery/SelfOS/commit/2a7ef93163c970fe6bb78f1fc8700d875ed21ef9))

## [0.43.0](https://github.com/Highfivery/SelfOS/compare/v0.42.0...v0.43.0) (2026-07-21)


### Features

* **story:** resume unfinished memories + a history list ([e05ee32](https://github.com/Highfivery/SelfOS/commit/e05ee32c60c320dafe88334c9c3ad1cc40823e83))

## [0.42.0](https://github.com/Highfivery/SelfOS/compare/v0.41.1...v0.42.0) (2026-07-21)


### Features

* **story:** share a memory — the biographer interview chat ([b7451c3](https://github.com/Highfivery/SelfOS/commit/b7451c34e3797db34669588379276044f5809b8b))


### Bug Fixes

* **story:** interview-loop coherence + answer-the-author ([#286](https://github.com/Highfivery/SelfOS/issues/286)) ([9ea26ed](https://github.com/Highfivery/SelfOS/commit/9ea26eda8a6e7170a9b7f06dd99fed6ca3d2c60e))
* **story:** protect words on every rewrite, truncation handling, and the draft vault ([#284](https://github.com/Highfivery/SelfOS/issues/284)) ([f4d14ae](https://github.com/Highfivery/SelfOS/commit/f4d14ae5484d0f1864515eea489eb9677cc0fbad))

## [0.41.1](https://github.com/Highfivery/SelfOS/compare/v0.41.0...v0.41.1) (2026-07-20)


### Bug Fixes

* **together:** remove the empty space beside the Pulse trend charts ([#282](https://github.com/Highfivery/SelfOS/issues/282)) ([0cb402e](https://github.com/Highfivery/SelfOS/commit/0cb402e955931aedec02a33005b2536b6ceaaa88))

## [0.41.0](https://github.com/Highfivery/SelfOS/compare/v0.40.1...v0.41.0) (2026-07-20)


### Features

* **together:** make the joint-challenge tile actionable and fix the dead-end it pointed at ([#277](https://github.com/Highfivery/SelfOS/issues/277)) ([d11ed33](https://github.com/Highfivery/SelfOS/commit/d11ed33a5642d1f957f0662c12964c5cda9bfae9))
* **together:** redesign the home into a four-tab surface ([#280](https://github.com/Highfivery/SelfOS/issues/280)) ([2940a84](https://github.com/Highfivery/SelfOS/commit/2940a845182b386a040d7bb20eb31ae934ad0dd8))


### Bug Fixes

* **home:** defer the challenge check-in only when the recommendation is actually rendering ([#279](https://github.com/Highfivery/SelfOS/issues/279)) ([3228aea](https://github.com/Highfivery/SelfOS/commit/3228aea93d8097ace3221423e606df1e419ab14d))
* **together:** only the selected tab references the rendered tabpanel ([#281](https://github.com/Highfivery/SelfOS/issues/281)) ([eadfe5d](https://github.com/Highfivery/SelfOS/commit/eadfe5d92d51ecb58ceb3ab094f21eb52c68d052))

## [0.40.1](https://github.com/Highfivery/SelfOS/compare/v0.40.0...v0.40.1) (2026-07-20)


### Bug Fixes

* **chat:** the auto-continue shipped in 0.40.0 is rejected by the live API ([#275](https://github.com/Highfivery/SelfOS/issues/275)) ([c1fe3da](https://github.com/Highfivery/SelfOS/commit/c1fe3dabb736a68719a8a97dfd471f53594a5a0d))

## [0.40.0](https://github.com/Highfivery/SelfOS/compare/v0.39.7...v0.40.0) (2026-07-20)


### Features

* **chat:** detect truncation, auto-continue, and add rewind across every AI chat surface ([#273](https://github.com/Highfivery/SelfOS/issues/273)) ([b9fc8a8](https://github.com/Highfivery/SelfOS/commit/b9fc8a89dad021abeefb1e48dafb534843efe5ab))

## [0.39.7](https://github.com/Highfivery/SelfOS/compare/v0.39.6...v0.39.7) (2026-07-20)


### Bug Fixes

* **core:** relay first-wins on live status; repair 5 silently-failing E2E tests ([#271](https://github.com/Highfivery/SelfOS/issues/271)) ([2cf05fd](https://github.com/Highfivery/SelfOS/commit/2cf05fd3663b9a263b780788b6e8b2acb22fb0e2))

## [0.39.6](https://github.com/Highfivery/SelfOS/compare/v0.39.5...v0.39.6) (2026-07-20)


### Bug Fixes

* **core:** repair a regression I introduced, plus 4 remaining stale-write sites ([#269](https://github.com/Highfivery/SelfOS/issues/269)) ([47bd23f](https://github.com/Highfivery/SelfOS/commit/47bd23f447ccf11953cdceb2985d842f82d9b554))

## [0.39.5](https://github.com/Highfivery/SelfOS/compare/v0.39.4...v0.39.5) (2026-07-20)


### Bug Fixes

* **core:** finish the stale-write sweep — 8 more live instances ([#267](https://github.com/Highfivery/SelfOS/issues/267)) ([1b6c9b1](https://github.com/Highfivery/SelfOS/commit/1b6c9b1cf0d33f49c77da451b90509d37418c8c9))

## [0.39.4](https://github.com/Highfivery/SelfOS/compare/v0.39.3...v0.39.4) (2026-07-20)


### Bug Fixes

* **core:** sweep the stale-write bug class across every record rebuild ([#265](https://github.com/Highfivery/SelfOS/issues/265)) ([85e0f4f](https://github.com/Highfivery/SelfOS/commit/85e0f4ff2a83f36538f24fa15b4007829da802f3))

## [0.39.3](https://github.com/Highfivery/SelfOS/compare/v0.39.2...v0.39.3) (2026-07-20)


### Bug Fixes

* **dreams:** close the stale-write bug class across all three dream writers ([#263](https://github.com/Highfivery/SelfOS/issues/263)) ([2f57387](https://github.com/Highfivery/SelfOS/commit/2f57387a1ae35af5b578094bf8025cc11426a592))

## [0.39.2](https://github.com/Highfivery/SelfOS/compare/v0.39.1...v0.39.2) (2026-07-20)


### Bug Fixes

* **dreams:** stop a generation clobbering an edit saved while it ran ([#261](https://github.com/Highfivery/SelfOS/issues/261)) ([a898e4c](https://github.com/Highfivery/SelfOS/commit/a898e4c9293e01eebbef48c9e94aa46285776385))

## [0.39.1](https://github.com/Highfivery/SelfOS/compare/v0.39.0...v0.39.1) (2026-07-20)


### Bug Fixes

* **dreams:** guard the dreamSave carry-forward list at compile time ([#258](https://github.com/Highfivery/SelfOS/issues/258)) ([dea3e4a](https://github.com/Highfivery/SelfOS/commit/dea3e4a3222ddbe3ccc469f275774948b866525b))
* **dreams:** keep a generated image when the dream is edited ([#257](https://github.com/Highfivery/SelfOS/issues/257)) ([dbc112e](https://github.com/Highfivery/SelfOS/commit/dbc112ebe1bb88a1eaed914c1e81ea4090a3b941))

## [0.39.0](https://github.com/Highfivery/SelfOS/compare/v0.38.0...v0.39.0) (2026-07-18)


### Features

* **memory:** move insight review to a dedicated /memory/review screen (65) ([4995ef7](https://github.com/Highfivery/SelfOS/commit/4995ef785de4dbc4713d2eaa238f538b3da3f6a7))

## [0.38.0](https://github.com/Highfivery/SelfOS/compare/v0.37.0...v0.38.0) (2026-07-18)


### Features

* **memory:** Questionnaires + Memory review redesign — queue, per-item cards, humanized trends (65) ([2d16b23](https://github.com/Highfivery/SelfOS/commit/2d16b2324091d630fbe10e214630f7dd6c0b6e56))

## [0.37.0](https://github.com/Highfivery/SelfOS/compare/v0.36.0...v0.37.0) (2026-07-17)


### Features

* **auto-checkins:** let a target see + stop check-ins others send them (63 §3.3a) ([#250](https://github.com/Highfivery/SelfOS/issues/250)) ([e9653fb](https://github.com/Highfivery/SelfOS/commit/e9653fbd25ca50be4717b9871da49398f5752c78))

## [0.36.0](https://github.com/Highfivery/SelfOS/compare/v0.35.0...v0.36.0) (2026-07-17)


### Features

* **memory:** context-rich cards, card grid, nav badge & share-with-partner default (62 §13) ([#247](https://github.com/Highfivery/SelfOS/issues/247)) ([2b55b7c](https://github.com/Highfivery/SelfOS/commit/2b55b7c75bf42013f72f18648e053456f6b328eb))
* **story:** close out §13 — answered-history chapter linkage + a shared scrim token (64 §13.6.5) ([#249](https://github.com/Highfivery/SelfOS/issues/249)) ([659a642](https://github.com/Highfivery/SelfOS/commit/659a642f41f6c91605dc9133d6974fb41a4f314e))

## [0.35.0](https://github.com/Highfivery/SelfOS/compare/v0.34.0...v0.35.0) (2026-07-17)


### Features

* **story:** the begin screens — invitation, commission & the writing (64 §13.3 R7) ([#245](https://github.com/Highfivery/SelfOS/issues/245)) ([85dd926](https://github.com/Highfivery/SelfOS/commit/85dd926baaff3907dc3b65c57a8041592d8ad589))


### Bug Fixes

* **questionnaires:** label auto check-in & biographer questionnaires on the Sent card ([#244](https://github.com/Highfivery/SelfOS/issues/244)) ([c4a570f](https://github.com/Highfivery/SelfOS/commit/c4a570f26aca12a1993d21d8400c6b1033a0dab6))

## [0.34.0](https://github.com/Highfivery/SelfOS/compare/v0.33.0...v0.34.0) (2026-07-17)


### Features

* **questionnaires:** answering redesign — per-question skip/decline + unlocked wizard (08 §25) ([#241](https://github.com/Highfivery/SelfOS/issues/241)) ([afc3fd8](https://github.com/Highfivery/SelfOS/commit/afc3fd82b5dcf1600088e2d0c3aca9489b25d7f5))
* **story:** immersive margin-based Shape editing surface (64 §13.5 R3-polish) ([7d91d5c](https://github.com/Highfivery/SelfOS/commit/7d91d5ceaa2040a6d66c726859314a254aeebc47))
* **story:** the Photos gallery + photo-answers→corpus wiring fix (64 §13.6.2 R6) ([#243](https://github.com/Highfivery/SelfOS/issues/243)) ([adcf7a9](https://github.com/Highfivery/SelfOS/commit/adcf7a98a8c353ed26c7f03027133662a0a5e63a))
* **story:** the Studio & the Book — R4 (read receipts, draft export, export dialog) (64 §13.7) ([#237](https://github.com/Highfivery/SelfOS/issues/237)) ([3105743](https://github.com/Highfivery/SelfOS/commit/31057430a27e4d15c082ffd9068f2c47a3b91fb6))
* **story:** the Studio & the Book — R5 (Interview tab: life map, gaps, ask-a-gap) (64 §13.7) ([#240](https://github.com/Highfivery/SelfOS/issues/240)) ([ca0c9d8](https://github.com/Highfivery/SelfOS/commit/ca0c9d8911dd1c68503da7db41f9e8d1e7f70739))


### Bug Fixes

* **questionnaires:** align landing card titles + tighten spacing rhythm ([#235](https://github.com/Highfivery/SelfOS/issues/235)) ([3f486bd](https://github.com/Highfivery/SelfOS/commit/3f486bd6668b9637002d1cf1a5f5235bf6f4d4cf))
* **questionnaires:** float the sorted status group, soften the attention pill, add Received sort ([#242](https://github.com/Highfivery/SelfOS/issues/242)) ([247d20e](https://github.com/Highfivery/SelfOS/commit/247d20e655d659167532f68e9d98f70ec094fd65))

## [0.33.0](https://github.com/Highfivery/SelfOS/compare/v0.32.0...v0.33.0) (2026-07-17)


### Features

* **questionnaires:** tabbed landing + nav badge + spaced toolbar + recently-analyzed sort ([#236](https://github.com/Highfivery/SelfOS/issues/236)) ([f4520f2](https://github.com/Highfivery/SelfOS/commit/f4520f2a0375521bc367c0ce8e5f652670c77845))
* **story:** the Studio & the Book — R1 (Studio IA) redesign (64 §13) ([#231](https://github.com/Highfivery/SelfOS/issues/231)) ([7f391c5](https://github.com/Highfivery/SelfOS/commit/7f391c5de7c78ca508ec7005f5b33a3846956e11))
* **story:** the Studio & the Book — R2 (immersive Book reader) (64 §13.7) ([#233](https://github.com/Highfivery/SelfOS/issues/233)) ([d17ce69](https://github.com/Highfivery/SelfOS/commit/d17ce69191d3f63bd3977ee5cf5ab91e5de5a641))
* **story:** the Studio & the Book — R3 (Shape ribbon, What-changed diff, Read⇄Shape toggle) (64 §13.7) ([#234](https://github.com/Highfivery/SelfOS/issues/234)) ([dc7baed](https://github.com/Highfivery/SelfOS/commit/dc7baed4335914e9f9dbb7aeead078b9493cf665))

## [0.32.0](https://github.com/Highfivery/SelfOS/compare/v0.31.0...v0.32.0) (2026-07-17)


### Features

* **people:** expand relationship types (extended family, in-laws, step & social) ([#229](https://github.com/Highfivery/SelfOS/issues/229)) ([9de916e](https://github.com/Highfivery/SelfOS/commit/9de916ed4af6eeabd5b5f0091719c34f309dd6eb))

## [0.31.0](https://github.com/Highfivery/SelfOS/compare/v0.30.0...v0.31.0) (2026-07-17)


### Features

* **story:** chapters as a cover-backed card grid (approved redesign) ([#227](https://github.com/Highfivery/SelfOS/issues/227)) ([66e09e1](https://github.com/Highfivery/SelfOS/commit/66e09e185d8e93fd39cda842dd6689fc67d83b8c))

## [0.30.0](https://github.com/Highfivery/SelfOS/compare/v0.29.0...v0.30.0) (2026-07-17)


### Features

* **images:** one global image style + fix the story "Illustrate this chapter" dead button ([#224](https://github.com/Highfivery/SelfOS/issues/224)) ([23ade99](https://github.com/Highfivery/SelfOS/commit/23ade99a80f220492b526095d620c25d917cd46e))
* **images:** realtime progress for every AI image + surface the style on the Story page ([#225](https://github.com/Highfivery/SelfOS/issues/225)) ([c7c982c](https://github.com/Highfivery/SelfOS/commit/c7c982c172b1a1f4c3456b8a731ecd7ab551fc4b))
* **story:** a proper Story settings section (writing + story-specific image style) ([#226](https://github.com/Highfivery/SelfOS/issues/226)) ([944a2dd](https://github.com/Highfivery/SelfOS/commit/944a2dd734a09aef3fb777e96f6c8d5e7e18e10d))
* **story:** draft in one flow with a live progress screen (no outline gate) ([#221](https://github.com/Highfivery/SelfOS/issues/221)) ([e175903](https://github.com/Highfivery/SelfOS/commit/e17590364c0ba1f81ac0ea75388f6282ca4069d4))
* **story:** rich real-time progress for writing chapters (inline on the overview) ([#222](https://github.com/Highfivery/SelfOS/issues/222)) ([08d4fed](https://github.com/Highfivery/SelfOS/commit/08d4fed4d2f971e94ea99c163897ea78ddbe11b6))
* **story:** Your Story — AI-written living biography (spec 64) ([#218](https://github.com/Highfivery/SelfOS/issues/218)) ([ac81878](https://github.com/Highfivery/SelfOS/commit/ac818789cb47b970b97c63d984c097e895b9dbfb))

## [0.29.0](https://github.com/Highfivery/SelfOS/compare/v0.28.0...v0.29.0) (2026-07-16)


### Features

* **auto-checkins:** surface via notifications + full E2E matrix (spec 63) ([#216](https://github.com/Highfivery/SelfOS/issues/216)) ([1d62c52](https://github.com/Highfivery/SelfOS/commit/1d62c5262b873e2466c6eb66528baa802f24606e))

## [0.28.0](https://github.com/Highfivery/SelfOS/compare/v0.27.0...v0.28.0) (2026-07-15)


### Features

* **auto-checkins:** autonomous questionnaire generation engine (spec 63) ([#214](https://github.com/Highfivery/SelfOS/issues/214)) ([b8b363e](https://github.com/Highfivery/SelfOS/commit/b8b363ed192f6c2baca88c28d5dcc743fc159269))

## [0.27.0](https://github.com/Highfivery/SelfOS/compare/v0.26.0...v0.27.0) (2026-07-15)


### Features

* **together:** record completed commitments in Goals "Completed & closed" (reopenable) ([#211](https://github.com/Highfivery/SelfOS/issues/211)) ([eb3a820](https://github.com/Highfivery/SelfOS/commit/eb3a820df52d6fa6d3b1e3597dc17fe3dd275f63))
* **together:** start a session in a centered modal, not an inline scroll-up bar ([#213](https://github.com/Highfivery/SelfOS/issues/213)) ([7363cd3](https://github.com/Highfivery/SelfOS/commit/7363cd304bfbd864aeb02ea98e3cb7f63a7f5838))


### Bug Fixes

* **together:** open the start bar into view so New session + catalog cards aren't dead ([#207](https://github.com/Highfivery/SelfOS/issues/207)) ([#210](https://github.com/Highfivery/SelfOS/issues/210)) ([1797b3f](https://github.com/Highfivery/SelfOS/commit/1797b3f70f495ea08a11b585d4cfbc9ca9fcbb38))
* **together:** wrap-up closes out the session + no duplicate/cross-session agreements ([#206](https://github.com/Highfivery/SelfOS/issues/206)) ([#208](https://github.com/Highfivery/SelfOS/issues/208)) ([33756be](https://github.com/Highfivery/SelfOS/commit/33756be4060bc9adcafd6b957247b5a534bbcbf0))

## [0.26.0](https://github.com/Highfivery/SelfOS/compare/v0.25.0...v0.26.0) (2026-07-15)


### Features

* **together:** redesign the Pulse card — two clean charts, calm not friction ([#204](https://github.com/Highfivery/SelfOS/issues/204)) ([ba11dc3](https://github.com/Highfivery/SelfOS/commit/ba11dc3c79bca8b216fd87d1517204507c3b862b))

## [0.25.0](https://github.com/Highfivery/SelfOS/compare/v0.24.1...v0.25.0) (2026-07-14)


### Features

* **together:** mid-session "Reflect & note action items" + wrap-up marks done ([#202](https://github.com/Highfivery/SelfOS/issues/202)) ([f2f4f4d](https://github.com/Highfivery/SelfOS/commit/f2f4f4d2cc6b076983bbf50cc98b32b9edc3e42a))

## [0.24.1](https://github.com/Highfivery/SelfOS/compare/v0.24.0...v0.24.1) (2026-07-14)


### Bug Fixes

* **home:** never hide your goals + Together agreements behind a crisis signal ([#200](https://github.com/Highfivery/SelfOS/issues/200)) ([da59e17](https://github.com/Highfivery/SelfOS/commit/da59e175f2ef23a9d9ef77bcf5ab88d54152aa62))

## [0.24.0](https://github.com/Highfivery/SelfOS/compare/v0.23.0...v0.24.0) (2026-07-14)


### Features

* **memory:** flatten the insights page into edit-in-place life-area sections (62) ([#197](https://github.com/Highfivery/SelfOS/issues/197)) ([a842685](https://github.com/Highfivery/SelfOS/commit/a8426850b7ef6817e5c55395b8f6fa992fefab2d))
* **together:** surface agreements in Goals + dashboard + inline pulse on Home (61) ([#195](https://github.com/Highfivery/SelfOS/issues/195)) ([b455b62](https://github.com/Highfivery/SelfOS/commit/b455b62cf4d24ae10e084b35487c6dae23815638))


### Bug Fixes

* **home:** show your goals AND Together reflections in "Needs attention" ([#199](https://github.com/Highfivery/SelfOS/issues/199)) ([bb76da9](https://github.com/Highfivery/SelfOS/commit/bb76da9792491f60c69e2b70c2ea026c59f7fa88))
* **together:** make standing agreements top-of-mind on the dashboard (61) ([#198](https://github.com/Highfivery/SelfOS/issues/198)) ([419dd11](https://github.com/Highfivery/SelfOS/commit/419dd112cbf7f0aab135ecf9de0ec90b814f94c5))

## [0.23.0](https://github.com/Highfivery/SelfOS/compare/v0.22.0...v0.23.0) (2026-07-14)


### Features

* **home:** challenge card + Home review polish (60 slice 3) ([#189](https://github.com/Highfivery/SelfOS/issues/189)) ([efe3527](https://github.com/Highfivery/SelfOS/commit/efe35277edfb12e74ae64d3ce1a0c511d31e0d77))
* **home:** complete hybrid dashboard redesign — bento, AI companion, life-rings, feed (60) ([#187](https://github.com/Highfivery/SelfOS/issues/187)) ([7f45fdd](https://github.com/Highfivery/SelfOS/commit/7f45fddfd84f475ddc5bc0b76704bc382805efed))
* **home:** goals card, you card, needs-attention queue, and life-rings redesign (60) ([#194](https://github.com/Highfivery/SelfOS/issues/194)) ([50488df](https://github.com/Highfivery/SelfOS/commit/50488dfb49b7ef4a30a7096877bbc9e89330f284))
* **home:** together pulse ring on the hero card + dead-code cleanup ([#191](https://github.com/Highfivery/SelfOS/issues/191)) ([ec09b85](https://github.com/Highfivery/SelfOS/commit/ec09b851bdf512c5d3e0d88dfc462492cf6a84e6))
* **questionnaires:** make Intimacy-Unfiltered genuinely extreme (08 §24.9) ([#190](https://github.com/Highfivery/SelfOS/issues/190)) ([53b0711](https://github.com/Highfivery/SelfOS/commit/53b0711cf7172503e0c22d6ed6e2ef54c933b370))


### Bug Fixes

* **questionnaires:** de-duplicate generated questions within a set ([#192](https://github.com/Highfivery/SelfOS/issues/192)) ([#193](https://github.com/Highfivery/SelfOS/issues/193)) ([a5a0dc3](https://github.com/Highfivery/SelfOS/commit/a5a0dc3a9e73815876a16d24265dc4e97bb6ce14))

## [0.22.0](https://github.com/Highfivery/SelfOS/compare/v0.21.0...v0.22.0) (2026-07-14)


### Features

* **home:** a dedicated Questionnaires dashboard section (59) ([#180](https://github.com/Highfivery/SelfOS/issues/180)) ([6242016](https://github.com/Highfivery/SelfOS/commit/6242016a093ea5922335c68854a27ec17647ef4f))
* **home:** questionnaire dashboard follow-ups — trend line + prefilled fun/spicy briefs (59) ([#182](https://github.com/Highfivery/SelfOS/issues/182)) ([96673c1](https://github.com/Highfivery/SelfOS/commit/96673c1c0dd6808240ce0ad06f024dc05045e459))
* **home:** richer Questionnaires dashboard section (59 §15) ([#183](https://github.com/Highfivery/SelfOS/issues/183)) ([7d8b7a3](https://github.com/Highfivery/SelfOS/commit/7d8b7a38c97f9a2672dc021ef81987da7b2fc4c2))
* **questionnaires:** draft-with-AI overhaul — brief-as-focus, count, real de-dup (08 §23) ([#184](https://github.com/Highfivery/SelfOS/issues/184)) ([b5aa9e1](https://github.com/Highfivery/SelfOS/commit/b5aa9e1aa0ad2a48da4daf0d0ab2740518afdbb8))
* **questionnaires:** sensitivity tiers that actually differ + explicit Scenario (08 §22) ([#179](https://github.com/Highfivery/SelfOS/issues/179)) ([4b18651](https://github.com/Highfivery/SelfOS/commit/4b186519dbc3994ce87031764bf535d5498727cb))
* **questionnaires:** use all data — complete de-dup + deep personalization (08 §24) ([#186](https://github.com/Highfivery/SelfOS/issues/186)) ([ac76501](https://github.com/Highfivery/SelfOS/commit/ac76501ae07a86ba68d95adc10db3b19ace9ae39))


### Bug Fixes

* **questionnaires:** stop re-asking onboarding questions in AI drafts (08 §23.5b) ([#185](https://github.com/Highfivery/SelfOS/issues/185)) ([0457acb](https://github.com/Highfivery/SelfOS/commit/0457acb75c0e5a0253744a58175e4fd75c19f347))

## [0.21.0](https://github.com/Highfivery/SelfOS/compare/v0.20.0...v0.21.0) (2026-07-13)


### Features

* **together:** coach-initiated private clarification channel (58 §3.14 Part B, Phase I2) ([#178](https://github.com/Highfivery/SelfOS/issues/178)) ([54ccd76](https://github.com/Highfivery/SelfOS/commit/54ccd763a81dee538ca28b25116921a2efd137a1))
* **together:** grounded self-verifying coaching (58 §3.14 Part A, Phase I1) ([#176](https://github.com/Highfivery/SelfOS/issues/176)) ([8a05a31](https://github.com/Highfivery/SelfOS/commit/8a05a31e1d2f0dd3bacbc3e91f1da40c02427513))

## [0.20.0](https://github.com/Highfivery/SelfOS/compare/v0.19.0...v0.20.0) (2026-07-13)


### Features

* **together:** a clear audience toggle so private vs shared is unmistakable (58 §3.6) ([#175](https://github.com/Highfivery/SelfOS/issues/175)) ([1ecebcf](https://github.com/Highfivery/SelfOS/commit/1ecebcfaa97e5d4d610f3fd1fe1f773b3167aeee))
* **together:** instant-send chat + sessions grouped by whose turn it is (58 §3.2/§3.6) ([#173](https://github.com/Highfivery/SelfOS/issues/173)) ([5790363](https://github.com/Highfivery/SelfOS/commit/5790363a7fcd989abc462b14eab16f1f6f94d85a))
* **together:** let the initiator withdraw a pending invitation (58 §3.4) ([#171](https://github.com/Highfivery/SelfOS/issues/171)) ([f9f8f07](https://github.com/Highfivery/SelfOS/commit/f9f8f07017b52239acd5fd61d49453fea805299f))


### Bug Fixes

* **together:** render the Withdraw control inside the session card, not below it ([#174](https://github.com/Highfivery/SelfOS/issues/174)) ([7e04e4f](https://github.com/Highfivery/SelfOS/commit/7e04e4fe5555aafada4505b3c675bd6332057209))

## [0.19.0](https://github.com/Highfivery/SelfOS/compare/v0.18.1...v0.19.0) (2026-07-13)


### Features

* **chat:** show date + time under each message, with day dividers ([#169](https://github.com/Highfivery/SelfOS/issues/169)) ([356c8e8](https://github.com/Highfivery/SelfOS/commit/356c8e87d3933215ea52f2a5fbe66439793fb0c7))
* **together:** redesign the Together dashboard around a clear priority order ([#166](https://github.com/Highfivery/SelfOS/issues/166)) ([#170](https://github.com/Highfivery/SelfOS/issues/170)) ([26c949b](https://github.com/Highfivery/SelfOS/commit/26c949bc1e00dff595b9a50a21a7ccdaf3fe184a))


### Bug Fixes

* **together:** show selected guide's full blurb + brighten dark headings ([#166](https://github.com/Highfivery/SelfOS/issues/166)) ([#167](https://github.com/Highfivery/SelfOS/issues/167)) ([6f518b0](https://github.com/Highfivery/SelfOS/commit/6f518b0f07e70025a7a8205b52371ffad5c2b105))

## [0.18.1](https://github.com/Highfivery/SelfOS/compare/v0.18.0...v0.18.1) (2026-07-11)


### Bug Fixes

* **ui:** content fills the available width — remove page max-width caps ([#164](https://github.com/Highfivery/SelfOS/issues/164)) ([5639f97](https://github.com/Highfivery/SelfOS/commit/5639f977507b78affa95d72794e531016aa7cb50))

## [0.18.0](https://github.com/Highfivery/SelfOS/compare/v0.17.0...v0.18.0) (2026-07-11)


### Features

* **together:** coach suggestion cards — guided exercise / check-in (58 §5.6) ([#162](https://github.com/Highfivery/SelfOS/issues/162)) ([9a81806](https://github.com/Highfivery/SelfOS/commit/9a81806b8a9e3355e21ed98139ed0db9470597a3))
* **together:** explicit register + Desire/intimacy + Yes/No/Maybe (58 phase F) ([#158](https://github.com/Highfivery/SelfOS/issues/158)) ([96f06c3](https://github.com/Highfivery/SelfOS/commit/96f06c3ce5078da7f2c6f587d8c366e5c500c6dd))
* **together:** Home presence provider + person-delete reap (58 §3.12/§5.6) ([#160](https://github.com/Highfivery/SelfOS/issues/160)) ([6c78ec1](https://github.com/Highfivery/SelfOS/commit/6c78ec138c9393ab25f7cabc3e5e2c915ea85c04))
* **together:** joint challenges — twin Challenge records for both partners (58 §5.6) ([#161](https://github.com/Highfivery/SelfOS/issues/161)) ([8d43a87](https://github.com/Highfivery/SelfOS/commit/8d43a873ae0b5e192dc11beb13257211f6eeedfb))
* **together:** prep spaces, image attachments, and the secrets policy (58 phase C) ([#155](https://github.com/Highfivery/SelfOS/issues/155)) ([f16be1c](https://github.com/Highfivery/SelfOS/commit/f16be1c2eabfbfdf766d2c0040d5df9bc9d8e30c))
* **together:** Pulse — dyad-metric trends + dual-consent desire alignment (58 §3.10a) ([#159](https://github.com/Highfivery/SelfOS/issues/159)) ([0834c29](https://github.com/Highfivery/SelfOS/commit/0834c29c0cf82fa164e3c458779c061cd68a12d2))
* **together:** remove the couples pre-screen (58 §8.2, owner decision) ([#163](https://github.com/Highfivery/SelfOS/issues/163)) ([cf3cf0f](https://github.com/Highfivery/SelfOS/commit/cf3cf0f8c45dab460067d3fe4dd4883d97702ae3))
* **together:** the guided couples catalog (58 phase E) ([#157](https://github.com/Highfivery/SelfOS/issues/157)) ([33d495b](https://github.com/Highfivery/SelfOS/commit/33d495b333a52c48b7cef2ab8a8295c7b53554d9))
* **together:** wrap-up & relationship memory (58 phase D) ([#156](https://github.com/Highfivery/SelfOS/issues/156)) ([b08699a](https://github.com/Highfivery/SelfOS/commit/b08699a63b1d474d8b3a7012a77e32b06768c8b0))


### Bug Fixes

* **questionnaires:** hide "Share a link" once the questionnaire has been answered (spec 08 §17.14e) ([#153](https://github.com/Highfivery/SelfOS/issues/153)) ([8f5fd89](https://github.com/Highfivery/SelfOS/commit/8f5fd89ba4945578dc3b24a1141e13c4166a92c6))

## [0.17.0](https://github.com/Highfivery/SelfOS/compare/v0.16.1...v0.17.0) (2026-07-11)


### Features

* **questionnaires:** 'At a glance' aggregate read (spec 08 §20, slice 4/5) ([#146](https://github.com/Highfivery/SelfOS/issues/146)) ([ec2dbef](https://github.com/Highfivery/SelfOS/commit/ec2dbef5e4ffad928df4ea2bbb207751b8217359))
* **questionnaires:** aggregate-first Results dashboard (spec 08 §21.4) ([#152](https://github.com/Highfivery/SelfOS/issues/152)) ([af7b7e3](https://github.com/Highfivery/SelfOS/commit/af7b7e38fdb69d882e522bcaec5771f33a33fd80))
* **questionnaires:** bespoke read-only Preview presentation view (spec 08 §21.2) ([#150](https://github.com/Highfivery/SelfOS/issues/150)) ([65fb1a9](https://github.com/Highfivery/SelfOS/commit/65fb1a9941d31d4b8f4a4ab8f8929d6419c72982))
* **questionnaires:** full-width detail + read-only disabled Preview (spec 08 §20, slice 1/5) ([#143](https://github.com/Highfivery/SelfOS/issues/143)) ([0703442](https://github.com/Highfivery/SelfOS/commit/070344214fd687a9be5be3eed94383e1a992d919))
* **questionnaires:** landing cards state whether answers are private or visible ([#140](https://github.com/Highfivery/SelfOS/issues/140)) ([b7f4e13](https://github.com/Highfivery/SelfOS/commit/b7f4e13134a65016e8a14cca6dd0cd8653a90a4c))
* **questionnaires:** modernize answering form + progress (spec 08 §20, slice 2/5) ([#144](https://github.com/Highfivery/SelfOS/issues/144)) ([bb49673](https://github.com/Highfivery/SelfOS/commit/bb49673e9944eb2b3f9af7bcf26e6774a290482d))
* **questionnaires:** one-question-at-a-time answering wizard (spec 08 §21.3) ([#151](https://github.com/Highfivery/SelfOS/issues/151)) ([03529f6](https://github.com/Highfivery/SelfOS/commit/03529f6e157688b8ea9c0a8d11e81cdf0d8bb1ef))
* **questionnaires:** private results — inline insight, numeric, explainer (spec 08 §20, slice 5/5) ([#147](https://github.com/Highfivery/SelfOS/issues/147)) ([3225b0f](https://github.com/Highfivery/SelfOS/commit/3225b0f5b45d71274dfdf94f6166fc36f491e0d0))
* **questionnaires:** restructure Results — summary + status grouping (spec 08 §20, slice 3/5) ([#145](https://github.com/Highfivery/SelfOS/issues/145)) ([7b67c40](https://github.com/Highfivery/SelfOS/commit/7b67c409b8af191e8f6c56b63386810280f0e678))
* **together:** couples sessions — Phase A + B foundation (spec 58) ([#148](https://github.com/Highfivery/SelfOS/issues/148)) ([4333180](https://github.com/Highfivery/SelfOS/commit/4333180f3514a6dc919d1fdc71e1054d5c4ceca3))


### Bug Fixes

* **questionnaires:** private answers are never shown — words or numbers (spec 08 §21.5) ([#149](https://github.com/Highfivery/SelfOS/issues/149)) ([e558688](https://github.com/Highfivery/SelfOS/commit/e558688f0fdb0b4c2ce0517f1ac77404f56d1568))

## [0.16.1](https://github.com/Highfivery/SelfOS/compare/v0.16.0...v0.16.1) (2026-07-09)


### Bug Fixes

* **questionnaires:** insight excerpt clamps cleanly, expands in place, deep-links to Memory ([#138](https://github.com/Highfivery/SelfOS/issues/138)) ([66dbfa4](https://github.com/Highfivery/SelfOS/commit/66dbfa41f48fb394311577a28b6e01e5abb82c41))

## [0.16.0](https://github.com/Highfivery/SelfOS/compare/v0.15.2...v0.16.0) (2026-07-08)


### Features

* **memory:** overview-first redesign — Goals & Sharing move to their own pages (spec 57) ([#132](https://github.com/Highfivery/SelfOS/issues/132)) ([ddb12d8](https://github.com/Highfivery/SelfOS/commit/ddb12d8ae24edabfd57e761c867d0b6ec9c63eac))
* **questionnaires:** redesign the landing into a two-section card dashboard ([#133](https://github.com/Highfivery/SelfOS/issues/133)) ([5d4a65b](https://github.com/Highfivery/SelfOS/commit/5d4a65b639e31303b3a3c7ac243aa30ac9a0a161))


### Bug Fixes

* **memory:** life-area tile count no longer clips at wide widths ([#136](https://github.com/Highfivery/SelfOS/issues/136)) ([1f700ca](https://github.com/Highfivery/SelfOS/commit/1f700ca3ae1bcfe4a3f2521229c884b1e22a2720))
* **ui:** full-width layouts, tame Memory text walls, fix self-assessment pronouns ([#135](https://github.com/Highfivery/SelfOS/issues/135)) ([b7f9f3e](https://github.com/Highfivery/SelfOS/commit/b7f9f3ec18fc317d27457f05619c4f40615e46a5))

## [0.15.2](https://github.com/Highfivery/SelfOS/compare/v0.15.1...v0.15.2) (2026-07-08)


### Bug Fixes

* **memory:** group sent-questionnaire insights as "Responses", not "About you" ([#129](https://github.com/Highfivery/SelfOS/issues/129)) ([b260950](https://github.com/Highfivery/SelfOS/commit/b2609506e0ad24a629313558a7e5e5781d73ef79))

## [0.15.1](https://github.com/Highfivery/SelfOS/compare/v0.15.0...v0.15.1) (2026-07-08)


### Bug Fixes

* **sessions:** stop the wrap-up card overlaying the crisis footer + group it ([#127](https://github.com/Highfivery/SelfOS/issues/127)) ([efd8964](https://github.com/Highfivery/SelfOS/commit/efd8964831bf3ddc362d3f46da835b5c3953800c))

## [0.15.0](https://github.com/Highfivery/SelfOS/compare/v0.14.4...v0.15.0) (2026-07-08)


### Features

* **sessions:** clear the composer on send + add a "Wrap up & reflect" button ([#125](https://github.com/Highfivery/SelfOS/issues/125)) ([c896e7e](https://github.com/Highfivery/SelfOS/commit/c896e7eb8975d2d76bedb253d42e51c736d780af))

## [0.14.4](https://github.com/Highfivery/SelfOS/compare/v0.14.3...v0.14.4) (2026-07-08)


### Bug Fixes

* **sessions:** recover a legacy session that dead-ended on a blank reply ([#123](https://github.com/Highfivery/SelfOS/issues/123)) ([3b6ecc2](https://github.com/Highfivery/SelfOS/commit/3b6ecc2acf9ab35542905998bd20f3ab384776ad))

## [0.14.3](https://github.com/Highfivery/SelfOS/compare/v0.14.2...v0.14.3) (2026-07-07)


### Bug Fixes

* **sessions:** recover a re-opened session that ended on the user's message ([#121](https://github.com/Highfivery/SelfOS/issues/121)) ([a8b42ba](https://github.com/Highfivery/SelfOS/commit/a8b42bae80a0e44b5ca234cfd6ad7e9e5a53c8c6))

## [0.14.2](https://github.com/Highfivery/SelfOS/compare/v0.14.1...v0.14.2) (2026-07-07)


### Bug Fixes

* **sessions:** surface empty/failed replies with a retry, never a silent dead end ([#119](https://github.com/Highfivery/SelfOS/issues/119)) ([a05f485](https://github.com/Highfivery/SelfOS/commit/a05f4856a5c9fa80de8338f7834e205b75a655d7))

## [0.14.1](https://github.com/Highfivery/SelfOS/compare/v0.14.0...v0.14.1) (2026-07-07)


### Bug Fixes

* **questionnaires:** scope the edit/authoring list to what you authored ([#117](https://github.com/Highfivery/SelfOS/issues/117)) ([2a5bab6](https://github.com/Highfivery/SelfOS/commit/2a5bab63b5b782c6761edddb892a6104c834f30c))

## [0.14.0](https://github.com/Highfivery/SelfOS/compare/v0.13.1...v0.14.0) (2026-07-07)


### Features

* **onboarding:** notify when completed onboarding has new/unanswered questions ([#112](https://github.com/Highfivery/SelfOS/issues/112)) ([0c46f95](https://github.com/Highfivery/SelfOS/commit/0c46f95a764b100ad512809a51f7ee3fa097a90d)), closes [#109](https://github.com/Highfivery/SelfOS/issues/109)
* **questionnaires:** let recipients review + edit + resend answers; nudge the sender to re-analyze ([#116](https://github.com/Highfivery/SelfOS/issues/116)) ([363053b](https://github.com/Highfivery/SelfOS/commit/363053b9fd7d8bc28b5481a4c78c2f790c65c278))


### Bug Fixes

* **you:** drop taken tests from the Available catalog ([#110](https://github.com/Highfivery/SelfOS/issues/110)) ([de5ed67](https://github.com/Highfivery/SelfOS/commit/de5ed67951efbbc2788c21937f9e6a13f8af0ca2)), closes [#95](https://github.com/Highfivery/SelfOS/issues/95)

## [0.13.1](https://github.com/Highfivery/SelfOS/compare/v0.13.0...v0.13.1) (2026-07-01)


### Bug Fixes

* **dreams:** bigger grid cards + native-ratio detail image ([#107](https://github.com/Highfivery/SelfOS/issues/107)) ([8039b3b](https://github.com/Highfivery/SelfOS/commit/8039b3bfdc3b42a97c95842622d2a6475fb21090))

## [0.13.0](https://github.com/Highfivery/SelfOS/compare/v0.12.3...v0.13.0) (2026-07-01)


### Features

* **dreams:** dashboard insight strip, quick filters, time grouping ([#106](https://github.com/Highfivery/SelfOS/issues/106)) ([2a8b4e3](https://github.com/Highfivery/SelfOS/commit/2a8b4e3c1368de1f3d4b14938bfc7dc022ed294e))
* **dreams:** image-forward dashboard card grid + immersive detail ([#104](https://github.com/Highfivery/SelfOS/issues/104)) ([54b4501](https://github.com/Highfivery/SelfOS/commit/54b45019f5d044798bcb6146ca31c096b2b23abb))

## [0.12.3](https://github.com/Highfivery/SelfOS/compare/v0.12.2...v0.12.3) (2026-07-01)


### Bug Fixes

* **dreams:** share a dream reflection with multiple people (per-person chips) ([0dc7b3d](https://github.com/Highfivery/SelfOS/commit/0dc7b3dcaacdcc03f587fb44f3ecf70329533f00))

## [0.12.2](https://github.com/Highfivery/SelfOS/compare/v0.12.1...v0.12.2) (2026-07-01)


### Bug Fixes

* **dreams:** titled, collapsible, markdown-rendered dream share controls ([65fa3e3](https://github.com/Highfivery/SelfOS/commit/65fa3e387de87e3f0946f7285f77b2fe8f7e23c0))

## [0.12.1](https://github.com/Highfivery/SelfOS/compare/v0.12.0...v0.12.1) (2026-07-01)


### Bug Fixes

* **dreams:** disable adaptive thinking on bounded-JSON syntheses (fixes "analysis cut off") ([5743f2e](https://github.com/Highfivery/SelfOS/commit/5743f2e7996478bb738116f0b921039f69d77ffa))

## [0.12.0](https://github.com/Highfivery/SelfOS/compare/v0.11.3...v0.12.0) (2026-07-01)


### Features

* **dreams:** reflection-as-a-session — coach-first opener, read-first detail, people quick-add (12 §15) ([2523fc2](https://github.com/Highfivery/SelfOS/commit/2523fc2bac4ad8e259512ca26c83952270f5699d))

## [0.11.3](https://github.com/Highfivery/SelfOS/compare/v0.11.2...v0.11.3) (2026-06-27)


### Bug Fixes

* **onboarding:** persist sharing for unanswered questions + save on click (43) ([#93](https://github.com/Highfivery/SelfOS/issues/93)) ([e44cf54](https://github.com/Highfivery/SelfOS/commit/e44cf54389212da03936ac07d6eefbdabf4b82cf))

## [0.11.2](https://github.com/Highfivery/SelfOS/compare/v0.11.1...v0.11.2) (2026-06-26)


### Bug Fixes

* **onboarding:** auto-save EVERY section as a draft, not just completed ones (43) ([#91](https://github.com/Highfivery/SelfOS/issues/91)) ([061d30a](https://github.com/Highfivery/SelfOS/commit/061d30a4abc05c9bf3bc765c4f57a8fd8276a5bd))

## [0.11.1](https://github.com/Highfivery/SelfOS/compare/v0.11.0...v0.11.1) (2026-06-26)


### Bug Fixes

* **onboarding:** intake sharing saves on one tap + auto-saves on edit (43) ([#89](https://github.com/Highfivery/SelfOS/issues/89)) ([6fb1413](https://github.com/Highfivery/SelfOS/commit/6fb141324e5032268a349f583fe564c1cfc45783))

## [0.11.0](https://github.com/Highfivery/SelfOS/compare/v0.10.0...v0.11.0) (2026-06-26)


### Features

* **challenges:** challenge/experiment sessions (spec 52) ([b45fa82](https://github.com/Highfivery/SelfOS/commit/b45fa828a8ae752d1390b797a7fd6dd0d6ac2e79))
* **home:** personalized recommendation engine + Home redesign (spec 53 Slice A) ([#75](https://github.com/Highfivery/SelfOS/issues/75)) ([9747de7](https://github.com/Highfivery/SelfOS/commit/9747de715bcf7ed1541a3da323a9d530da80dbdf))
* **home:** self-assessment, wellbeing & intimacy recommendations (spec 53 Slice B) ([#82](https://github.com/Highfivery/SelfOS/issues/82)) ([d5af0c1](https://github.com/Highfivery/SelfOS/commit/d5af0c177e6b0b9a5fb0c5db9f731a67aec76b3c))
* **intimacy:** categorized, tiered activities inventory + grouped matrix (spec 49) ([#78](https://github.com/Highfivery/SelfOS/issues/78)) ([19ff194](https://github.com/Highfivery/SelfOS/commit/19ff194f560a438c7c9bc59559d23248d3b39fbb))
* **intimacy:** clearer anatomy wording, inventory additions, porn types ([#84](https://github.com/Highfivery/SelfOS/issues/84)) ([b8ccff7](https://github.com/Highfivery/SelfOS/commit/b8ccff7a493e51df33cc7a569456cebd9dab426a))
* **memory:** redesign Memory — sharing is context not display + relationship insights + test-sharing default (54) ([#86](https://github.com/Highfivery/SelfOS/issues/86)) ([1e2363b](https://github.com/Highfivery/SelfOS/commit/1e2363b00fcaa8f29e058bfb868407378be5c566))
* **sessions:** expand guided catalog — fuller therapy/coaching, a Family group, + search ([#87](https://github.com/Highfivery/SelfOS/issues/87)) ([4c031fb](https://github.com/Highfivery/SelfOS/commit/4c031fb21288c75564d63c1cea151714d871204f))
* **sessions:** expand intimacy guided-session group (spec 48) ([#77](https://github.com/Highfivery/SelfOS/issues/77)) ([4ccb930](https://github.com/Highfivery/SelfOS/commit/4ccb9306700b41600972362ab8edaa2083621270))
* **settings:** owner AI suggester for intimacy topics (08 §16.5a) ([#88](https://github.com/Highfivery/SelfOS/issues/88)) ([2f7896f](https://github.com/Highfivery/SelfOS/commit/2f7896f5a7bc448d8e1e4a9b960729d0626612a0))
* **tests:** self-assessments engine + "You" hub (spec 50) ([#79](https://github.com/Highfivery/SelfOS/issues/79)) ([171b605](https://github.com/Highfivery/SelfOS/commit/171b60568900aab65fd7871eca32b378d2b1d489))
* **tests:** wellbeing & neurodivergence self-reflections (spec 51) ([#80](https://github.com/Highfivery/SelfOS/issues/80)) ([0baf2f0](https://github.com/Highfivery/SelfOS/commit/0baf2f0b935e5f4054e1ad1e63e73020fca6b7fb))


### Bug Fixes

* **privacy:** exclude wholly-restricted insights from cross-feature AI digests (audit 48–53) ([#83](https://github.com/Highfivery/SelfOS/issues/83)) ([1d3dc5a](https://github.com/Highfivery/SelfOS/commit/1d3dc5a2c76f9308a01c7b283f03a8d4865e2f4e))

## [0.10.0](https://github.com/Highfivery/SelfOS/compare/v0.9.1...v0.10.0) (2026-06-25)


### Features

* **onboarding:** anatomy-driven intimacy matrix labels + stable row keys ([#62](https://github.com/Highfivery/SelfOS/issues/62)) ([#70](https://github.com/Highfivery/SelfOS/issues/70)) ([e505f89](https://github.com/Highfivery/SelfOS/commit/e505f8944088df29185a1dadeea9e0767e679193))
* **questionnaires:** knowledge-aware generation — feed raw answers, go deeper, fix blank options ([#72](https://github.com/Highfivery/SelfOS/issues/72)) ([5a7cf33](https://github.com/Highfivery/SelfOS/commit/5a7cf3332321382fcc0a3c2aa4cb0baf3a8cb761))
* **questionnaires:** recipient-first Suggested + saved, tailored gap-finder suggestions ([#67](https://github.com/Highfivery/SelfOS/issues/67)) ([971bc7d](https://github.com/Highfivery/SelfOS/commit/971bc7da99cda6b81541c493b4b07ce15225e720))
* **sessions:** attach images to a session so the coach can see them (spec 45) ([#69](https://github.com/Highfivery/SelfOS/issues/69)) ([45a9963](https://github.com/Highfivery/SelfOS/commit/45a9963efb240ad25cd7a4fdb248c097dfb98c9b))


### Bug Fixes

* **onboarding:** intake quality pass — cleared-trigger orphans + wording collisions (spec 47) ([#71](https://github.com/Highfivery/SelfOS/issues/71)) ([cbec72e](https://github.com/Highfivery/SelfOS/commit/cbec72e7b6442535df7e453212dff7e500335ec8))

## [0.9.1](https://github.com/Highfivery/SelfOS/compare/v0.9.0...v0.9.1) (2026-06-25)


### Bug Fixes

* **questionnaires:** gap-finder "unexpected shape" — name answer types + tolerant inner parse ([#60](https://github.com/Highfivery/SelfOS/issues/60)) ([124b0ba](https://github.com/Highfivery/SelfOS/commit/124b0ba6351a5bc07707f6857e41746df925c212))

## [0.9.0](https://github.com/Highfivery/SelfOS/compare/v0.8.1...v0.9.0) (2026-06-24)


### Features

* **memory:** collapsible portrait + onboarding sharing layout redesign ([#58](https://github.com/Highfivery/SelfOS/issues/58)) ([b4f1c25](https://github.com/Highfivery/SelfOS/commit/b4f1c25daf50a51faee8cf81df218956f1c0e9ff))

## [0.8.1](https://github.com/Highfivery/SelfOS/compare/v0.8.0...v0.8.1) (2026-06-24)


### Bug Fixes

* **onboarding:** share-by-default backfill, inline picker confirm, clean Memory cards ([#56](https://github.com/Highfivery/SelfOS/issues/56)) ([1791e07](https://github.com/Highfivery/SelfOS/commit/1791e07b5a62116489efb67dc52a0df87933ff56))

## [0.8.0](https://github.com/Highfivery/SelfOS/compare/v0.7.0...v0.8.0) (2026-06-24)


### Features

* **ai:** tolerant model-JSON parsing + honest failure taxonomy (spec 37) ([#44](https://github.com/Highfivery/SelfOS/issues/44)) ([5172b7b](https://github.com/Highfivery/SelfOS/commit/5172b7bdad3b380e9ea282c3c93768feb198db00))
* **coaching:** proactive coaching — goal follow-through, synthesis, crisis awareness (spec 40) ([#48](https://github.com/Highfivery/SelfOS/issues/48)) ([e3113ff](https://github.com/Highfivery/SelfOS/commit/e3113ffb805826fda6e39b3461aa20dc98d0355e))
* **discoverability:** empty states, AI-unavailable copy, scope & orientation (spec 41) ([#49](https://github.com/Highfivery/SelfOS/issues/49)) ([e7127a0](https://github.com/Highfivery/SelfOS/commit/e7127a0c83878e681dee3520640cb230f5cd06ac))
* **memory:** dashboard overhaul — stats header, scoped sharing, transparency surface (spec 44) ([#52](https://github.com/Highfivery/SelfOS/issues/52)) ([d467e61](https://github.com/Highfivery/SelfOS/commit/d467e61a3eeaef3a67df3593ed1e46adcb17a8da))
* **memory:** living memory & continuity — auto-reconcile, tracked goals, share cleanup (spec 39) ([#46](https://github.com/Highfivery/SelfOS/issues/46)) ([cb5e1c5](https://github.com/Highfivery/SelfOS/commit/cb5e1c50d70d86886ccb8f7b731f9455523a9019))
* **onboarding:** per-question relationship-scoped sharing in the intake flow (spec 43) ([#51](https://github.com/Highfivery/SelfOS/issues/51)) ([a6ef6ae](https://github.com/Highfivery/SelfOS/commit/a6ef6ae5681d0ef36a855ca0f0b4d554167fde4b))
* **questionnaires:** lifecycle completeness — discoverability, validation, re-ask, export, favorites (spec 38) ([#47](https://github.com/Highfivery/SelfOS/issues/47)) ([5347321](https://github.com/Highfivery/SelfOS/commit/5347321f2329a13a6c7cc4cdfa136f2ea461c6bf))
* relationship-scoped sharing — the foundational model (spec 42) ([#43](https://github.com/Highfivery/SelfOS/issues/43)) ([4d83c4f](https://github.com/Highfivery/SelfOS/commit/4d83c4f4e6c0e2fc51b341e7e8a551cf4d5efb81))


### Bug Fixes

* audit follow-ups for specs 37-41 (synthesis privacy leak + should-fixes) ([#50](https://github.com/Highfivery/SelfOS/issues/50)) ([0d49936](https://github.com/Highfivery/SelfOS/commit/0d49936293eee4f21f8640db2593dc26b3ddc1d5))
* **sharing:** audit follow-ups for relationship-scoped sharing (specs 42-44) ([#53](https://github.com/Highfivery/SelfOS/issues/53)) ([6aa3c01](https://github.com/Highfivery/SelfOS/commit/6aa3c013cc83cb84fca0bd434b1b4e44a370b95f))

## [0.7.0](https://github.com/Highfivery/SelfOS/compare/v0.6.0...v0.7.0) (2026-06-23)


### Features

* **onboarding:** richer Home onboarding card — progress stats + staleness-driven review ([#42](https://github.com/Highfivery/SelfOS/issues/42)) ([f47ac4c](https://github.com/Highfivery/SelfOS/commit/f47ac4c02a30d26ef63e9d218f3ce3cb6e037cf0))


### Bug Fixes

* **app-shell:** guard capability-gated routes, not just nav links ([#40](https://github.com/Highfivery/SelfOS/issues/40)) ([fb08e9e](https://github.com/Highfivery/SelfOS/commit/fb08e9e4490ad80ee6c2c14e73019375cc8975bf))

## [0.6.0](https://github.com/Highfivery/SelfOS/compare/v0.5.1...v0.6.0) (2026-06-23)


### Features

* **context:** topic-aware portrait facts on every coaching surface (spec 28 §13) ([#39](https://github.com/Highfivery/SelfOS/issues/39)) ([fa4d506](https://github.com/Highfivery/SelfOS/commit/fa4d506908078069e52935ee943350e335489e40))
* **onboarding:** 5-point gender-aware intimacy activity matrix (spec 27 §4.2) ([#36](https://github.com/Highfivery/SelfOS/issues/36)) ([c33af96](https://github.com/Highfivery/SelfOS/commit/c33af963688ab0b6080611c43f4fb5e7f92a6e31))
* **onboarding:** porn conditional fields, parent-figures roster, cut 4 questions (specs 18/26/27) ([#38](https://github.com/Highfivery/SelfOS/issues/38)) ([da13d09](https://github.com/Highfivery/SelfOS/commit/da13d0982680473b0687baf43f4d57c647aed15f))


### Bug Fixes

* capture date of birth for pets in onboarding too ([#34](https://github.com/Highfivery/SelfOS/issues/34)) ([9c6bc51](https://github.com/Highfivery/SelfOS/commit/9c6bc51993c5be5ebeffb752d0393ae5b1e53ea2))

## [0.5.1](https://github.com/Highfivery/SelfOS/compare/v0.5.0...v0.5.1) (2026-06-23)


### Bug Fixes

* onboarding kids roster captures date of birth, not a stale age ([#32](https://github.com/Highfivery/SelfOS/issues/32)) ([10977b2](https://github.com/Highfivery/SelfOS/commit/10977b2d96d6b76b3eae6cc279ced2f68f50b296))

## [0.5.0](https://github.com/Highfivery/SelfOS/compare/v0.4.0...v0.5.0) (2026-06-23)


### Features

* notify-only update awareness — checks GitHub Releases, raises an update notification (spec 36) ([#31](https://github.com/Highfivery/SelfOS/issues/31)) ([ce5519f](https://github.com/Highfivery/SelfOS/commit/ce5519f09e345c9aecc4931ea94da31d855735d9))
* unified in-app notification system — bell + center + toasts (spec 35) ([#29](https://github.com/Highfivery/SelfOS/issues/29)) ([6a701a4](https://github.com/Highfivery/SelfOS/commit/6a701a429786bdbea784d52a5d224a9d6c355e69))

## [0.4.0](https://github.com/Highfivery/SelfOS/compare/v0.3.3...v0.4.0) (2026-06-23)


### Features

* render AI prose as rich text with a shared Markdown primitive (spec 34) ([#26](https://github.com/Highfivery/SelfOS/issues/26)) ([7efa190](https://github.com/Highfivery/SelfOS/commit/7efa1903f5dc64d546c5d291734e8d86660a2ea9))

## [0.3.3](https://github.com/Highfivery/SelfOS/compare/v0.3.2...v0.3.3) (2026-06-23)


### Bug Fixes

* **intake:** salvage truncated portraits + raise the synthesis budget ([#20](https://github.com/Highfivery/SelfOS/issues/20)) ([70566d6](https://github.com/Highfivery/SelfOS/commit/70566d66c0977518b28f0d60372784e7a7dc10d4)), closes [#19](https://github.com/Highfivery/SelfOS/issues/19)

## [0.3.2](https://github.com/Highfivery/SelfOS/compare/v0.3.1...v0.3.2) (2026-06-23)


### Bug Fixes

* **intake:** make portrait synthesis resilient to off-spec + truncated model JSON ([#15](https://github.com/Highfivery/SelfOS/issues/15)) ([9d225b1](https://github.com/Highfivery/SelfOS/commit/9d225b1c0be8182a5c56dcbbfedbb35d6cb81d2b)), closes [#14](https://github.com/Highfivery/SelfOS/issues/14)

## [0.3.1](https://github.com/Highfivery/SelfOS/compare/v0.3.0...v0.3.1) (2026-06-22)


### Bug Fixes

* **ai:** auto-share AI credentials to the household by default (spec 25 §5.6) ([f173150](https://github.com/Highfivery/SelfOS/commit/f173150edd183d95b2aea1fbc2b277a37778b83a))

## [0.3.0](https://github.com/Highfivery/SelfOS/compare/v0.2.1...v0.3.0) (2026-06-22)


### Features

* **access:** owner-only settings sections + gallery; move vault control into account menu ([a72c269](https://github.com/Highfivery/SelfOS/commit/a72c269b8d71826db55865072784c8bf6a47ee6c))
* **ai:** household-shared AI credentials so members inherit the owner's key ([c639dab](https://github.com/Highfivery/SelfOS/commit/c639dab2759c47ff709ec270f19faae8410a6702))
* **devices:** device registry — slice A of spec 28 ([cc64c76](https://github.com/Highfivery/SelfOS/commit/cc64c765ab537c1b2fddb8cbc5e3ba6984a00b42))
* **devices:** key rotation — slice B of spec 28 (revocation by re-encryption) ([128935c](https://github.com/Highfivery/SelfOS/commit/128935cc3297ba588e0cec2a5d8925f762d7003c))
* **devices:** owner Devices settings section — slice C of spec 28 ([e142f61](https://github.com/Highfivery/SelfOS/commit/e142f61e238e5fd4a9e74f4b4b001cec4fdf7e22))
* **housekeeping:** spec 29 slice C — iOS sync-conflict detection ([f975ae3](https://github.com/Highfivery/SelfOS/commit/f975ae3912f09a2fe74782940930c2f491d29403))
* **housekeeping:** spec 29 slice D — sync-safety warning at first-run setup ([19d113e](https://github.com/Highfivery/SelfOS/commit/19d113e0d8206b532b0b5168542295e4ed555582))
* **housekeeping:** spec 29 slices A + B — spec-10 doc cleanup + OpenAI test connection ([7ba5aed](https://github.com/Highfivery/SelfOS/commit/7ba5aed89bf587be0f08b232014ed254fcc22f1b))
* **intake:** also cut swallowSpit + cumWhere from intimacy (61 → 40) ([32f7b0b](https://github.com/Highfivery/SelfOS/commit/32f7b0bcfaa2f26344d4573b6886dd8d1edf15f5))
* **intake:** progressive profile depth invitations (spec 29) ([2aa034d](https://github.com/Highfivery/SelfOS/commit/2aa034da847e4558a4591a6fd5afef0595584e4d))
* **intake:** rebalance intimacy block 100→61, kept explicit (spec 27) ([284083f](https://github.com/Highfivery/SelfOS/commit/284083fa5b6e1cdb6a1aad8f707f273782478ce7))
* **intake:** redesign onboarding catalog — cut non-intimacy 392→126 (spec 26) ([053dcf3](https://github.com/Highfivery/SelfOS/commit/053dcf3be0bed85b71cc0522b5574984e3dd1c62))
* **intake:** slice 28a — slider-seed fix + portrait fact cap (spec 28) ([e66c0a0](https://github.com/Highfivery/SelfOS/commit/e66c0a0af33b273b7e64fb30fbc860df56040c91))
* **intake:** slice 28b — topic-relevance portrait selection (spec 28) ([a96de09](https://github.com/Highfivery/SelfOS/commit/a96de0916cdb2df4fcc4c417eb4f6a429a5852b3))
* **intake:** trim intimacy block 61 → 42 + opt-in specifics gate (spec 27 §4.3) ([6bd9d8f](https://github.com/Highfivery/SelfOS/commit/6bd9d8fe4107cd1904eff47e6cebcc0679de248d))
* **settings:** enforce the settings-write trust boundary in the bridge ([b2292ab](https://github.com/Highfivery/SelfOS/commit/b2292ab94147fdf83fc4de71a40f034308544dcf))

## [0.1.0](https://github.com/Highfivery/SelfOS/compare/v0.2.1...v0.1.0) (2026-06-17)


### Features

* **distribution:** automate versioning, macOS release builds & non-technical README ([6acc494](https://github.com/Highfivery/SelfOS/commit/6acc49485e51a0be1e708aac62f0f3533c868b4d))
* **memory:** living dashboard UI — filters, life-area groups, confidence, provenance (spec 20) ([868a6f4](https://github.com/Highfivery/SelfOS/commit/868a6f4bda36fa9441d5294acff721fe482ed1f5))
* **memory:** living insights engine — reconcile, flag, categories, keep-on-delete (spec 20) ([5e67761](https://github.com/Highfivery/SelfOS/commit/5e67761722ecccf889a1b8fef9d7edaab8452b1c))
* **onboarding:** cover every People field + structured dates (18 §14.6) ([73fbd5e](https://github.com/Highfivery/SelfOS/commit/73fbd5edb06dc6374a987bb124c7a511ced01757))
* **onboarding:** cultural/ethnic background is a multi-select with Other (18 §14.6) ([9e0781a](https://github.com/Highfivery/SelfOS/commit/9e0781a57e918d537d1d2bfa5ba0536500b2dbe3))
* **onboarding:** kids & pets conditional rosters via a new roster answer type (18 §14.6) ([86b3ad1](https://github.com/Highfivery/SelfOS/commit/86b3ad1a2b61e635cf65d04bb980fcbc18a9230b))
* **questionnaires:** household sends also mint a relay link (08 §17.13) ([82f292e](https://github.com/Highfivery/SelfOS/commit/82f292e0b8cce6e7e84b609b7a3cc04e4f3252aa))
* **relay:** attachRelayLink — mint a relay link for an in-app send + first-wins drain (08 §17.13) ([715f2b9](https://github.com/Highfivery/SelfOS/commit/715f2b994f6dab4cbb5a19c75552090397ac0c74))


### Bug Fixes

* **answering:** scale→slider, clean long prompts, full-width option cards ([517d503](https://github.com/Highfivery/SelfOS/commit/517d5032b00411a3f153e2904d9ee05305594a54))
* **app:** gate the app name so dev uses a separate userData ([5babdf8](https://github.com/Highfivery/SelfOS/commit/5babdf8605a110175d09a0381b0db7a7360a272c))
* **memory:** scope insights:list to the active person — close the cross-user leak (spec 20 §1.1) ([aba6a60](https://github.com/Highfivery/SelfOS/commit/aba6a60321ec89598934ecb0ed49c8608b6e9fb3))
* **onboarding:** placeholders on all free-text questions; trim decisionStyle (18 §14.6) ([a983d54](https://github.com/Highfivery/SelfOS/commit/a983d541ad1c01319b4c5487a1a0cdc85ca2ec1a))
* **onboarding:** the important-dates row label collapsed + remove button overflowed (18 §14.6) ([c3cc9b3](https://github.com/Highfivery/SelfOS/commit/c3cc9b3637dabe016aa2eefa2628bc7852506c95))
* **people:** remove the duplicated profile questions from the People editor (18 §14.6) ([f09cdf2](https://github.com/Highfivery/SelfOS/commit/f09cdf232ebfa6bddb8db9b2894adc71b9aec3a9))
* **questionnaires:** compat variants rewrite options with correct gender pronouns; sleek share card ([1ad9d49](https://github.com/Highfivery/SelfOS/commit/1ad9d4906f269167b1197a934c7e7a83bb842dca))
* **questionnaires:** compatibility variants ask about the OTHER participant (08 §17.12-E) ([758b92d](https://github.com/Highfivery/SelfOS/commit/758b92d5e7e13f49fb8f6b03654b53462803075d))
* **questionnaires:** drop test-on-yourself "Finish" from the sent (locked) preview ([7453d5a](https://github.com/Highfivery/SelfOS/commit/7453d5a9cae41e9beb9584e681a124dfe9a0644e))
* **questionnaires:** fix relay 404 (stale Worker) + make the link reachable after sending ([79841da](https://github.com/Highfivery/SelfOS/commit/79841dabf3c269ecea3386354b9c8874c19cbcb8))
* **questionnaires:** focused full-width builder — no orphaned empty space ([b8defd7](https://github.com/Highfivery/SelfOS/commit/b8defd749e6463dfd22228c9939460df2d77405c))
* **questionnaires:** make the send lifecycle visible — relay drain, sent badge, delete, draft save ([a275bd4](https://github.com/Highfivery/SelfOS/commit/a275bd446955561c47ad914465a0e1c03823a91b))
* **questionnaires:** share link re-shows the existing link; manual refresh regenerates ([af46172](https://github.com/Highfivery/SelfOS/commit/af4617215f98e9df8d5d3f69cad225ac9fc36490))
* **questionnaires:** surface a hint when a household send has no relay link (08 §17.13) ([9c82c48](https://github.com/Highfivery/SelfOS/commit/9c82c48beb1c46ac92d4c126b92a5717af0a03b4))
* **questionnaires:** surface relay-mint failures + lock sent questionnaires (read-only) ([e7d6df3](https://github.com/Highfivery/SelfOS/commit/e7d6df352054b6aefc7a6d132d2b1914c4237d5a))
* **questionnaires:** unified delivery for compatibility + re-publish/resend a relay link ([fa6651a](https://github.com/Highfivery/SelfOS/commit/fa6651aa837e5b5d1b73e66394bf9d6ecb1c60e2))
* **questionnaires:** warmer fallback for a nameless external compat recipient ([1f993ef](https://github.com/Highfivery/SelfOS/commit/1f993ef3fb7c4f288e0797ae5cb75566594e7807))
* **relay:** package the relay Worker bundle into the built app ([b32b7d9](https://github.com/Highfivery/SelfOS/commit/b32b7d9ab71492140194d4354b5ea3a816c8a571))


### Miscellaneous Chores

* release as 0.1.0 ([36c3dff](https://github.com/Highfivery/SelfOS/commit/36c3dffdcff2565d72a698ef9579b0683146190c))

## [0.2.1](https://github.com/Highfivery/SelfOS/compare/v0.2.0...v0.2.1) (2026-06-17)


### Bug Fixes

* **app:** gate the app name so dev uses a separate userData ([5babdf8](https://github.com/Highfivery/SelfOS/commit/5babdf8605a110175d09a0381b0db7a7360a272c))
* **relay:** package the relay Worker bundle into the built app ([b32b7d9](https://github.com/Highfivery/SelfOS/commit/b32b7d9ab71492140194d4354b5ea3a816c8a571))

## [0.2.0](https://github.com/Highfivery/SelfOS/compare/v0.1.0...v0.2.0) (2026-06-17)


### Features

* **memory:** living dashboard UI — filters, life-area groups, confidence, provenance (spec 20) ([868a6f4](https://github.com/Highfivery/SelfOS/commit/868a6f4bda36fa9441d5294acff721fe482ed1f5))
* **memory:** living insights engine — reconcile, flag, categories, keep-on-delete (spec 20) ([5e67761](https://github.com/Highfivery/SelfOS/commit/5e67761722ecccf889a1b8fef9d7edaab8452b1c))
* **onboarding:** cover every People field + structured dates (18 §14.6) ([73fbd5e](https://github.com/Highfivery/SelfOS/commit/73fbd5edb06dc6374a987bb124c7a511ced01757))
* **onboarding:** cultural/ethnic background is a multi-select with Other (18 §14.6) ([9e0781a](https://github.com/Highfivery/SelfOS/commit/9e0781a57e918d537d1d2bfa5ba0536500b2dbe3))
* **onboarding:** kids & pets conditional rosters via a new roster answer type (18 §14.6) ([86b3ad1](https://github.com/Highfivery/SelfOS/commit/86b3ad1a2b61e635cf65d04bb980fcbc18a9230b))
* **questionnaires:** household sends also mint a relay link (08 §17.13) ([82f292e](https://github.com/Highfivery/SelfOS/commit/82f292e0b8cce6e7e84b609b7a3cc04e4f3252aa))
* **relay:** attachRelayLink — mint a relay link for an in-app send + first-wins drain (08 §17.13) ([715f2b9](https://github.com/Highfivery/SelfOS/commit/715f2b994f6dab4cbb5a19c75552090397ac0c74))


### Bug Fixes

* **answering:** scale→slider, clean long prompts, full-width option cards ([517d503](https://github.com/Highfivery/SelfOS/commit/517d5032b00411a3f153e2904d9ee05305594a54))
* **memory:** scope insights:list to the active person — close the cross-user leak (spec 20 §1.1) ([aba6a60](https://github.com/Highfivery/SelfOS/commit/aba6a60321ec89598934ecb0ed49c8608b6e9fb3))
* **onboarding:** placeholders on all free-text questions; trim decisionStyle (18 §14.6) ([a983d54](https://github.com/Highfivery/SelfOS/commit/a983d541ad1c01319b4c5487a1a0cdc85ca2ec1a))
* **onboarding:** the important-dates row label collapsed + remove button overflowed (18 §14.6) ([c3cc9b3](https://github.com/Highfivery/SelfOS/commit/c3cc9b3637dabe016aa2eefa2628bc7852506c95))
* **people:** remove the duplicated profile questions from the People editor (18 §14.6) ([f09cdf2](https://github.com/Highfivery/SelfOS/commit/f09cdf232ebfa6bddb8db9b2894adc71b9aec3a9))
* **questionnaires:** compat variants rewrite options with correct gender pronouns; sleek share card ([1ad9d49](https://github.com/Highfivery/SelfOS/commit/1ad9d4906f269167b1197a934c7e7a83bb842dca))
* **questionnaires:** compatibility variants ask about the OTHER participant (08 §17.12-E) ([758b92d](https://github.com/Highfivery/SelfOS/commit/758b92d5e7e13f49fb8f6b03654b53462803075d))
* **questionnaires:** drop test-on-yourself "Finish" from the sent (locked) preview ([7453d5a](https://github.com/Highfivery/SelfOS/commit/7453d5a9cae41e9beb9584e681a124dfe9a0644e))
* **questionnaires:** fix relay 404 (stale Worker) + make the link reachable after sending ([79841da](https://github.com/Highfivery/SelfOS/commit/79841dabf3c269ecea3386354b9c8874c19cbcb8))
* **questionnaires:** focused full-width builder — no orphaned empty space ([b8defd7](https://github.com/Highfivery/SelfOS/commit/b8defd749e6463dfd22228c9939460df2d77405c))
* **questionnaires:** make the send lifecycle visible — relay drain, sent badge, delete, draft save ([a275bd4](https://github.com/Highfivery/SelfOS/commit/a275bd446955561c47ad914465a0e1c03823a91b))
* **questionnaires:** share link re-shows the existing link; manual refresh regenerates ([af46172](https://github.com/Highfivery/SelfOS/commit/af4617215f98e9df8d5d3f69cad225ac9fc36490))
* **questionnaires:** surface a hint when a household send has no relay link (08 §17.13) ([9c82c48](https://github.com/Highfivery/SelfOS/commit/9c82c48beb1c46ac92d4c126b92a5717af0a03b4))
* **questionnaires:** surface relay-mint failures + lock sent questionnaires (read-only) ([e7d6df3](https://github.com/Highfivery/SelfOS/commit/e7d6df352054b6aefc7a6d132d2b1914c4237d5a))
* **questionnaires:** unified delivery for compatibility + re-publish/resend a relay link ([fa6651a](https://github.com/Highfivery/SelfOS/commit/fa6651aa837e5b5d1b73e66394bf9d6ecb1c60e2))
* **questionnaires:** warmer fallback for a nameless external compat recipient ([1f993ef](https://github.com/Highfivery/SelfOS/commit/1f993ef3fb7c4f288e0797ae5cb75566594e7807))

## [0.1.0](https://github.com/Highfivery/SelfOS/compare/v0.2.0...v0.1.0) (2026-06-17)


### Features

* **distribution:** automate versioning, macOS release builds & non-technical README ([6acc494](https://github.com/Highfivery/SelfOS/commit/6acc49485e51a0be1e708aac62f0f3533c868b4d))
* **memory:** living dashboard UI — filters, life-area groups, confidence, provenance (spec 20) ([868a6f4](https://github.com/Highfivery/SelfOS/commit/868a6f4bda36fa9441d5294acff721fe482ed1f5))
* **memory:** living insights engine — reconcile, flag, categories, keep-on-delete (spec 20) ([5e67761](https://github.com/Highfivery/SelfOS/commit/5e67761722ecccf889a1b8fef9d7edaab8452b1c))
* **onboarding:** cover every People field + structured dates (18 §14.6) ([73fbd5e](https://github.com/Highfivery/SelfOS/commit/73fbd5edb06dc6374a987bb124c7a511ced01757))
* **onboarding:** cultural/ethnic background is a multi-select with Other (18 §14.6) ([9e0781a](https://github.com/Highfivery/SelfOS/commit/9e0781a57e918d537d1d2bfa5ba0536500b2dbe3))
* **onboarding:** kids & pets conditional rosters via a new roster answer type (18 §14.6) ([86b3ad1](https://github.com/Highfivery/SelfOS/commit/86b3ad1a2b61e635cf65d04bb980fcbc18a9230b))
* **questionnaires:** household sends also mint a relay link (08 §17.13) ([82f292e](https://github.com/Highfivery/SelfOS/commit/82f292e0b8cce6e7e84b609b7a3cc04e4f3252aa))
* **relay:** attachRelayLink — mint a relay link for an in-app send + first-wins drain (08 §17.13) ([715f2b9](https://github.com/Highfivery/SelfOS/commit/715f2b994f6dab4cbb5a19c75552090397ac0c74))


### Bug Fixes

* **answering:** scale→slider, clean long prompts, full-width option cards ([517d503](https://github.com/Highfivery/SelfOS/commit/517d5032b00411a3f153e2904d9ee05305594a54))
* **memory:** scope insights:list to the active person — close the cross-user leak (spec 20 §1.1) ([aba6a60](https://github.com/Highfivery/SelfOS/commit/aba6a60321ec89598934ecb0ed49c8608b6e9fb3))
* **onboarding:** placeholders on all free-text questions; trim decisionStyle (18 §14.6) ([a983d54](https://github.com/Highfivery/SelfOS/commit/a983d541ad1c01319b4c5487a1a0cdc85ca2ec1a))
* **onboarding:** the important-dates row label collapsed + remove button overflowed (18 §14.6) ([c3cc9b3](https://github.com/Highfivery/SelfOS/commit/c3cc9b3637dabe016aa2eefa2628bc7852506c95))
* **people:** remove the duplicated profile questions from the People editor (18 §14.6) ([f09cdf2](https://github.com/Highfivery/SelfOS/commit/f09cdf232ebfa6bddb8db9b2894adc71b9aec3a9))
* **questionnaires:** compat variants rewrite options with correct gender pronouns; sleek share card ([1ad9d49](https://github.com/Highfivery/SelfOS/commit/1ad9d4906f269167b1197a934c7e7a83bb842dca))
* **questionnaires:** compatibility variants ask about the OTHER participant (08 §17.12-E) ([758b92d](https://github.com/Highfivery/SelfOS/commit/758b92d5e7e13f49fb8f6b03654b53462803075d))
* **questionnaires:** drop test-on-yourself "Finish" from the sent (locked) preview ([7453d5a](https://github.com/Highfivery/SelfOS/commit/7453d5a9cae41e9beb9584e681a124dfe9a0644e))
* **questionnaires:** fix relay 404 (stale Worker) + make the link reachable after sending ([79841da](https://github.com/Highfivery/SelfOS/commit/79841dabf3c269ecea3386354b9c8874c19cbcb8))
* **questionnaires:** focused full-width builder — no orphaned empty space ([b8defd7](https://github.com/Highfivery/SelfOS/commit/b8defd749e6463dfd22228c9939460df2d77405c))
* **questionnaires:** make the send lifecycle visible — relay drain, sent badge, delete, draft save ([a275bd4](https://github.com/Highfivery/SelfOS/commit/a275bd446955561c47ad914465a0e1c03823a91b))
* **questionnaires:** share link re-shows the existing link; manual refresh regenerates ([af46172](https://github.com/Highfivery/SelfOS/commit/af4617215f98e9df8d5d3f69cad225ac9fc36490))
* **questionnaires:** surface a hint when a household send has no relay link (08 §17.13) ([9c82c48](https://github.com/Highfivery/SelfOS/commit/9c82c48beb1c46ac92d4c126b92a5717af0a03b4))
* **questionnaires:** surface relay-mint failures + lock sent questionnaires (read-only) ([e7d6df3](https://github.com/Highfivery/SelfOS/commit/e7d6df352054b6aefc7a6d132d2b1914c4237d5a))
* **questionnaires:** unified delivery for compatibility + re-publish/resend a relay link ([fa6651a](https://github.com/Highfivery/SelfOS/commit/fa6651aa837e5b5d1b73e66394bf9d6ecb1c60e2))
* **questionnaires:** warmer fallback for a nameless external compat recipient ([1f993ef](https://github.com/Highfivery/SelfOS/commit/1f993ef3fb7c4f288e0797ae5cb75566594e7807))


### Miscellaneous Chores

* release as 0.1.0 ([36c3dff](https://github.com/Highfivery/SelfOS/commit/36c3dffdcff2565d72a698ef9579b0683146190c))

## [0.2.0](https://github.com/Highfivery/SelfOS/compare/v0.1.0...v0.2.0) (2026-06-17)


### Features

* **memory:** living dashboard UI — filters, life-area groups, confidence, provenance (spec 20) ([868a6f4](https://github.com/Highfivery/SelfOS/commit/868a6f4bda36fa9441d5294acff721fe482ed1f5))
* **memory:** living insights engine — reconcile, flag, categories, keep-on-delete (spec 20) ([5e67761](https://github.com/Highfivery/SelfOS/commit/5e67761722ecccf889a1b8fef9d7edaab8452b1c))
* **onboarding:** cover every People field + structured dates (18 §14.6) ([73fbd5e](https://github.com/Highfivery/SelfOS/commit/73fbd5edb06dc6374a987bb124c7a511ced01757))
* **onboarding:** cultural/ethnic background is a multi-select with Other (18 §14.6) ([9e0781a](https://github.com/Highfivery/SelfOS/commit/9e0781a57e918d537d1d2bfa5ba0536500b2dbe3))
* **onboarding:** kids & pets conditional rosters via a new roster answer type (18 §14.6) ([86b3ad1](https://github.com/Highfivery/SelfOS/commit/86b3ad1a2b61e635cf65d04bb980fcbc18a9230b))
* **questionnaires:** household sends also mint a relay link (08 §17.13) ([82f292e](https://github.com/Highfivery/SelfOS/commit/82f292e0b8cce6e7e84b609b7a3cc04e4f3252aa))
* **relay:** attachRelayLink — mint a relay link for an in-app send + first-wins drain (08 §17.13) ([715f2b9](https://github.com/Highfivery/SelfOS/commit/715f2b994f6dab4cbb5a19c75552090397ac0c74))


### Bug Fixes

* **answering:** scale→slider, clean long prompts, full-width option cards ([517d503](https://github.com/Highfivery/SelfOS/commit/517d5032b00411a3f153e2904d9ee05305594a54))
* **memory:** scope insights:list to the active person — close the cross-user leak (spec 20 §1.1) ([aba6a60](https://github.com/Highfivery/SelfOS/commit/aba6a60321ec89598934ecb0ed49c8608b6e9fb3))
* **onboarding:** placeholders on all free-text questions; trim decisionStyle (18 §14.6) ([a983d54](https://github.com/Highfivery/SelfOS/commit/a983d541ad1c01319b4c5487a1a0cdc85ca2ec1a))
* **onboarding:** the important-dates row label collapsed + remove button overflowed (18 §14.6) ([c3cc9b3](https://github.com/Highfivery/SelfOS/commit/c3cc9b3637dabe016aa2eefa2628bc7852506c95))
* **people:** remove the duplicated profile questions from the People editor (18 §14.6) ([f09cdf2](https://github.com/Highfivery/SelfOS/commit/f09cdf232ebfa6bddb8db9b2894adc71b9aec3a9))
* **questionnaires:** compat variants rewrite options with correct gender pronouns; sleek share card ([1ad9d49](https://github.com/Highfivery/SelfOS/commit/1ad9d4906f269167b1197a934c7e7a83bb842dca))
* **questionnaires:** compatibility variants ask about the OTHER participant (08 §17.12-E) ([758b92d](https://github.com/Highfivery/SelfOS/commit/758b92d5e7e13f49fb8f6b03654b53462803075d))
* **questionnaires:** drop test-on-yourself "Finish" from the sent (locked) preview ([7453d5a](https://github.com/Highfivery/SelfOS/commit/7453d5a9cae41e9beb9584e681a124dfe9a0644e))
* **questionnaires:** fix relay 404 (stale Worker) + make the link reachable after sending ([79841da](https://github.com/Highfivery/SelfOS/commit/79841dabf3c269ecea3386354b9c8874c19cbcb8))
* **questionnaires:** focused full-width builder — no orphaned empty space ([b8defd7](https://github.com/Highfivery/SelfOS/commit/b8defd749e6463dfd22228c9939460df2d77405c))
* **questionnaires:** make the send lifecycle visible — relay drain, sent badge, delete, draft save ([a275bd4](https://github.com/Highfivery/SelfOS/commit/a275bd446955561c47ad914465a0e1c03823a91b))
* **questionnaires:** share link re-shows the existing link; manual refresh regenerates ([af46172](https://github.com/Highfivery/SelfOS/commit/af4617215f98e9df8d5d3f69cad225ac9fc36490))
* **questionnaires:** surface a hint when a household send has no relay link (08 §17.13) ([9c82c48](https://github.com/Highfivery/SelfOS/commit/9c82c48beb1c46ac92d4c126b92a5717af0a03b4))
* **questionnaires:** surface relay-mint failures + lock sent questionnaires (read-only) ([e7d6df3](https://github.com/Highfivery/SelfOS/commit/e7d6df352054b6aefc7a6d132d2b1914c4237d5a))
* **questionnaires:** unified delivery for compatibility + re-publish/resend a relay link ([fa6651a](https://github.com/Highfivery/SelfOS/commit/fa6651aa837e5b5d1b73e66394bf9d6ecb1c60e2))
* **questionnaires:** warmer fallback for a nameless external compat recipient ([1f993ef](https://github.com/Highfivery/SelfOS/commit/1f993ef3fb7c4f288e0797ae5cb75566594e7807))

## 0.1.0 (2026-06-16)


### Features

* **distribution:** automate versioning, macOS release builds & non-technical README ([6acc494](https://github.com/Highfivery/SelfOS/commit/6acc49485e51a0be1e708aac62f0f3533c868b4d))


### Miscellaneous Chores

* release as 0.1.0 ([36c3dff](https://github.com/Highfivery/SelfOS/commit/36c3dffdcff2565d72a698ef9579b0683146190c))
