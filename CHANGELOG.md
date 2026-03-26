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
