# Smoke scripts

## attachment-upload.ts

End-to-end check of a Renown switchboard's attachment store, with no human
interaction:

```sh
node scripts/smoke/attachment-upload.ts                       # Renown staging
node scripts/smoke/attachment-upload.ts --switchboard <url>   # another staging switchboard
node scripts/smoke/attachment-upload.ts --switchboard <url> --allow-prod   # non-staging
node scripts/smoke/attachment-upload.ts --reserve-path /some/gated/route   # other reservation route
# or: npx tsx scripts/smoke/attachment-upload.ts
```

Node 24 runs the `.ts` file directly (type stripping); `npx tsx` works too.

Safety: the script refuses to run against a switchboard whose host is not a
staging host (or localhost) unless `--allow-prod` is passed. It issues a
throwaway credential and **revokes it at the end** (also when a step fails)
through `renown_revokeCredential`, signed by the throwaway wallet, so a run
leaves no live credential. A failed revoke is reported and exits 1.

`--reserve-path` (default `/attachments/reservations`) sets the reservation
route. The raw route is blocked at the ingress; Phase 1 adds a gated upload
route, which is then passed here. The status and filesystem-PUT calls use
`<reserve-path>/:id`.

What it does:

1. Generates a throwaway wallet (viem) and app `did:key` (`@renown/sdk`
   `RenownCryptoBuilder` + `MemoryKeyStorage`).
2. Signs a delegation credential wallet -> did:key (`buildAndSignCredential`)
   and stores it with the self-authenticating `renown_issueCredential`
   mutation (no Authorization header).
3. Mints a bearer the way Connect does (`RenownCrypto.getBearerToken(address)`).
4. Checks an anonymous `POST <reserve-path>` is refused (401), then
   reserves hash-first with the bearer and uploads a generated 64x64 PNG:
   to the reservation's presigned `uploadTarget` on S3 backends, else
   `PUT /attachments/reservations/:id`. Verifies the returned ref is
   `attachment://v1:<sha256 of the bytes>`.
5. Probes `GET /attachments/<hash>/download-target` anonymously and with the
   bearer, with and without `?documentId=` (informational).
6. Revokes the throwaway credential.

Prints only the wallet address, the did, and the ref — never private keys,
bearer tokens or presigned URLs. Exits 1 with the server's response on any
failure.

Against a switchboard with renown-package ≥ identity hub phase 1, pass the
gated route: `--reserve-path /api/@powerhousedao/renown-package/media/uploads`
(it accepts this script's reservation body; a status `GET <reserve-path>/:id`
is informational and may 404).

## identity-profile.ts

End-to-end check of profile identity (identity hub phase 1) on a switchboard
and the renown.id app in front of it:

```sh
node scripts/smoke/identity-profile.ts                                   # Renown staging
node scripts/smoke/identity-profile.ts --switchboard <url> --app <url>   # another staging/local stack
node scripts/smoke/identity-profile.ts --switchboard https://switchboard.renown.vetra.io \
  --app https://www.renown.id --allow-prod                               # production
```

Same guard and cleanup as attachment-upload.ts: non-staging switchboards
need `--allow-prod`; the throwaway credentials are revoked at the end (also on
failure). With a throwaway wallet it:

1. Issues a credential and mints a bearer.
2. Checks the gated upload route (`POST /api/@powerhousedao/renown-package/media/uploads`)
   refuses no bearer (401), SVG (415) and 3 MB (413), and that storage refuses
   a PUT whose length differs from the declared size.
3. Uploads a PNG avatar, then checks storage refuses tampered PUTs to a fresh
   target (extra bytes, wrong `x-amz-checksum-sha256`, `text/html` content type).
4. Saves display name, a fresh `smoke-xxxxxx` handle, bio, a link and the
   avatar with one signed `renown_upsertProfile`, and waits for
   `renownUser(input: { handle })`.
5. Checks `INVALID_AVATAR` (a ref never uploaded) and `HANDLE_TAKEN` (a second
   wallet, different case).
6. Probe (report only): a second identity tries `mutateDocument` on
   `/graphql/r` against the profile; prints `PROBE_BYPASS_POSSIBLE` if it works.
7. Follows the switchboard media route (302 + cache policy) to the image and
   compares its sha256; checks renown.id `/media/<doc>/avatar` (302),
   `/@<handle>` (200) and `/profile/<doc>` (307 → `/@<handle>`).
8. Clears the handle and avatar, then revokes the credentials.

Prints only the wallet address and the profile document id.
