# [1.10.0](https://github.com/powerhouse-inc/renown-package/compare/v1.9.0...v1.10.0) (2026-10-09)


### Bug Fixes

* **stats:** non-blocking category migration, cache categories, back off failing network stats ([34b7e3e](https://github.com/powerhouse-inc/renown-package/commit/34b7e3e718a65e84e184ab0a38ad0d79a9b9882c))
* **stats:** trim the category filter argument ([4e6afd7](https://github.com/powerhouse-inc/renown-package/commit/4e6afd72bd72ddd1dcb9007cf41f1ee233e1fce5))


### Features

* **stats:** filter app profiles by category and list categories ([901a758](https://github.com/powerhouse-inc/renown-package/commit/901a7587cb97572915bcd519fdcdd387ee4f06ea))
* **stats:** index app-profile categories and network activity ([b55627f](https://github.com/powerhouse-inc/renown-package/commit/b55627f193715cc6df2a4c6ee3f92b29a7edb1cd))
* **stats:** keep app-profile categories indexed (save heal + backfill) ([a4f3c92](https://github.com/powerhouse-inc/renown-package/commit/a4f3c92627546415eeafc0c40e600b9325943650))
* **stats:** renownNetworkStats with a 300 s in-process cache ([dab5bce](https://github.com/powerhouse-inc/renown-package/commit/dab5bce090d0a72ffff2f310c594cf145c96c8aa))

# [1.9.0](https://github.com/powerhouse-inc/renown-package/compare/v1.8.1...v1.9.0) (2026-10-09)


### Bug Fixes

* **renown-stats:** fail closed on unreadable app profiles, expose media refs, wrap public read failures ([481be46](https://github.com/powerhouse-inc/renown-package/commit/481be469c44d4cd5a1e8788f0107071a628404c5))
* **renown-stats:** final-review fixes (image index healing, id caps, resilient lists, backfill, top contributors) ([cbe04fc](https://github.com/powerhouse-inc/renown-package/commit/cbe04fc79441a969269100c578dfe487e95b962a))


### Features

* identity hub phases 2+3 (app profiles, app stats) ([d7a27eb](https://github.com/powerhouse-inc/renown-package/commit/d7a27eb68979d78cb44f440209eae3ad161aab50))
* **media:** logo and cover uploads and public media URLs ([b8edb10](https://github.com/powerhouse-inc/renown-package/commit/b8edb100c4f35dcd2c97e1541d6170db9c9941ac))
* **renown-app-profile:** description, category, logo and cover images, links ([f07b9d3](https://github.com/powerhouse-inc/renown-package/commit/f07b9d3bd7480a67a4ec3efb602cfbcbcfa6cfb6))
* **renown-app-profile:** publisher-defined metric definitions ([03f5a9e](https://github.com/powerhouse-inc/renown-package/commit/03f5a9ea55bb14a13eb6aad307b2b17640eb1fdf))
* **renown-stats:** backfill app metric values from user-stats documents once ([72c3997](https://github.com/powerhouse-inc/renown-package/commit/72c3997c28bb6067e25f9234ec055b719de8c099))
* **renown-stats:** index app profile images and page through profiles ([beb72e6](https://github.com/powerhouse-inc/renown-package/commit/beb72e6d324e70b11ac9dd272058d3103cb6596f))
* **renown-stats:** metric definitions on app profiles, aggregate rows on every report ([efd002e](https://github.com/powerhouse-inc/renown-package/commit/efd002e4bee1bb65ea9c3820cf23cbd2384f5bf9))
* **renown-stats:** per-user metric values with app-level aggregates ([61b0125](https://github.com/powerhouse-inc/renown-package/commit/61b0125c77afdd06dc544cfc2c0d6d129cfde15e))
* **renown-stats:** public appStats with top contributors; userStats names apps and metrics ([63fe19a](https://github.com/powerhouse-inc/renown-package/commit/63fe19ace256509640397e51263d77cef2a49699))
* **renown-stats:** rich app profiles through the Vetra relay, appProfiles listing ([8e95b08](https://github.com/powerhouse-inc/renown-package/commit/8e95b089ba4d0fd11a44a1192251c20e411d74f8))

## [1.8.1](https://github.com/powerhouse-inc/renown-package/compare/v1.8.0...v1.8.1) (2026-10-09)


### Bug Fixes

* **identity:** media redirect lifetime, storage faults answer 503, dedupe known uploads, cap link ids, full smoke cleanup ([a624dbd](https://github.com/powerhouse-inc/renown-package/commit/a624dbdd19533bce83e1b1099506af68463f2499))

# [1.8.0](https://github.com/powerhouse-inc/renown-package/compare/v1.7.1...v1.8.0) (2026-10-09)


### Bug Fixes

* **media:** sign content-type on upload URLs; harden streamed media responses ([2cb4bc9](https://github.com/powerhouse-inc/renown-package/commit/2cb4bc912caac019d215cb2df59c736183d7506c))
* **renown-auth:** reserve a handle before any await and release it on failure ([c3dd1a4](https://github.com/powerhouse-inc/renown-package/commit/c3dd1a4043daaa9b9468d494a56d1c2d2f25dcd8))
* **smoke:** classify the bypass probe, add a positive control, revoke every credential ([5740572](https://github.com/powerhouse-inc/renown-package/commit/5740572951bf43119079197919c8241186367c99))


### Features

* **media:** gated avatar uploads and public media URLs on the switchboard ([73a297b](https://github.com/powerhouse-inc/renown-package/commit/73a297b07011199318a6472572aa53359e4c081d))
* **read-model:** index profile identity with a unique case-insensitive handle ([454a79d](https://github.com/powerhouse-inc/renown-package/commit/454a79db3d57fb80da84cdbb2e44d67cc8204621))
* **read-model:** profile identity fields, handle lookup and availability ([c4a2214](https://github.com/powerhouse-inc/renown-package/commit/c4a22148387d1456bffaa4b841390e2f9f33d4c9))
* **renown-auth:** profile identity fields with patch semantics on renown_upsertProfile ([e9642dd](https://github.com/powerhouse-inc/renown-package/commit/e9642dd165786ca0d70a5655bcb148abf38a22dd))
* **renown-user:** display name, handle, bio, links and avatar ([603bd65](https://github.com/powerhouse-inc/renown-package/commit/603bd658d779fe7eff363447d27adf259b5af617))

## [1.7.1](https://github.com/powerhouse-inc/renown-package/compare/v1.7.0...v1.7.1) (2026-10-09)


### Bug Fixes

* **deps:** ship powerhouse 6.2.3 with a pinned ph-cmd ([c22545c](https://github.com/powerhouse-inc/renown-package/commit/c22545cf3a29290ef94f8f4203e0b3d3a7307449))

# [1.7.0](https://github.com/powerhouse-inc/renown-package/compare/v1.6.0...v1.7.0) (2026-10-08)


### Bug Fixes

* **stats:** accept only raster data-URL logos, not svg+xml ([e9f5d85](https://github.com/powerhouse-inc/renown-package/commit/e9f5d8596f5a4c23be07749ea00de372398a6773))
* **stats:** anchor app ownership on the registered workload identity ([7b27b4f](https://github.com/powerhouse-inc/renown-package/commit/7b27b4f6dbe70abc6bb959055f253e8b948a362d))
* **stats:** gate profile upserts on RENOWN_STATS_PROFILE_APPS, refuse CI tokens, skip unchanged stats ([a19a2b0](https://github.com/powerhouse-inc/renown-package/commit/a19a2b06533ee1763429d07fcad30465d55da429))
* **stats:** log fixed reasons for token signing failures, document FORBIDDEN, sharpen malformed-token test ([d1e15cf](https://github.com/powerhouse-inc/renown-package/commit/d1e15cf43e8bb90f200257505cc9bc90e76d7ebd))


### Features

* **stats:** DID canonicalisation, stats audience and keyed lock ([261776c](https://github.com/powerhouse-inc/renown-package/commit/261776c35b070ff15efea91b0170acb9ba5eb042))
* **stats:** DID-to-document index in the renown-stats namespace ([dfb0bd8](https://github.com/powerhouse-inc/renown-package/commit/dfb0bd84f3bb48fd261e9d1bc6c17a103edd35e7))
* **stats:** issueAppStatsToken so the Vetra relay can report as the app ([5ce09c7](https://github.com/powerhouse-inc/renown-package/commit/5ce09c75ef7abb4a039e488d1f6ead333bff79a2))
* **stats:** powerhouse/renown-app-profile document model ([6a5de69](https://github.com/powerhouse-inc/renown-package/commit/6a5de693c5574466a42dc89bf3233d93b9302c40))
* **stats:** powerhouse/renown-user-stats document model ([06b0904](https://github.com/powerhouse-inc/renown-package/commit/06b0904f21fe322565bc9a6396c8d8944bbcf596))
* **stats:** register the renown-stats subgraph ([b5ef6c4](https://github.com/powerhouse-inc/renown-package/commit/b5ef6c4d0ccf4adaffc8696456fdeb2e66add3d1))
* **stats:** reportUserStat and app profile resolvers with app-DID authorisation ([9ecfcb8](https://github.com/powerhouse-inc/renown-package/commit/9ecfcb845b45e360421a694b5f39717bb626d8df))

# [1.6.0](https://github.com/powerhouse-inc/renown-package/compare/v1.5.1...v1.6.0) (2026-10-02)


### Bug Fixes

* **renown-workload:** classify runs by event_name, not ref alone ([f746b81](https://github.com/powerhouse-inc/renown-package/commit/f746b814c8d2224209f4b8ba2e1c324b095b90c6))
* **renown-workload:** default audience is the vetra-apps endpoints, not the whole switchboard ([6e9fbd8](https://github.com/powerhouse-inc/renown-package/commit/6e9fbd8ae2f37b48d962cca8318b40ebb83acf8e))


### Features

* **renown-workload:** GitHub OIDC verification, ref policy and did:key signing ([503f243](https://github.com/powerhouse-inc/renown-package/commit/503f2436e5cdac9bc234c9d0e231de7211e5323a))
* **renown-workload:** POST workload/token exchange handler ([069bee4](https://github.com/powerhouse-inc/renown-package/commit/069bee4402d74775b801024173e3ef02e94b8367))
* **renown-workload:** register the renown-workload subgraph ([00b1b87](https://github.com/powerhouse-inc/renown-package/commit/00b1b87c565184670e3224f0cf244ad0b15494f5))
* **renown-workload:** token-gated workload identity registration API ([ff402e7](https://github.com/powerhouse-inc/renown-package/commit/ff402e730062be300b0084c53f30d6ddc5cb1db7))
* **renown-workload:** workload_identities store with kysely and memory backends ([a4b4e89](https://github.com/powerhouse-inc/renown-package/commit/a4b4e89112e0fa5f0f27f073e6181ff93d84c1c0))

## [1.5.1](https://github.com/powerhouse-inc/renown-package/compare/v1.5.0...v1.5.1) (2026-09-28)


### Bug Fixes

* **renown-auth:** accept smart-wallet (ERC-1271/6492) signatures ([9cd5a5c](https://github.com/powerhouse-inc/renown-package/commit/9cd5a5cc2d9866ea2115b43e6549d0028616104c))

# [1.5.0](https://github.com/powerhouse-inc/renown-package/compare/v1.4.0...v1.5.0) (2026-09-28)


### Bug Fixes

* **processors:** skip an operation whose write fails instead of wedging the cursor ([f82176c](https://github.com/powerhouse-inc/renown-package/commit/f82176c13ddafb8229654f0d0f28edfb194eb1ed))
* **processors:** skip only data exceptions, rethrow transient errors ([17c905b](https://github.com/powerhouse-inc/renown-package/commit/17c905b26349cd3d5727f6b44cfdd2b4bd0cd2fc))
* **renown-auth:** bound rate-limiter memory, harden did:pkh parsing, strict timestamp check ([59e94a7](https://github.com/powerhouse-inc/renown-package/commit/59e94a70d96fcda42ca51b6c08e969497675c832))
* **renown-auth:** cap credential fields at their read-model column sizes ([fa9a9bb](https://github.com/powerhouse-inc/renown-package/commit/fa9a9bb02175afc15a017bd635ff70fd30319e87))
* **renown-auth:** recover the revoke signer once ([710a3b2](https://github.com/powerhouse-inc/renown-package/commit/710a3b2fa6c0fb31bfa22cf7effb48d32580ceae))
* **renown-auth:** replay-safe rate limits, profile size caps, revoke by proven issuer ([04bc170](https://github.com/powerhouse-inc/renown-package/commit/04bc17061188ad9ed2393691049e6200c0681d85))
* **renown-user:** remove unauthenticated profile mutations ([43b3969](https://github.com/powerhouse-inc/renown-package/commit/43b39695eff29ae7d9b41a88f8b33251ce8dc5c6))


### Features

* **renown-auth:** credential validation, signed messages, rate limit ([077a09c](https://github.com/powerhouse-inc/renown-package/commit/077a09c2ac4bceead625a5ba8b2ec38512ac1f8a))
* **renown-auth:** self-authenticating issue, revoke and profile mutations ([d012c09](https://github.com/powerhouse-inc/renown-package/commit/d012c0915ae2925f4fc9fe2e0a0bb8e92e99c5c6))

# [1.4.0](https://github.com/powerhouse-inc/renown-package/compare/v1.3.8...v1.4.0) (2026-09-26)


### Bug Fixes

* accept any newer 6.x document-model and reactor-browser as peers ([2062cf5](https://github.com/powerhouse-inc/renown-package/commit/2062cf5febafb12e245a16c94979656b33b0c8cc))
* derive document ids via baseCreateDocument instead of overwriting them ([302d209](https://github.com/powerhouse-inc/renown-package/commit/302d209038e930b8dd92e88009c1ad0e8a9c3a25))
* **editors:** call hooks unconditionally ([4eac43a](https://github.com/powerhouse-inc/renown-package/commit/4eac43a8c46d92dc98a0423f6de30a65ce75437b))
* import generateMock from document-model/mock and drop redundant assertions ([9bec240](https://github.com/powerhouse-inc/renown-package/commit/9bec240df13a71c2d27019244c340acd4be97fc7))
* **renown-oidc:** 403 all SIWE mismatches, catch malformed-signature throw, allowlist JWKS fields, don't leak signing-key JSON ([8bf4325](https://github.com/powerhouse-inc/renown-package/commit/8bf4325e49d03acbddad3794a69df9b43578b4f6))
* **renown-oidc:** chain-independent sub, always did:pkh:eip155:1 (I2) ([2bd31bd](https://github.com/powerhouse-inc/renown-package/commit/2bd31bda85f228e215c8965af464b737d1ddbb6c))
* **renown-oidc:** disable OIDC endpoints instead of throwing on namespace/migration failure; idempotent onSetup ([5f4edf3](https://github.com/powerhouse-inc/renown-package/commit/5f4edf398269f1b96b5bcc285fd601f126bdf4e9))
* **renown-oidc:** keep auth codes an hour past expiry so replays are still revoked ([be2da58](https://github.com/powerhouse-inc/renown-package/commit/be2da584d04ff39fcb45cb993dca378aab96d327))
* **renown-oidc:** store chain_id as bigint (I3) ([f3adbf2](https://github.com/powerhouse-inc/renown-package/commit/f3adbf259ca8a4f0f0176924179abfa84ed98227))


### Features

* **oidc-client:** editor with one-time secret rotation ([647dd9f](https://github.com/powerhouse-inc/renown-package/commit/647dd9f264e3d2d1f1dd70912122f27bdef6f931))
* **oidc-client:** read-only editor for the audit-mirror document (C1) ([d2f5de3](https://github.com/powerhouse-inc/renown-package/commit/d2f5de3ceae13dfddd0df1443d60d953cc8df08b))
* **oidc-client:** renown/oidc-client document model ([75e88b3](https://github.com/powerhouse-inc/renown-package/commit/75e88b33b156c5745112101a71f27ad33fa67dab))
* **renown-oidc:** authorize, interaction, token and userinfo handlers ([029ac62](https://github.com/powerhouse-inc/renown-package/commit/029ac620546f4cc647a5ec40674f8109ec354818))
* **renown-oidc:** client registration and client/profile directories ([29d988a](https://github.com/powerhouse-inc/renown-package/commit/29d988ac719d74eba9cd341e837d46aca2193f76))
* **renown-oidc:** client registry in the relational namespace, documents as audit mirror (C1) ([69bcec7](https://github.com/powerhouse-inc/renown-package/commit/69bcec7ec32e2dec8909c4914afc38005d4ed9e1))
* **renown-oidc:** login-request, code and token store ([b4dfdcc](https://github.com/powerhouse-inc/renown-package/commit/b4dfdcc464d6c45ac2b28dd9fe02e1094d877932))
* **renown-oidc:** oidc_clients table and client store methods (C1) ([a23a2ae](https://github.com/powerhouse-inc/renown-package/commit/a23a2aeeaa17e3b5765004898fd67e8d6022a88f))
* **renown-oidc:** POST /authorize and explicit discovery capabilities ([03907d0](https://github.com/powerhouse-inc/renown-package/commit/03907d06c332b6c8da16f41e50deb05b4b02d29b))
* **renown-oidc:** protocol core — keys, PKCE, SIWE, claims ([8dad27a](https://github.com/powerhouse-inc/renown-package/commit/8dad27a19fe3e326c5eb1ead7aeeb3e077557a15))
* **renown-oidc:** sign ID tokens with RS256 (C2) ([ac069ea](https://github.com/powerhouse-inc/renown-package/commit/ac069eaa20b5213b62f6ea96f905100360499015))
* **renown-oidc:** subgraph serving the OIDC endpoints and client registration ([5193216](https://github.com/powerhouse-inc/renown-package/commit/5193216d4a615ec9b068a0d598276bdd52ba0247))
* **renown-oidc:** take the registration token from X-Renown-OIDC-Registration-Token (I1) ([929b667](https://github.com/powerhouse-inc/renown-package/commit/929b6678d90a7682c987136b5465c3239c2fe2a4))


### Performance Improvements

* **read-model:** drop superseded raw eth indexes; order newest-first ([332e29c](https://github.com/powerhouse-inc/renown-package/commit/332e29c3d1294d538dc692af68cc653c1e1a50ee))
* **read-model:** index-backed, case-insensitive credential/user lookups ([64bcd5d](https://github.com/powerhouse-inc/renown-package/commit/64bcd5d26a6619930b948760b3a4a27999564b85))

## [1.3.8](https://github.com/powerhouse-inc/renown-package/compare/v1.3.7...v1.3.8) (2026-03-26)


### Bug Fixes

* prefer action.input over resultingState for credential INIT ([390878a](https://github.com/powerhouse-inc/renown-package/commit/390878a0e3cd4e130ad68feafeb9ee91e78648f5))

## [1.3.7](https://github.com/powerhouse-inc/renown-package/compare/v1.3.6...v1.3.7) (2026-03-26)


### Bug Fixes

* handle duplicate keys and missing resultingState in processors ([1003058](https://github.com/powerhouse-inc/renown-package/commit/1003058be1bb67d6fc29d650ebbb856d0e79b73c))

## [1.3.6](https://github.com/powerhouse-inc/renown-package/compare/v1.3.5...v1.3.6) (2026-03-26)


### Bug Fixes

* run migrations in processor factories and make factory sync ([3c848a6](https://github.com/powerhouse-inc/renown-package/commit/3c848a64da8da980801b36eb438e2b60aedd8750))

## [1.3.5](https://github.com/powerhouse-inc/renown-package/compare/v1.3.4...v1.3.5) (2026-03-25)


### Bug Fixes

* update reactor-api to dev for v6 BaseSubgraph with reactorClient ([3f8789a](https://github.com/powerhouse-inc/renown-package/commit/3f8789ab0a97d7f33f58f67f8a9b5a05aced3c5c))

## [1.3.4](https://github.com/powerhouse-inc/renown-package/compare/v1.3.3...v1.3.4) (2026-03-25)


### Bug Fixes

* use switchboard@dev with Postgres read model fix, remove Prisma ([37beb21](https://github.com/powerhouse-inc/renown-package/commit/37beb21b9ef095ac04c3ca570246adbae81e49f6))

## [1.3.3](https://github.com/powerhouse-inc/renown-package/compare/v1.3.2...v1.3.3) (2026-03-25)


### Bug Fixes

* simplify Dockerfile — skip ph init, build from source directly ([f4082fe](https://github.com/powerhouse-inc/renown-package/commit/f4082fec6864d170b75190be829893fb5ee12889))

## [1.3.2](https://github.com/powerhouse-inc/renown-package/compare/v1.3.1...v1.3.2) (2026-03-25)


### Bug Fixes

* default Docker TAG to dev and remove unused prisma global install ([fbd81f4](https://github.com/powerhouse-inc/renown-package/commit/fbd81f44a6448389c8cf66235341330fb61722dd))

## [1.3.1](https://github.com/powerhouse-inc/renown-package/compare/v1.3.0...v1.3.1) (2026-03-25)


### Bug Fixes

* simplify Docker build — use pnpm install instead of ph install ([420a442](https://github.com/powerhouse-inc/renown-package/commit/420a4428f76496db2daa3bfa94a15c9120cf10bc))

# [1.3.0](https://github.com/powerhouse-inc/renown-package/compare/v1.2.2...v1.3.0) (2026-03-25)


### Features

* migrate processors to v6 reactor API ([de1c934](https://github.com/powerhouse-inc/renown-package/commit/de1c934695abd9cd8b9a0de5d5f9851e585765d7))

## [1.2.2](https://github.com/powerhouse-inc/renown-package/compare/v1.2.1...v1.2.2) (2026-03-25)


### Bug Fixes

* use dev ph-cmd tag for latest channel to pick up switchboard fix ([e29d12a](https://github.com/powerhouse-inc/renown-package/commit/e29d12ada1f05b16837ac0adf4e41dbaf57df7dc))

## [1.2.1](https://github.com/powerhouse-inc/renown-package/compare/v1.2.0...v1.2.1) (2026-03-25)


### Bug Fixes

* build local project in Docker and remove PH_PACKAGES from deploy ([02cb07d](https://github.com/powerhouse-inc/renown-package/commit/02cb07dcb4a5bb797bddcf6c2a3708026fda4be4))
* copy full project source in Docker to build document-models from source ([4669bdd](https://github.com/powerhouse-inc/renown-package/commit/4669bddbf6528fc9edd406b9eb65971a7f7b849e))
* remove PH_PACKAGES update from deploy step ([3724a3c](https://github.com/powerhouse-inc/renown-package/commit/3724a3ca362f087424d830e9d1a566620f2ec163))
* remove PH_PACKAGES update from deploy step ([4bf66b4](https://github.com/powerhouse-inc/renown-package/commit/4bf66b43fbdab5b96e719e315e170ecab6aac248))
* restore PH_PACKAGES update in deploy step with double quotes ([a3f3c76](https://github.com/powerhouse-inc/renown-package/commit/a3f3c765222f9eba04175468ca72a589e1b4b25d))
* restore PH_PACKAGES update in deploy step with double quotes ([2a8520a](https://github.com/powerhouse-inc/renown-package/commit/2a8520aeb858031b065c7bf32efe1eee74a7f054))

## [1.2.1-staging.2](https://github.com/powerhouse-inc/renown-package/compare/v1.2.1-staging.1...v1.2.1-staging.2) (2026-03-25)


### Bug Fixes

* build local project in Docker and remove PH_PACKAGES from deploy ([02cb07d](https://github.com/powerhouse-inc/renown-package/commit/02cb07dcb4a5bb797bddcf6c2a3708026fda4be4))

## [1.2.1-staging.1](https://github.com/powerhouse-inc/renown-package/compare/v1.2.0...v1.2.1-staging.1) (2026-03-25)


### Bug Fixes

* remove PH_PACKAGES update from deploy step ([3724a3c](https://github.com/powerhouse-inc/renown-package/commit/3724a3ca362f087424d830e9d1a566620f2ec163))
* remove PH_PACKAGES update from deploy step ([4bf66b4](https://github.com/powerhouse-inc/renown-package/commit/4bf66b43fbdab5b96e719e315e170ecab6aac248))
* restore PH_PACKAGES update in deploy step with double quotes ([a3f3c76](https://github.com/powerhouse-inc/renown-package/commit/a3f3c765222f9eba04175468ca72a589e1b4b25d))
* restore PH_PACKAGES update in deploy step with double quotes ([2a8520a](https://github.com/powerhouse-inc/renown-package/commit/2a8520aeb858031b065c7bf32efe1eee74a7f054))

# [1.2.0](https://github.com/powerhouse-inc/renown-package/compare/v1.1.0...v1.2.0) (2026-03-24)


### Bug Fixes

* add missing package-manager-detector dep for Docker build ([dfa5f64](https://github.com/powerhouse-inc/renown-package/commit/dfa5f64694cf0a1f69597f8ca9fdd83b8fc05e43))
* filter credentials by app DID in renownCredentials resolver ([ece29e4](https://github.com/powerhouse-inc/renown-package/commit/ece29e4a2c84d6e132e192f39feb141f49fc94af))
* update to document-drive Legacy API and new reactor client ([9a94a68](https://github.com/powerhouse-inc/renown-package/commit/9a94a68345f2bc9e8687248d3a1d8f9907fcd6a3))
* upgrade Dockerfile to Node 24 for ph-cmd compatibility ([dd3aed5](https://github.com/powerhouse-inc/renown-package/commit/dd3aed5dae6b73499e4f35fc73384fc8c1ab374b))
* use K8S_REPO_PAT org secret for deploy step ([1256852](https://github.com/powerhouse-inc/renown-package/commit/1256852b0ba8fff3e74a632ee7d84475dec19d1e))


### Features

* add deploy step to update k8s Helm values after Docker push ([60e2134](https://github.com/powerhouse-inc/renown-package/commit/60e213436a6dfe7147552d31a7866669f10c9236))

## [1.0.1-staging.5](https://github.com/powerhouse-inc/renown-package/compare/v1.0.1-staging.4...v1.0.1-staging.5) (2026-03-24)


### Bug Fixes

* add missing package-manager-detector dep for Docker build ([dfa5f64](https://github.com/powerhouse-inc/renown-package/commit/dfa5f64694cf0a1f69597f8ca9fdd83b8fc05e43))

## [1.0.1-staging.4](https://github.com/powerhouse-inc/renown-package/compare/v1.0.1-staging.3...v1.0.1-staging.4) (2026-03-24)


### Bug Fixes

* upgrade Dockerfile to Node 24 for ph-cmd compatibility ([dd3aed5](https://github.com/powerhouse-inc/renown-package/commit/dd3aed5dae6b73499e4f35fc73384fc8c1ab374b))

## [1.0.1-staging.3](https://github.com/powerhouse-inc/renown-package/compare/v1.0.1-staging.2...v1.0.1-staging.3) (2026-03-24)


### Bug Fixes

* update to document-drive Legacy API and new reactor client ([9a94a68](https://github.com/powerhouse-inc/renown-package/commit/9a94a68345f2bc9e8687248d3a1d8f9907fcd6a3))

## [1.0.1-staging.2](https://github.com/powerhouse-inc/renown-package/compare/v1.0.1-staging.1...v1.0.1-staging.2) (2026-03-23)


### Bug Fixes

* filter credentials by app DID in renownCredentials resolver ([ece29e4](https://github.com/powerhouse-inc/renown-package/commit/ece29e4a2c84d6e132e192f39feb141f49fc94af))

## [1.0.1-staging.1](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0...v1.0.1-staging.1) (2026-01-26)


### Bug Fixes

* add @testing-library/react for design-system build compatibility ([70ca434](https://github.com/powerhouse-inc/renown-package/commit/70ca434f9ba6b4e97cce17feda59c6f00622f19f))
* add @testing-library/react for design-system build compatibility ([e262ed1](https://github.com/powerhouse-inc/renown-package/commit/e262ed18da14aab7ac8fccce56f2f08b8dbb6493))
* add bugs URL to package.json ([54f5cf2](https://github.com/powerhouse-inc/renown-package/commit/54f5cf23ae81cba8b218763608991459949ae098))
* add package keywords ([520f260](https://github.com/powerhouse-inc/renown-package/commit/520f2607ed2e499ccfb98fc74375ccd06e1e861c))
* correct test structure and assertions ([c76848c](https://github.com/powerhouse-inc/renown-package/commit/c76848c11710d4853aae2fa2276c8a049e7df723))
* create local tracking branches for semantic-release ([cfc4fe4](https://github.com/powerhouse-inc/renown-package/commit/cfc4fe41a4f1051da08ccaf7953ba4a4924461a3))
* force docker job to run with always() condition ([b53cf44](https://github.com/powerhouse-inc/renown-package/commit/b53cf448500da5d4fff931693bf591417c47faa8))
* force docker job to run with always() condition ([80b6f83](https://github.com/powerhouse-inc/renown-package/commit/80b6f8360be88ec40528dfbf3e47ecc42a5cc68b))
* restore full docker build and push flow ([a4c4015](https://github.com/powerhouse-inc/renown-package/commit/a4c40153be12b2aa4ef148435af222ddf15bc59b))
* use correct Harbor project name (renown) ([4eaa34c](https://github.com/powerhouse-inc/renown-package/commit/4eaa34c73211ab98171803ae834bceb7d5675d31))

# [1.0.0-staging.21](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.20...v1.0.0-staging.21) (2026-01-21)


### Bug Fixes

* add bugs URL to package.json ([54f5cf2](https://github.com/powerhouse-inc/renown-package/commit/54f5cf23ae81cba8b218763608991459949ae098))

# [1.0.0-staging.20](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.19...v1.0.0-staging.20) (2026-01-21)


### Bug Fixes

* use correct Harbor project name (renown) ([4eaa34c](https://github.com/powerhouse-inc/renown-package/commit/4eaa34c73211ab98171803ae834bceb7d5675d31))

# [1.0.0-staging.19](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.18...v1.0.0-staging.19) (2026-01-21)


### Bug Fixes

* restore full docker build and push flow ([a4c4015](https://github.com/powerhouse-inc/renown-package/commit/a4c40153be12b2aa4ef148435af222ddf15bc59b))

# [1.0.0-staging.18](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.17...v1.0.0-staging.18) (2026-01-20)


### Bug Fixes

* add package keywords ([520f260](https://github.com/powerhouse-inc/renown-package/commit/520f2607ed2e499ccfb98fc74375ccd06e1e861c))

# [1.0.0-staging.17](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.16...v1.0.0-staging.17) (2026-01-20)


### Bug Fixes

* add @testing-library/react for design-system build compatibility ([e262ed1](https://github.com/powerhouse-inc/renown-package/commit/e262ed18da14aab7ac8fccce56f2f08b8dbb6493))

# [1.0.0-staging.16](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.15...v1.0.0-staging.16) (2026-01-20)


### Bug Fixes

* force docker job to run with always() condition ([80b6f83](https://github.com/powerhouse-inc/renown-package/commit/80b6f8360be88ec40528dfbf3e47ecc42a5cc68b))

# [1.0.0-staging.15](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.14...v1.0.0-staging.15) (2026-01-20)


### Bug Fixes

* move docker condition check to step level for debugging ([8360402](https://github.com/powerhouse-inc/renown-package/commit/83604021a90a280345dc5a0eb4d331c2eea09b02))

# [1.0.0-staging.14](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.13...v1.0.0-staging.14) (2026-01-20)


### Bug Fixes

* remove debug job and clean up docker condition ([14a3de0](https://github.com/powerhouse-inc/renown-package/commit/14a3de0dc096efb31239b50bf0597b39f9b313b4))

# [1.0.0-staging.13](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.12...v1.0.0-staging.13) (2026-01-20)


### Bug Fixes

* add debug step for docker condition ([35f9aa3](https://github.com/powerhouse-inc/renown-package/commit/35f9aa3379748c93c9a9d592e110f3d69e5d58dc))

# [1.0.0-staging.12](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.11...v1.0.0-staging.12) (2026-01-20)


### Bug Fixes

* simplify docker job condition ([747970e](https://github.com/powerhouse-inc/renown-package/commit/747970e1c757936b46a33a6612ac613def5fbb82))

# [1.0.0-staging.11](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.10...v1.0.0-staging.11) (2026-01-20)


### Bug Fixes

* add repository field to package.json ([76a7314](https://github.com/powerhouse-inc/renown-package/commit/76a7314e6281b1a6803e0349a638cacd89dcaadc))

# [1.0.0-staging.10](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.9...v1.0.0-staging.10) (2026-01-20)


### Bug Fixes

* add package description ([98df320](https://github.com/powerhouse-inc/renown-package/commit/98df320a3458eb82b232f5aa448378a33bbac83d))

# [1.0.0-staging.9](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.8...v1.0.0-staging.9) (2026-01-20)


### Bug Fixes

* use NPM_TOKEN secret for npm publish ([911aabf](https://github.com/powerhouse-inc/renown-package/commit/911aabf772ae1ed950c6f89be7cf9bea4c488e46))

# [1.0.0-staging.8](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.7...v1.0.0-staging.8) (2026-01-20)


### Bug Fixes

* let npm handle OIDC automatically with Trusted Publishers ([1b9367a](https://github.com/powerhouse-inc/renown-package/commit/1b9367a3a8d545291e21c3e47b31088641b8bf76))

# [1.0.0-staging.7](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.6...v1.0.0-staging.7) (2026-01-20)


### Bug Fixes

* explicitly request OIDC token for npm authentication ([57707b6](https://github.com/powerhouse-inc/renown-package/commit/57707b63af7a0ce125a50e5d2a072c423f989c54))

# [1.0.0-staging.6](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.5...v1.0.0-staging.6) (2026-01-20)


### Bug Fixes

* use NPM_TOKEN for publishing instead of OIDC ([c99eb2b](https://github.com/powerhouse-inc/renown-package/commit/c99eb2be1742d8b5dc1be7ca45b59115e636dad6))
* use OIDC provenance for npm publish with debug logging ([9de4cbb](https://github.com/powerhouse-inc/renown-package/commit/9de4cbbacab0448fdfaf599b770f17d1b225b7a9))

# [1.0.0-staging.5](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.4...v1.0.0-staging.5) (2026-01-20)


### Bug Fixes

* clear npmrc and specify registry explicitly for OIDC publish ([eb61b92](https://github.com/powerhouse-inc/renown-package/commit/eb61b9277291e3113bb529b4c77634d328b9459b))

# [1.0.0-staging.4](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.3...v1.0.0-staging.4) (2026-01-20)


### Bug Fixes

* remove registry-url from setup-node to allow pure OIDC publishing ([17844ff](https://github.com/powerhouse-inc/renown-package/commit/17844ff389b487419edbc36b9544941f2d061d01))

# [1.0.0-staging.3](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.2...v1.0.0-staging.3) (2026-01-20)


### Bug Fixes

* use npm publish with provenance instead of semantic-release npm plugin ([d4df37b](https://github.com/powerhouse-inc/renown-package/commit/d4df37bef1bf12adb31b29c5604dc0a50640937a))

# [1.0.0-staging.2](https://github.com/powerhouse-inc/renown-package/compare/v1.0.0-staging.1...v1.0.0-staging.2) (2026-01-20)


### Bug Fixes

* use NPM_TOKEN for semantic-release npm authentication ([733e4c5](https://github.com/powerhouse-inc/renown-package/commit/733e4c59ed474dee517e060833b28f5bfa963677))

# 1.0.0-staging.1 (2026-01-20)


### Bug Fixes

* add semantic-release package as devDependency ([38d2183](https://github.com/powerhouse-inc/renown-package/commit/38d218303f5549e35beb88efd1648102d161a04c))
* be conform with vc standard ([4654217](https://github.com/powerhouse-inc/renown-package/commit/46542174a042a554f3d4bf1d4263b738aa044e79))
* build issues ([25a6d02](https://github.com/powerhouse-inc/renown-package/commit/25a6d02690fa2702bfa34bed4ab5200642728c3a))
* build issues ([c4864ec](https://github.com/powerhouse-inc/renown-package/commit/c4864ec470ffdbe68bef7972bff7d2bac6b840e9))
* configure JSR registry for [@jsr](https://github.com/jsr) scoped packages ([97d2073](https://github.com/powerhouse-inc/renown-package/commit/97d20737ce4adb32a56848b6fdcad6a8eed41cda))
* configure npm registry only for publishing step ([cccf53b](https://github.com/powerhouse-inc/renown-package/commit/cccf53be4ba2fea49658aabd5c061c8bf66c3079))
* configure npm registry only for publishing step ([f6385fe](https://github.com/powerhouse-inc/renown-package/commit/f6385fe6ff42931d4b9d240ca8413bdfa6268709))
* recovered renown read model ([7100e27](https://github.com/powerhouse-inc/renown-package/commit/7100e27a968ba1335da9445ce7d8aa6f58bfc7a1))
* remove accidentally committed sensitive files ([d3e643b](https://github.com/powerhouse-inc/renown-package/commit/d3e643b1930024a10b60d1ae397927489ea261f3))
* remove duplicate imports in profile.test.ts ([f1493d2](https://github.com/powerhouse-inc/renown-package/commit/f1493d25f86bbf9e9aafd0921089b48555c8d25f))
* remove local reactor-api link for publishing ([cace8e7](https://github.com/powerhouse-inc/renown-package/commit/cace8e73b35ade11ee1ce7de61e9ee15d3b82911))
* renown read model schema ([e65e2e4](https://github.com/powerhouse-inc/renown-package/commit/e65e2e453b546cdeb18f000818e388fd20c8f180))
* set staging v 30 ([262f665](https://github.com/powerhouse-inc/renown-package/commit/262f6653e7514e21197fabd02cf6c402d754d048))
* update package.json exports to match boilerplate ([908e5ec](https://github.com/powerhouse-inc/renown-package/commit/908e5ec8c3ff556974c7f92d2b5c2ac434828e31))
* use GITHUB_TOKEN for checkout to enable git pull ([bd336ea](https://github.com/powerhouse-inc/renown-package/commit/bd336eabc45d4c75da684554827698395ce605a6))
* use GITHUB_TOKEN for checkout to enable git pull ([c45692b](https://github.com/powerhouse-inc/renown-package/commit/c45692bbfc893adc909866c5ebdec6536f05f461))
* use npm provenance publishing with trusted publisher ([aade446](https://github.com/powerhouse-inc/renown-package/commit/aade4468a04516ceda9a99377c78936bb8af7b86))
* use npm provenance publishing with trusted publisher ([97d2f9b](https://github.com/powerhouse-inc/renown-package/commit/97d2f9bb4279226a5204faf3d7d3aa8e336f537e))
* use pnpm dlx to run ph-cli without global install ([ad9a4f3](https://github.com/powerhouse-inc/renown-package/commit/ad9a4f3f98dbf7b58ef6810386e21f2f6db79ce6))
* use pnpm dlx to run ph-cli without global install ([df86f32](https://github.com/powerhouse-inc/renown-package/commit/df86f32b55f3c185fc9029fe3f4bfaf1a09bae42))
* use pnpm instead of npm for package operations ([1133c32](https://github.com/powerhouse-inc/renown-package/commit/1133c325bda90118c052ff29510455618a584d0b))
* use pnpm update for syncing powerhouse dependencies ([eb48e53](https://github.com/powerhouse-inc/renown-package/commit/eb48e531aa23f6d390c3f5cf4f16fdcf13ef167a))
* use pnpm update for syncing powerhouse dependencies ([5bc7867](https://github.com/powerhouse-inc/renown-package/commit/5bc7867681438afa4cef27d4cd782d1008b48b50))


### Features

* add build step to sync job before committing ([93d6b46](https://github.com/powerhouse-inc/renown-package/commit/93d6b46ce0114d3442d5d7aabb43ac1e8bea0a76))
* add build step to sync job before committing ([c4303d5](https://github.com/powerhouse-inc/renown-package/commit/c4303d5870f29d9845d411bbb1864993c197abf7))
* add Docker support and CI/CD workflow for downstream sync ([330f3b7](https://github.com/powerhouse-inc/renown-package/commit/330f3b702fb3a16e01089416bbd3a8072fdfd185))
* add Docker support and CI/CD workflow for downstream sync ([d5d509e](https://github.com/powerhouse-inc/renown-package/commit/d5d509eebfd99871577f6e4e5745d5eb8b46ee00))
* added getProfile(s) queries ([c4794f7](https://github.com/powerhouse-inc/renown-package/commit/c4794f7dc87f422e00458d35936eeae30c2830a5))
* added new renownUser queries ([09107b2](https://github.com/powerhouse-inc/renown-package/commit/09107b2c06ac35bcea360183fac7ed07d2ee679b))
* added renown credential ([cedb33b](https://github.com/powerhouse-inc/renown-package/commit/cedb33bc56769b78a3db8ff3d8fb52f006568275))
* added renown credential ([82b737c](https://github.com/powerhouse-inc/renown-package/commit/82b737c8784a187a5b8c9c5ef5a2d399a3d530e0))
* added renown credential processor and subgraph queries ([a6742c0](https://github.com/powerhouse-inc/renown-package/commit/a6742c09c2a2aa2207529cce6f260c932945a24f))
* support eip712 ([35b6920](https://github.com/powerhouse-inc/renown-package/commit/35b6920a1e9fc228ccd9d0a14ab12ddf08a60855))
* work with eip712 credentials ([e02540e](https://github.com/powerhouse-inc/renown-package/commit/e02540e93aa92a08c4e74ee72c72941b2c17fe34))
