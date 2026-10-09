# Smoke scripts

## attachment-upload.ts

End-to-end check of a Renown switchboard's attachment store, with no human
interaction:

```sh
node scripts/smoke/attachment-upload.ts                       # Renown staging
node scripts/smoke/attachment-upload.ts --switchboard <url>   # any switchboard
# or: npx tsx scripts/smoke/attachment-upload.ts
```

Node 24 runs the `.ts` file directly (type stripping); `npx tsx` works too.

What it does:

1. Generates a throwaway wallet (viem) and app `did:key` (`@renown/sdk`
   `RenownCryptoBuilder` + `MemoryKeyStorage`).
2. Signs a delegation credential wallet -> did:key (`buildAndSignCredential`)
   and stores it with the self-authenticating `renown_issueCredential`
   mutation (no Authorization header).
3. Mints a bearer the way Connect does (`RenownCrypto.getBearerToken(address)`).
4. Checks an anonymous `POST /attachments/reservations` is refused (401), then
   reserves hash-first with the bearer and uploads a generated 64x64 PNG:
   to the reservation's presigned `uploadTarget` on S3 backends, else
   `PUT /attachments/reservations/:id`. Verifies the returned ref is
   `attachment://v1:<sha256 of the bytes>`.
5. Probes `GET /attachments/<hash>/download-target` anonymously and with the
   bearer, with and without `?documentId=` (informational).

Prints only the wallet address, the did, and the ref — never private keys,
bearer tokens or presigned URLs. Exits 1 with the server's response on any
failure.
