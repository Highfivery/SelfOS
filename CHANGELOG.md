# Changelog

## [0.1.0](https://github.com/Highfivery/SelfOS/compare/v0.3.0...v0.1.0) (2026-06-22)


### Features

* **access:** owner-only settings sections + gallery; move vault control into account menu ([a72c269](https://github.com/Highfivery/SelfOS/commit/a72c269b8d71826db55865072784c8bf6a47ee6c))
* **ai:** add encrypted API key, model setting, and Claude proxy ([2e0301b](https://github.com/Highfivery/SelfOS/commit/2e0301b78736cf7e1810fb01400517b8f32f6af1))
* **ai:** household-shared AI credentials so members inherit the owner's key ([c639dab](https://github.com/Highfivery/SelfOS/commit/c639dab2759c47ff709ec270f19faae8410a6702))
* **answering:** pills + placeholders + "Other" write-in + accordion grouping ([d3443ce](https://github.com/Highfivery/SelfOS/commit/d3443ce580d0b6a985fbe47cf08e9c9644ca24e2))
* **chat:** add the streaming chat backend ([b14d263](https://github.com/Highfivery/SelfOS/commit/b14d26372eb65ea613119088b858176309c76fb5))
* **chat:** add the streaming chat UI ([04a182c](https://github.com/Highfivery/SelfOS/commit/04a182c60142cde9f80654245fa60f0e348e9400))
* **chat:** polish — rename, thinking indicator, settings shortcut, a11y ([725949f](https://github.com/Highfivery/SelfOS/commit/725949fb6b5e371c2178edda2f99196426c991c0))
* **core:** dreams schema, capabilities & dreamService (12 §13.1) ([cd58aa0](https://github.com/Highfivery/SelfOS/commit/cd58aa0f20a91c58155fa18504bc3a90dde3dfc6))
* **core:** insight/metrics layer foundation for questionnaires (slice 1a) ([f325a48](https://github.com/Highfivery/SelfOS/commit/f325a48cca875bde74e272507dacf1f12598cdab))
* **core:** questionnaire engine — schemas + services (slice 1b) ([e6375ed](https://github.com/Highfivery/SelfOS/commit/e6375ed348f2e75a78fffe69b2ae9eb159df0e62))
* **design-system:** add primitive components and a dev gallery ([fe3588a](https://github.com/Highfivery/SelfOS/commit/fe3588acf7625a277267844f9b4bebfb46ae30a1))
* **desktop:** author-attached question images (08 §13.2 — completes the builder follow-ups) ([3b91666](https://github.com/Highfivery/SelfOS/commit/3b91666ba8f0313791319343571cb3cffdcbe671))
* **desktop:** bootstrap secure themed window and test harness ([71cedd0](https://github.com/Highfivery/SelfOS/commit/71cedd090393a3cbd9b00535a57d195b12972582))
* **desktop:** expose the questionnaire engine over IPC ([46b4fe7](https://github.com/Highfivery/SelfOS/commit/46b4fe7cc6399c98667d8f1f45da7a27b3129574))
* **desktop:** questionnaire builder authoring editors (08 §13.2) ([998477c](https://github.com/Highfivery/SelfOS/commit/998477ce0c302a9537e6859948c69b242c0b5174))
* **desktop:** questionnaire builder UI (author/validate/save) ([57ed97c](https://github.com/Highfivery/SelfOS/commit/57ed97c1fe8de65bad1d95199e4845e8cb9bb60e))
* **desktop:** questionnaire preview / test-on-self + shared answering renderer (08 §13.2) ([5402730](https://github.com/Highfivery/SelfOS/commit/54027307bb8a7212ec28e120348e01d9155942ac))
* **devices:** device registry — slice A of spec 28 ([cc64c76](https://github.com/Highfivery/SelfOS/commit/cc64c765ab537c1b2fddb8cbc5e3ba6984a00b42))
* **devices:** key rotation — slice B of spec 28 (revocation by re-encryption) ([128935c](https://github.com/Highfivery/SelfOS/commit/128935cc3297ba588e0cec2a5d8925f762d7003c))
* **devices:** owner Devices settings section — slice C of spec 28 ([e142f61](https://github.com/Highfivery/SelfOS/commit/e142f61e238e5fd4a9e74f4b4b001cec4fdf7e22))
* **distribution:** automate versioning, macOS release builds & non-technical README ([6acc494](https://github.com/Highfivery/SelfOS/commit/6acc49485e51a0be1e708aac62f0f3533c868b4d))
* **dreams:** analysis IPC seam — analyze/synthesize/edit/approve (12 §13.3/3b) ([885f898](https://github.com/Highfivery/SelfOS/commit/885f898f12b7fe652e6c313a7d3763918c9e8f8f))
* **dreams:** capture + journal UI, nav & settings (12 §13.2) ([b283a70](https://github.com/Highfivery/SelfOS/commit/b283a707aab074b6bc77b0ef6e3d0ea37bc52f85))
* **dreams:** dream image panel renderer + generate e2e (slice 4) ([cb86814](https://github.com/Highfivery/SelfOS/commit/cb8681402786cd0e02e043d3b370119077e6bc5e))
* **dreams:** guided-analysis backend — chat, synthesize, approve (12 §13.3/3a) ([ed446b0](https://github.com/Highfivery/SelfOS/commit/ed446b0da28ee692e0a985c2917b96f5a69eaf11))
* **dreams:** guided-analysis UI — chat, synthesis card, approve (12 §13.3/3c) ([6b43ef9](https://github.com/Highfivery/SelfOS/commit/6b43ef99c9052425f181d67d23d452486555589a))
* **dreams:** image core backend (dream-images slice 2) ([8057b1b](https://github.com/Highfivery/SelfOS/commit/8057b1b366370a1fdc4bd4523841ffba674bea65))
* **dreams:** image export + per-dream sharing (slice 5) ([4e7131c](https://github.com/Highfivery/SelfOS/commit/4e7131c5e2503fc4cd15ea9ce726d1918f409800))
* **dreams:** image IPC seam + settings + capability (slice 3) ([2263fcc](https://github.com/Highfivery/SelfOS/commit/2263fcc6677909b1da662286debbbf7d431e7364))
* **dreams:** link "people present" to the People graph for richer analysis (12 §3.1/§5.1) ([b9beb3d](https://github.com/Highfivery/SelfOS/commit/b9beb3dcf45bc86d5191dc50efc5a85d4070245e))
* **dreams:** merge the Dreams feature (spec 12, §13.1–§13.5) into main ([bd3a55c](https://github.com/Highfivery/SelfOS/commit/bd3a55c832d7d2fe7bcf69a5161ee5d64ddd64d9))
* **dreams:** patterns backend — stats, nightmare nudge, narrative (12 §13.4/4a) ([20b29ba](https://github.com/Highfivery/SelfOS/commit/20b29ba50b11f2ad59f694111e26c8dee9d49fb4))
* **dreams:** patterns UI — charts, nightmare nudge, narrative (12 §13.4/4b) ([9ae278b](https://github.com/Highfivery/SelfOS/commit/9ae278b54e103583a7fdf53e9cd66f78940614db))
* **dreams:** per-dream sharing backend — per-person fact targeting (12 §13.5/5a) ([7f2678f](https://github.com/Highfivery/SelfOS/commit/7f2678f831fed168e13610e2f2b82877607f34ea))
* **dreams:** per-dream sharing UI — share controls on the analysis card (12 §13.5/5b) ([4f34026](https://github.com/Highfivery/SelfOS/commit/4f340269917e4ef3adc0f05de1602e03942e987a))
* **dreams:** richer image style — grouped presets + free-text style notes ([023388c](https://github.com/Highfivery/SelfOS/commit/023388cc324b9c0a532658141417747489aec6a5))
* **home:** per-person card dashboard (app-refresh package G, spec 17) ([22ba5a9](https://github.com/Highfivery/SelfOS/commit/22ba5a9ed1efec75fa474ca76dc0e1784d2563cc))
* **housekeeping:** spec 29 slice C — iOS sync-conflict detection ([f975ae3](https://github.com/Highfivery/SelfOS/commit/f975ae3912f09a2fe74782940930c2f491d29403))
* **housekeeping:** spec 29 slice D — sync-safety warning at first-run setup ([19d113e](https://github.com/Highfivery/SelfOS/commit/19d113e0d8206b532b0b5168542295e4ed555582))
* **housekeeping:** spec 29 slices A + B — spec-10 doc cleanup + OpenAI test connection ([7ba5aed](https://github.com/Highfivery/SelfOS/commit/7ba5aed89bf587be0f08b232014ed254fcc22f1b))
* **intake:** also cut swallowSpit + cumWhere from intimacy (61 → 40) ([32f7b0b](https://github.com/Highfivery/SelfOS/commit/32f7b0bcfaa2f26344d4573b6886dd8d1edf15f5))
* **intake:** comprehensive + pinned portrait, and a deterministic staleness signal ([1640ae7](https://github.com/Highfivery/SelfOS/commit/1640ae710e028cab13228a37124066623f8d5db1))
* **intake:** deepen every non-intimacy section toward intimacy's depth ([6c96f92](https://github.com/Highfivery/SelfOS/commit/6c96f92ce63d9c249c32a990ceac595d0b10d42a))
* **intake:** progressive profile depth invitations (spec 29) ([2aa034d](https://github.com/Highfivery/SelfOS/commit/2aa034da847e4558a4591a6fd5afef0595584e4d))
* **intake:** rebalance intimacy block 100→61, kept explicit (spec 27) ([284083f](https://github.com/Highfivery/SelfOS/commit/284083fa5b6e1cdb6a1aad8f707f273782478ce7))
* **intake:** redesign onboarding catalog — cut non-intimacy 392→126 (spec 26) ([053dcf3](https://github.com/Highfivery/SelfOS/commit/053dcf3be0bed85b71cc0522b5574984e3dd1c62))
* **intake:** richer, smarter intimacy questions — conditionals, sliders, casual wording ([232c11a](https://github.com/Highfivery/SelfOS/commit/232c11a56873566c5ea504e8083bf873b5bef1ca))
* **intake:** slice 28a — slider-seed fix + portrait fact cap (spec 28) ([e66c0a0](https://github.com/Highfivery/SelfOS/commit/e66c0a0af33b273b7e64fb30fbc860df56040c91))
* **intake:** slice 28b — topic-relevance portrait selection (spec 28) ([a96de09](https://github.com/Highfivery/SelfOS/commit/a96de0916cdb2df4fcc4c417eb4f6a429a5852b3))
* **intake:** trim intimacy block 61 → 42 + opt-in specifics gate (spec 27 §4.3) ([6bd9d8f](https://github.com/Highfivery/SelfOS/commit/6bd9d8fe4107cd1904eff47e6cebcc0679de248d))
* **invites:** member redeem flow + persisted-resume safety (slice 2b) ([a2c3fac](https://github.com/Highfivery/SelfOS/commit/a2c3facb770647990b288a0f13322051122a7f6b))
* **invites:** owner-side member invite codes (slice 2a) ([66303fe](https://github.com/Highfivery/SelfOS/commit/66303fe2a92c3abf887dcccb41348c4ca37634b2))
* **ios:** live vault change feed via NSFilePresenter (Capacitor iii-b3b) ([8db8e82](https://github.com/Highfivery/SelfOS/commit/8db8e828fc8a0fcbd48e82c03ec121771c1781c8))
* **ios:** native Keychain SecretStore (Capacitor iii-c1) ([2ba2a37](https://github.com/Highfivery/SelfOS/commit/2ba2a37955662c0f1040508dd3b2cba8ddd40629))
* **ios:** real Claude via browser-mode SDK (Capacitor iii-c2) ([50030f5](https://github.com/Highfivery/SelfOS/commit/50030f5fd316371cf3ffbffd0916ab8db36ce905))
* **ios:** scaffold Capacitor + a standalone web build (slice iii-a) ([4bc9662](https://github.com/Highfivery/SelfOS/commit/4bc9662219f36152f7990b54aa4876a50545d3dc))
* **memory:** living dashboard UI — filters, life-area groups, confidence, provenance (spec 20) ([868a6f4](https://github.com/Highfivery/SelfOS/commit/868a6f4bda36fa9441d5294acff721fe482ed1f5))
* **memory:** living insights engine — reconcile, flag, categories, keep-on-delete (spec 20) ([5e67761](https://github.com/Highfivery/SelfOS/commit/5e67761722ecccf889a1b8fef9d7edaab8452b1c))
* **onboarding:** add a discoverable "Switch person" button in onboarding ([be3a085](https://github.com/Highfivery/SelfOS/commit/be3a085c08f30b9f58cd36b7887e836127e9a72e))
* **onboarding:** add AI-guided personal onboarding intake (spec 18) ([7dd3204](https://github.com/Highfivery/SelfOS/commit/7dd3204a3da8b3922dfa0c36aa8573d2887efa7d))
* **onboarding:** add promoted intake Person fields (spec 18 §14.6, slice 1) ([1398c4d](https://github.com/Highfivery/SelfOS/commit/1398c4de0a2ac78c3ed3517e03199448532507f7))
* **onboarding:** consistent sliders, fix multi-Other spaces, consolidate intake + People editor ([890d4b8](https://github.com/Highfivery/SelfOS/commit/890d4b84e61aca6ba7c816a29982654ad9d87a42))
* **onboarding:** content audit + expansion — options, positions, groups, placeholders ([d3c8291](https://github.com/Highfivery/SelfOS/commit/d3c8291ced63e13f8e93239da926c6783287a559))
* **onboarding:** cover every People field + structured dates (18 §14.6) ([73fbd5e](https://github.com/Highfivery/SelfOS/commit/73fbd5edb06dc6374a987bb124c7a511ced01757))
* **onboarding:** cultural/ethnic background is a multi-select with Other (18 §14.6) ([9e0781a](https://github.com/Highfivery/SelfOS/commit/9e0781a57e918d537d1d2bfa5ba0536500b2dbe3))
* **onboarding:** every section is a form + section-level go-deeper; resume to the open section ([f35e808](https://github.com/Highfivery/SelfOS/commit/f35e808331e52d2f8e16f06a9f7d364e64113254))
* **onboarding:** flesh out non-intimacy sections + add Work & money / Joy & play ([d66c9ae](https://github.com/Highfivery/SelfOS/commit/d66c9ae338e7f0ee4bc3b84066f541bc3ae77cab))
* **onboarding:** hybrid form/chat intake — core (spec 18 §14, slice 1) ([9860343](https://github.com/Highfivery/SelfOS/commit/98603437b5b1e218531f7cc428ade9883a176343))
* **onboarding:** hybrid form/chat intake — renderer (spec 18 §14, slice 2) ([eceda22](https://github.com/Highfivery/SelfOS/commit/eceda22489ca4109d829d9faf4aefd51d3c0889c))
* **onboarding:** kids & pets conditional rosters via a new roster answer type (18 §14.6) ([86b3ad1](https://github.com/Highfivery/SelfOS/commit/86b3ad1a2b61e635cf65d04bb980fcbc18a9230b))
* **onboarding:** offer "Tell me more" go-deeper on every form section ([9ca234f](https://github.com/Highfivery/SelfOS/commit/9ca234f87d76194626daf49a615cf4e51e2c0a21))
* **onboarding:** progress bar + per-card counts + a completed-section "Update" state ([8e80719](https://github.com/Highfivery/SelfOS/commit/8e8071984b929e2d4c6393f6b16b8c233d11e484))
* **onboarding:** revisitable core 'essentials' grid, portrait confirm modal, staleness nudge ([5edd976](https://github.com/Highfivery/SelfOS/commit/5edd976be6a844b83db7efe9ef35657bef7e6669))
* **onboarding:** self-maintaining profile — drift detection (spec 18 §15, slice 3) ([c8cda5a](https://github.com/Highfivery/SelfOS/commit/c8cda5a87cbff9bb9cf7f786caad4e3892cd7b70))
* **onboarding:** wire go-deeper chat + surface promoted fields in People editor ([dd41907](https://github.com/Highfivery/SelfOS/commit/dd41907773582274d83f040ffb9b69445fe33caf))
* **people:** add crypto + people/relationship/access data foundation ([6309abb](https://github.com/Highfivery/SelfOS/commit/6309abbc01c38e326d5bf86203d1a0f01b890433))
* **people:** add first-run household setup + active person ([f2a140b](https://github.com/Highfivery/SelfOS/commit/f2a140b48fcdcef75dd919c7dbbf8f0c7969fd7d))
* **people:** add people + relationship management UI ([13abc6a](https://github.com/Highfivery/SelfOS/commit/13abc6aa87c3993cb0f2a0c51423f1303b566b92))
* **people:** add shareable-vs-private context and buildContext ([2290e75](https://github.com/Highfivery/SelfOS/commit/2290e75cbc5d0e6058a6bb9b949f323e52279c4e))
* **people:** add the concealed super-admin unlock ([94a03c5](https://github.com/Highfivery/SelfOS/commit/94a03c559a61438668a8e830e23ed45955806fec))
* **people:** add the owner-editable role × capability matrix ([1526875](https://github.com/Highfivery/SelfOS/commit/15268759add1326e7a1ae6c3a76f572fa00d0306))
* **people:** add who's-here switcher, access grants, and capability gating ([c044fa0](https://github.com/Highfivery/SelfOS/commit/c044fa05669665dc262b6f75256392a74ea2d2e5))
* **people:** descriptive profile fields (dream-images slice 1) ([07112c5](https://github.com/Highfivery/SelfOS/commit/07112c5c7922f9d9215e9ead139c270fa835e338))
* **people:** per-person budgets on a tabbed, scalable person page ([0639142](https://github.com/Highfivery/SelfOS/commit/0639142f1dd7aedee1c791514907686a5995833f))
* **platform:** iOS in-webview host + browser verification (Capacitor iii-b2) ([4283004](https://github.com/Highfivery/SelfOS/commit/4283004985b0b76100899c6864c2afde911974b6))
* **platform:** native VaultFs iCloud plugin + TS adapter (Capacitor iii-b3) ([7de16ab](https://github.com/Highfivery/SelfOS/commit/7de16abc706176a1a440d5509f5ddb8f50160820))
* **questionnaires:** "Other" free-text write-in on choice questions (08 §17.12-C) ([771d8de](https://github.com/Highfivery/SelfOS/commit/771d8de6e012f7ea8768970949bd0fd38fb510d1))
* **questionnaires:** AI generate + gap-finder + context-provider registry (08 §13.3) ([df02992](https://github.com/Highfivery/SelfOS/commit/df0299204950cdf41f90d1277f921e2348a164fa))
* **questionnaires:** analyze -&gt; Insights + the Memory surface (08 §13.4) ([7946b52](https://github.com/Highfivery/SelfOS/commit/7946b5280673388b19df87a7a9a528f6360752da))
* **questionnaires:** authoring-UX refinements (08 §15, app-refresh D) ([c0c2142](https://github.com/Highfivery/SelfOS/commit/c0c21422e7b80af381178a192f4e6a1b4a18b6e4))
* **questionnaires:** bind every questionnaire to one recipient, chosen first (08 §17.3) ([22d4869](https://github.com/Highfivery/SelfOS/commit/22d486974276395e56683ef21b63e64441c63f60))
* **questionnaires:** close-out — cut QR, fix recipient image gating, editable delivery templates ([7a94d6a](https://github.com/Highfivery/SelfOS/commit/7a94d6a7fa23b707fc08bbcb80c287311e0bdc15))
* **questionnaires:** compatibility "you + someone else" participant model (08 §16.1) ([5e3a2df](https://github.com/Highfivery/SelfOS/commit/5e3a2df826dc92ead6331fd29abde23c602f9976))
* **questionnaires:** compatibility = you + the bound recipient, no Send-time picker (08 §17.12-B) ([4a0255c](https://github.com/Highfivery/SelfOS/commit/4a0255c7fa73456f93486206b1bd0bb475f1c500))
* **questionnaires:** compatibility mode — variants, alignment, break-glass + audit (08 §13.5d) ([3e8d29c](https://github.com/Highfivery/SelfOS/commit/3e8d29c2f3a6e3f6cc7cbde88b91438ac9a68c14))
* **questionnaires:** context-only compatibility mode (08 §16.2) ([1d2e3a0](https://github.com/Highfivery/SelfOS/commit/1d2e3a03fb54ede60ac545c3d8c2d9a039456c30))
* **questionnaires:** drop the About-a-person picker; auto-tailor AI to the recipient (08 §17.12-A) ([d415251](https://github.com/Highfivery/SelfOS/commit/d41525101a6c2cda65ce1f8f8be0de9e39238664))
* **questionnaires:** explicit-starter fallback + one-at-a-time topic add (08 §16.5b) ([5d8c149](https://github.com/Highfivery/SelfOS/commit/5d8c14932923df874daa9b3877cbb4dea57625b1))
* **questionnaires:** external compatibility — send side (08 §17.12-B) ([fb5b7a7](https://github.com/Highfivery/SelfOS/commit/fb5b7a70a99707ca736fc7f67b56469d277236bb))
* **questionnaires:** external zero-knowledge Cloudflare relay (08 §13.6) ([051d4ea](https://github.com/Highfivery/SelfOS/commit/051d4ea597445be9c0e0799da3e683e36def84d5))
* **questionnaires:** household sends also mint a relay link (08 §17.13) ([82f292e](https://github.com/Highfivery/SelfOS/commit/82f292e0b8cce6e7e84b609b7a3cc04e4f3252aa))
* **questionnaires:** in-app send + Inbox answer loop (08 §13.5a) ([dfbb2ff](https://github.com/Highfivery/SelfOS/commit/dfbb2ff7f6c8312f00494e9af161839758fab33a))
* **questionnaires:** in-policy sexual-wellness explicit framing; remove §16.5b fallback (08 §17.2) ([b1d92f9](https://github.com/Highfivery/SelfOS/commit/b1d92f931d708b5f0f1d1a2417b571e00d72078f))
* **questionnaires:** intimacy Draft-with-AI generate-mode (questions/scenarios/mix) (08 §17.12-C) ([b25b0f2](https://github.com/Highfivery/SelfOS/commit/b25b0f248ff1861d71bb8ec97fe0fe781743728a))
* **questionnaires:** never disclose owner/admin access to users (08 §16.6) ([0d06b67](https://github.com/Highfivery/SelfOS/commit/0d06b6743dc415494da29b79fc784e6ef03b60ee))
* **questionnaires:** owner-extensible intimacy-topics UI (08 §16.5a) — §16 complete ([2e1e1f4](https://github.com/Highfivery/SelfOS/commit/2e1e1f434938ac05470cc250fa3a4bbb8e93ebc5))
* **questionnaires:** per-question trends + deletion/purge (08 §13.5c) ([7058298](https://github.com/Highfivery/SelfOS/commit/70582981d6f88ded765e3d550b57fc7537ea3257))
* **questionnaires:** question-image GC — orphan reap + purge-on-delete (08 §13.2) ([85fe308](https://github.com/Highfivery/SelfOS/commit/85fe308833b3b4fedf6b9277405f7c6f16d745ca))
* **questionnaires:** recipient-aware de-dup generation (08 §17.4) ([4803103](https://github.com/Highfivery/SelfOS/commit/480310341d2fd095847cc2c716929b45f34f6015))
* **questionnaires:** save→send two-step + title below AI + AI-suggested title (08 §16.3/§16.4) ([2b7dca0](https://github.com/Highfivery/SelfOS/commit/2b7dca04399ba41309bfd3a17243ccc655f494f4))
* **questionnaires:** sender Results view + live Analyze + autoAnalyze (08 §13.5b) ([10b2da3](https://github.com/Highfivery/SelfOS/commit/10b2da38efc91fa4e8b4f5474704d870fca8bf76))
* **questionnaires:** share an external compatibility report from Results (08 §17.12-D) ([e85902d](https://github.com/Highfivery/SelfOS/commit/e85902d019a9e1bf561e545a3b0dc59aff992e39))
* **questionnaires:** tier-distinct explicit generation + shared INTIMACY_TOPICS (08 §16.5/§16.5a) ([4727186](https://github.com/Highfivery/SelfOS/commit/47271865d5652069f8e3f3b170d6855af3d50741))
* **relay:** attachRelayLink — mint a relay link for an in-app send + first-wins drain (08 §17.13) ([715f2b9](https://github.com/Highfivery/SelfOS/commit/715f2b994f6dab4cbb5a19c75552090397ac0c74))
* **relay:** outcome states on the answering page — report / waiting (08 §17.12-D) ([3cecda0](https://github.com/Highfivery/SelfOS/commit/3cecda01102e813b613dfa280965bd530485afe5))
* **relay:** sealed outcome write-back primitives — crypto, mailbox, client (08 §17.12-D) ([5f2128f](https://github.com/Highfivery/SelfOS/commit/5f2128f7e4249c40db610289cce2e2ded1224828))
* **responsive:** one responsive codebase — drawer nav, master-detail, mobile guards ([cea4ae3](https://github.com/Highfivery/SelfOS/commit/cea4ae34386e588505916f81712424e6188b421a))
* **sessions:** guided sessions launcher, curated catalog & AI suggestions (spec 16) ([ac43826](https://github.com/Highfivery/SelfOS/commit/ac438269d93849cc61437c3e9fc173a4a43c0f1d))
* **sessions:** session lifecycle, End & summarize, and per-session cost (spec 09) ([54a8887](https://github.com/Highfivery/SelfOS/commit/54a8887331c1cf7e7b8619e1374b85a0209d2bf8))
* **settings:** add schema-driven settings system and UI ([bd33f04](https://github.com/Highfivery/SelfOS/commit/bd33f0493552766388e9e50342a794052aacec99))
* **settings:** enforce the settings-write trust boundary in the bridge ([b2292ab](https://github.com/Highfivery/SelfOS/commit/b2292ab94147fdf83fc4de71a40f034308544dcf))
* **setup:** require an owner PIN at first-run setup (slice 1c) ([2c3d916](https://github.com/Highfivery/SelfOS/commit/2c3d91671165d7331d4821c423470fbb3b8b999a))
* **shareability:** unified per-item "may inform others" control (package A) ([834606c](https://github.com/Highfivery/SelfOS/commit/834606c52a261b2f320b9c0de194ae58f70c17b8))
* **shell:** integrated AppHeader titlebar, TitlebarControl & enriched usage dropdown ([826d8c4](https://github.com/Highfivery/SelfOS/commit/826d8c42a780aed6a7955cd12493339aabc23bc1))
* **shell:** modernize the app-shell chrome — brand, TopBar controls, lock, rail ([47705d8](https://github.com/Highfivery/SelfOS/commit/47705d8ce1e490eb4bca98b2d062fddd5c9a8b21))
* **ui:** add an AdminOnlyBadge marker and apply it to all admin-gated UI ([8b758d7](https://github.com/Highfivery/SelfOS/commit/8b758d7a8a92d7bae805d8c71a0f60301d8553c3))
* **usage:** add the AI usage, pricing & budget core ([cbbdd45](https://github.com/Highfivery/SelfOS/commit/cbbdd4553b5ba8f3099d32fd7654320b00f1a85f))
* **usage:** add the usage dashboard and budget settings UI ([0b89bc3](https://github.com/Highfivery/SelfOS/commit/0b89bc3b2b7181f58014889007406175276b05ad))
* **usage:** admin usage by person — picker + by-person breakdown ([222bcc3](https://github.com/Highfivery/SelfOS/commit/222bcc3a0625f39325ce605f099bf0fd58e5f1ee))
* **usage:** admin-only budgets, a global usage header, and no cost for users ([f1229ed](https://github.com/Highfivery/SelfOS/commit/f1229ed001e503c680cc4d7591aaea30a762f076))
* **usage:** compact top-bar usage ring with a quick-stats popover ([e878bd5](https://github.com/Highfivery/SelfOS/commit/e878bd5c7689ea5c7ffb30c13a3b7f5fd23b0429))
* **vault:** add vault service and first-run boot/onboarding ([3b3e07b](https://github.com/Highfivery/SelfOS/commit/3b3e07bdac51ace7cfb0cff804797b49e8877d03))
* **vault:** change-vault settings control + dialog (relinking slice 2) ([3760220](https://github.com/Highfivery/SelfOS/commit/3760220bf42ddd67fc82abb0fd049bf098793e13))
* **vault:** harden the vault — migrations, watching, conflicts, window state ([dda6f14](https://github.com/Highfivery/SelfOS/commit/dda6f1431653b5cb758db611379b0189b6c6f624))
* **vault:** move the super-admin secret into the vault + migration (slice 1b) ([c299a04](https://github.com/Highfivery/SelfOS/commit/c299a04db0afa5c2ae07ac05dd0cb072cf60e2c0))
* **vault:** multi-device safety fix + recovery-phrase unlock (slice 1a) ([8a30eb2](https://github.com/Highfivery/SelfOS/commit/8a30eb20b3faa3483a30d611fc3f552f98f31227))
* **vault:** unlink-backed "use a different vault" on the error screen (slice 3) ([30d8e28](https://github.com/Highfivery/SelfOS/commit/30d8e28a7ccd5dd13fa40e8884c79c1efb0acb19))
* **vault:** vault:unlink backend op + IPC seam (relinking slice 1) ([fd8d942](https://github.com/Highfivery/SelfOS/commit/fd8d9426a12fea4b77e32ffa701ef3bdb8b93550))


### Bug Fixes

* **answering:** never collapse form groups by default — hid questions at section bottom ([2525ee3](https://github.com/Highfivery/SelfOS/commit/2525ee3c17612bad8057496a6fb68eaa61b6d351))
* **answering:** scale→slider, clean long prompts, full-width option cards ([517d503](https://github.com/Highfivery/SelfOS/commit/517d5032b00411a3f153e2904d9ee05305594a54))
* **app:** gate the app name so dev uses a separate userData ([5babdf8](https://github.com/Highfivery/SelfOS/commit/5babdf8605a110175d09a0381b0db7a7360a272c))
* **capabilities:** remove unbuilt questionnaires capabilities ([b973036](https://github.com/Highfivery/SelfOS/commit/b973036f127a9e5beb80a0f64fe4b95272caf592))
* **core:** make at-rest crypto typecheck under the WebView DOM lib ([e45b6e7](https://github.com/Highfivery/SelfOS/commit/e45b6e7ea23264c22a35ad172d483acdc464192a))
* **design:** stop the Switch shrinking so its thumb stays on-track ([f80e02e](https://github.com/Highfivery/SelfOS/commit/f80e02e7ce5a3ac3819325dba200c884fe721ad3))
* **intake:** reveal intimacy conditionals under their trigger + comprehensive toy list + E2E ([c3d56d2](https://github.com/Highfivery/SelfOS/commit/c3d56d2a61f6e3bc177a8ce64c68eea2bd093498))
* **ios:** apply safe-area insets so the shell clears the notch + home indicator ([890bc63](https://github.com/Highfivery/SelfOS/commit/890bc6373c8aabf3c8302badc2d486f6238a060b))
* **ios:** download iCloud files on demand in VaultFs ([83c488b](https://github.com/Highfivery/SelfOS/commit/83c488b13c5b50ff8f22d7c00db65122128d498e))
* **ios:** lock WebView scale to stop input-focus auto-zoom ([daa3113](https://github.com/Highfivery/SelfOS/commit/daa311347a079c4857a99a67a68d75a9bbae8a6a))
* **ios:** register the app-local VaultFs Capacitor plugin ([4cf03e0](https://github.com/Highfivery/SelfOS/commit/4cf03e05ab5b86efda3a8d2c65250bee274c2d03))
* **ios:** scrub legacy localStorage secrets after Keychain migration ([d032e37](https://github.com/Highfivery/SelfOS/commit/d032e375da8d8c1833adca4549f123f1f7b5503e))
* **ios:** set deployment target to iOS 18 + track the generated Xcode project ([cb6c58b](https://github.com/Highfivery/SelfOS/commit/cb6c58bf13c01da480b611f152005c7d1979c9ef))
* **main:** add root dev/build scripts and set explicit app name ([d7990ae](https://github.com/Highfivery/SelfOS/commit/d7990aec142c16529c99c26712a71918ccd07e1f))
* **memory:** scope insights:list to the active person — close the cross-user leak (spec 20 §1.1) ([aba6a60](https://github.com/Highfivery/SelfOS/commit/aba6a60321ec89598934ecb0ed49c8608b6e9fb3))
* **onboarding:** correct illogical intimacy conditionals ([51f0161](https://github.com/Highfivery/SelfOS/commit/51f016168c97079a851df66ca9f17beb5470cafc))
* **onboarding:** hard-gate Members into onboarding until complete (spec 18) ([daf39ae](https://github.com/Highfivery/SelfOS/commit/daf39ae33700dfcb5cc025c8e74a98947259205c))
* **onboarding:** honor per-question restricted facts at synthesis (18 §14.8) ([1dd257a](https://github.com/Highfivery/SelfOS/commit/1dd257a0a4dcc562673a30bc90f22f3b711ee7c1))
* **onboarding:** move questions into their correct sections/groups ([a0fa2e8](https://github.com/Highfivery/SelfOS/commit/a0fa2e82a1cc4551858ff7257063e3b93ff62b0d))
* **onboarding:** placeholders on all free-text questions; trim decisionStyle (18 §14.6) ([a983d54](https://github.com/Highfivery/SelfOS/commit/a983d541ad1c01319b4c5487a1a0cdc85ca2ec1a))
* **onboarding:** show the "Go deeper" section navigator on every section, not just the core steps ([d0183c7](https://github.com/Highfivery/SelfOS/commit/d0183c7971fcdfd29d5daa6e1c748b48aa427f7b))
* **onboarding:** the important-dates row label collapsed + remove button overflowed (18 §14.6) ([c3cc9b3](https://github.com/Highfivery/SelfOS/commit/c3cc9b3637dabe016aa2eefa2628bc7852506c95))
* **people:** remove the duplicated profile questions from the People editor (18 §14.6) ([f09cdf2](https://github.com/Highfivery/SelfOS/commit/f09cdf232ebfa6bddb8db9b2894adc71b9aec3a9))
* **questionnaires:** compat variants rewrite options with correct gender pronouns; sleek share card ([1ad9d49](https://github.com/Highfivery/SelfOS/commit/1ad9d4906f269167b1197a934c7e7a83bb842dca))
* **questionnaires:** compatibility variants ask about the OTHER participant (08 §17.12-E) ([758b92d](https://github.com/Highfivery/SelfOS/commit/758b92d5e7e13f49fb8f6b03654b53462803075d))
* **questionnaires:** drop test-on-yourself "Finish" from the sent (locked) preview ([7453d5a](https://github.com/Highfivery/SelfOS/commit/7453d5a9cae41e9beb9584e681a124dfe9a0644e))
* **questionnaires:** fix relay 404 (stale Worker) + make the link reachable after sending ([79841da](https://github.com/Highfivery/SelfOS/commit/79841dabf3c269ecea3386354b9c8874c19cbcb8))
* **questionnaires:** focused full-width builder — no orphaned empty space ([b8defd7](https://github.com/Highfivery/SelfOS/commit/b8defd749e6463dfd22228c9939460df2d77405c))
* **questionnaires:** honest publish-result errors + correct generatedAt (08 §17.12-D) ([f3e0d62](https://github.com/Highfivery/SelfOS/commit/f3e0d62bce7a671afe4b5314dd0f746f95c4caae))
* **questionnaires:** intimacy generation was thinking-budget starvation, not a refusal (08 §17.10) ([844dae9](https://github.com/Highfivery/SelfOS/commit/844dae908e95061bf79e77a6db09c5c224a49dd5))
* **questionnaires:** live drafting progress, drop leading blank, reliable explicit gen, topics ux ([462973e](https://github.com/Highfivery/SelfOS/commit/462973e245a131be8196658e509554932285d3f2))
* **questionnaires:** make the send lifecycle visible — relay drain, sent badge, delete, draft save ([a275bd4](https://github.com/Highfivery/SelfOS/commit/a275bd446955561c47ad914465a0e1c03823a91b))
* **questionnaires:** resolve the relay Worker bundle at runtime (relay:connect crash) ([d2965fa](https://github.com/Highfivery/SelfOS/commit/d2965fad904022dcd9535bfcb8c2a49a622404c6))
* **questionnaires:** share link re-shows the existing link; manual refresh regenerates ([af46172](https://github.com/Highfivery/SelfOS/commit/af4617215f98e9df8d5d3f69cad225ac9fc36490))
* **questionnaires:** surface a hint when a household send has no relay link (08 §17.13) ([9c82c48](https://github.com/Highfivery/SelfOS/commit/9c82c48beb1c46ac92d4c126b92a5717af0a03b4))
* **questionnaires:** surface relay-mint failures + lock sent questionnaires (read-only) ([e7d6df3](https://github.com/Highfivery/SelfOS/commit/e7d6df352054b6aefc7a6d132d2b1914c4237d5a))
* **questionnaires:** unified delivery for compatibility + re-publish/resend a relay link ([fa6651a](https://github.com/Highfivery/SelfOS/commit/fa6651aa837e5b5d1b73e66394bf9d6ecb1c60e2))
* **questionnaires:** warmer fallback for a nameless external compat recipient ([1f993ef](https://github.com/Highfivery/SelfOS/commit/1f993ef3fb7c4f288e0797ae5cb75566594e7807))
* **relay:** package the relay Worker bundle into the built app ([b32b7d9](https://github.com/Highfivery/SelfOS/commit/b32b7d9ab71492140194d4354b5ea3a816c8a571))
* **roles:** render the matrix via roleAllows so the Owner column shows all-on ([d46c974](https://github.com/Highfivery/SelfOS/commit/d46c9743480e16d0369c736cfa8e2efed10d9446))
* **roles:** the Owner always has every capability (incl. ones added later) ([479d001](https://github.com/Highfivery/SelfOS/commit/479d001a5f2fa5ce9efbde776ed2e82970249c5e))
* **sessions:** polish the guided launcher + sessions-list UI/UX (spec 16) ([ea81c46](https://github.com/Highfivery/SelfOS/commit/ea81c460be5ce5615d6a0f94b2b17242c3538f04))
* **sessions:** reset per-person stores on account switch ([9441a56](https://github.com/Highfivery/SelfOS/commit/9441a56d530d95ec3d6d61eaf3adacfa8977cfbc))
* **sessions:** space-filling filter + compact guided cards (spec 16) ([f3c96df](https://github.com/Highfivery/SelfOS/commit/f3c96df948cc83bedd762caad90f35766a94386e))
* **settings:** wrap long Vault/About content and show the app version ([39a609a](https://github.com/Highfivery/SelfOS/commit/39a609a45ab3455d6eaffb465fd0db951e611bb8))
* **superadmin:** grant full budget/usage access in main, not just the UI ([a80851f](https://github.com/Highfivery/SelfOS/commit/a80851fb9aba39d67bd9af38e117153b0f95432f))
* **test:** stop nodeSecretStore unit test from importing electron (red CI) ([88ed082](https://github.com/Highfivery/SelfOS/commit/88ed08280e6b6491173cee5f994048560a8c2800))
* **ui:** align TopBar controls to a shared height and make the usage ring visible ([c8cd6da](https://github.com/Highfivery/SelfOS/commit/c8cd6da1027360c16a86ca9555e0b1c88ca29385))
* **ui:** make Settings + Roles responsive at phone width ([90dd5fa](https://github.com/Highfivery/SelfOS/commit/90dd5faa60065cf0bf4b6a39fc8232c78b3ca75c))
* **ui:** polish — bottom-align field buttons, redesign the appearance control + brand ([c7e796c](https://github.com/Highfivery/SelfOS/commit/c7e796c5b1a756486e1d57c4e3416b7d96cdd5c6))
* **usage:** redact own-budget $ from budget:status for non-admins ([b13f58a](https://github.com/Highfivery/SelfOS/commit/b13f58ab9cbbebe2db01e7734748db45ccf36b9a))
* **vault:** retry atomic writes evicted by iCloud; backfill is best-effort ([5102dc8](https://github.com/Highfivery/SelfOS/commit/5102dc84b5c2bc275586eb111ea04e11db1bc4b0))


### Reverts

* **questionnaires:** restore genuinely-explicit intimacy framing; harden never-assume rule ([1c56a71](https://github.com/Highfivery/SelfOS/commit/1c56a71b4af4b3e2aa26f300bcef5bed16a174a5))


### Miscellaneous Chores

* release as 0.1.0 ([36c3dff](https://github.com/Highfivery/SelfOS/commit/36c3dffdcff2565d72a698ef9579b0683146190c))

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
