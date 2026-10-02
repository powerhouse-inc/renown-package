import { normalizeAudience } from "../core/config.js";
import { open } from "../core/crypto.js";
import { GithubTokenError, type GithubVerifier } from "../core/github.js";
import { issueWorkloadToken } from "../core/keys.js";
import { classifyRun, isAudienceAllowed } from "../core/refs.js";
import type { JwkKeyPair, VetraWorkloadClaim } from "../core/types.js";
import type { WorkloadStore } from "../store/types.js";

/** Lifetime of an issued workload token, in seconds. */
export const WORKLOAD_TOKEN_TTL_SEC = 600;
const MAX_BODY_BYTES = 32 * 1024;

export interface ExchangeDeps {
  store: WorkloadStore;
  encryptionKey: Uint8Array;
  audiences: readonly string[];
  verifier: GithubVerifier;
  log?: (message: string) => void;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function error(status: number, code: string, description?: string): Response {
  return json(status, {
    error: code,
    ...(description !== undefined && { error_description: description }),
  });
}

const denied = (description: string) =>
  error(403, "access_denied", description);

async function readRequest(
  req: Request,
): Promise<{ subjectToken: string; audience: string } | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) return null;
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { subject_token: subjectToken, audience } = body as Record<
    string,
    unknown
  >;
  if (typeof subjectToken !== "string" || subjectToken.length === 0) {
    return null;
  }
  if (typeof audience !== "string" || audience.trim().length === 0) {
    return null;
  }
  return { subjectToken, audience: normalizeAudience(audience) };
}

/**
 * `POST workload/token`: exchanges a GitHub Actions OIDC token for a Renown
 * auth bearer token signed by the repository's App did:key. `deps()` is null
 * while the exchange is unconfigured, which answers 503.
 */
export function createTokenHandler(
  deps: () => ExchangeDeps | null,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const d = deps();
    if (d === null) return error(503, "temporarily_unavailable");
    const log = d.log ?? ((message: string) => console.info(message));

    const request = await readRequest(req);
    if (request === null) return error(400, "invalid_request");

    let claims;
    try {
      claims = await d.verifier.verify(request.subjectToken);
    } catch (e) {
      if (e instanceof GithubTokenError && e.kind === "unavailable") {
        console.error(`[renown-workload] ${e.message}`);
        return error(503, "temporarily_unavailable");
      }
      return error(401, "invalid_token");
    }

    const identity = await d.store.getByRepositoryId(claims.repository_id);
    if (!identity) {
      return denied("No workload identity is registered for this repository");
    }
    if (identity.repository.toLowerCase() !== claims.repository.toLowerCase()) {
      return denied("The repository does not match the registered identity");
    }
    const eventName = claims.event_name ?? "";
    const ref = classifyRun(eventName, claims.ref, identity.productionBranch);
    if (ref === null) {
      return denied(
        "Only push/workflow_dispatch on the production branch, push of v* tags and pull_request runs may deploy",
      );
    }
    if (!isAudienceAllowed(ref.refClass, request.audience, d.audiences)) {
      return denied(
        `Audience not allowed for ${ref.refClass.toLowerCase()} runs`,
      );
    }

    let keyPair: JwkKeyPair;
    try {
      keyPair = JSON.parse(
        await open(d.encryptionKey, identity.encryptedKeyPair, identity.did),
      ) as JwkKeyPair;
    } catch {
      console.error(
        `[renown-workload] cannot decrypt the key of ${identity.did} (wrong RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY?)`,
      );
      return error(500, "server_error");
    }

    const vetra: VetraWorkloadClaim = {
      ref: claims.ref,
      refClass: ref.refClass,
      sha: claims.sha ?? null,
      repository: claims.repository,
      repositoryId: claims.repository_id,
      runId: claims.run_id ?? null,
      runAttempt: claims.run_attempt ?? null,
      actor: claims.actor ?? null,
      prNumber: ref.prNumber,
      eventName,
      workflowRef: claims.job_workflow_ref ?? claims.workflow_ref ?? null,
    };
    const accessToken = await issueWorkloadToken({
      keyPair,
      did: identity.did,
      chainId: identity.chainId,
      address: identity.ownerAddress,
      audience: request.audience,
      expiresInSec: WORKLOAD_TOKEN_TTL_SEC,
      vetra,
    });
    log(
      `[renown-workload] issued token ${JSON.stringify({
        did: identity.did,
        repository: claims.repository,
        ref: claims.ref,
        event_name: eventName,
        run_id: vetra.runId,
        actor: vetra.actor,
        audience: request.audience,
      })}`,
    );
    return json(200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: WORKLOAD_TOKEN_TTL_SEC,
    });
  };
}
