# Changelog

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
