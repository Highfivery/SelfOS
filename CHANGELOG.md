# Changelog

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
