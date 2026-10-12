import { promises as dns } from "node:dns";
import https from "node:https";
import { BlockList, isIP } from "node:net";

export const FETCH_TIMEOUT_MS = 5_000;
export const FETCH_MAX_BYTES = 65_536;

// Everything that is not the public internet (spec §3.6): private, loopback,
// link-local (with the 169.254.169.254 metadata address), CGNAT, ULA,
// unspecified, multicast, broadcast and reserved/documentation ranges.
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  // Unspecified, loopback and the deprecated IPv4-compatible ::a.b.c.d.
  ["::", 96],
  // SIIT IPv4-translated ::ffff:0:a.b.c.d.
  ["::ffff:0:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv6");
}

const MAPPED_RE = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

/** The IPv4 address an IPv4-mapped IPv6 address (::ffff:a.b.c.d, in any spelling) stands for, else null. */
function mappedIpv4(ip: string): string | null {
  let normalized: string;
  try {
    normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const match = MAPPED_RE.exec(normalized);
  if (!match) return null;
  const high = parseInt(match[1], 16);
  const low = parseInt(match[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/** True only for a literal IP address on the public internet (IPv4-mapped IPv6 is judged as its IPv4 address). */
export function isPublicAddress(ip: string): boolean {
  // Zone ids (fe80::1%eth0) only name local links.
  if (ip.includes("%")) return false;
  const family = isIP(ip);
  if (family === 0) return false;
  try {
    if (family === 4) return !BLOCKED.check(ip, "ipv4");
    const v4 = mappedIpv4(ip);
    if (v4 !== null) return !BLOCKED.check(v4, "ipv4");
    return !BLOCKED.check(ip, "ipv6");
  } catch {
    return false;
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PinnedRequest {
  url: URL;
  /** The vetted address the connection must use (no second DNS lookup). */
  address: string;
  family: 4 | 6;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
}

export interface PinnedResponse {
  status: number;
  body: Uint8Array;
  /** The body exceeded maxBytes and was cut off. */
  truncated: boolean;
}

/** DNS and HTTPS, injectable for tests. */
export interface NetDeps {
  lookup(host: string): Promise<ResolvedAddress[]>;
  resolveTxt(name: string): Promise<string[][]>;
  request(request: PinnedRequest): Promise<PinnedResponse>;
}

export class NetGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetGuardError";
  }
}

/** `promise`, or a rejection after `ms` (DNS calls have no timeout of their own). */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

type LookupCallback = (error: Error | null, address: string | { address: string; family: number }[], family?: number) => void;

/**
 * HTTPS to `target.address` with the SNI, certificate name and Host of the
 * URL; never follows redirects; aborts at the timeout or the size cap. No
 * agent, so no pooled socket from an earlier resolution is reused.
 */
function pinnedHttpsRequest(target: PinnedRequest): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    const host = target.url.hostname.replace(/^\[|\]$/g, "");
    const pinnedLookup = (_hostname: string, options: { all?: boolean } | undefined, callback: LookupCallback) => {
      if (options?.all) callback(null, [{ address: target.address, family: target.family }]);
      else callback(null, target.address, target.family);
    };
    const request = https.request(
      {
        host,
        servername: isIP(host) ? undefined : host,
        port: target.url.port ? Number(target.url.port) : 443,
        path: `${target.url.pathname}${target.url.search}`,
        method: target.method,
        headers: { ...target.headers, host: target.url.host },
        agent: false,
        lookup: pinnedLookup as never,
      },
      (response) => {
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > target.maxBytes) {
            settle(() => resolve({ status: response.statusCode ?? 0, body: new Uint8Array(), truncated: true }));
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          settle(() => resolve({ status: response.statusCode ?? 0, body: new Uint8Array(Buffer.concat(chunks)), truncated: false })),
        );
        response.on("error", (error) => settle(() => reject(error)));
      },
    );
    timer = setTimeout(() => {
      const error = new Error("timeout");
      settle(() => reject(error));
      request.destroy(error);
    }, target.timeoutMs);
    request.on("error", (error) => settle(() => reject(error)));
    if (target.body !== undefined) request.write(target.body);
    request.end();
  });
}

export const nodeNetDeps: NetDeps = {
  lookup: async (host) =>
    (await withTimeout(dns.lookup(host, { all: true, verbatim: true }), FETCH_TIMEOUT_MS, `lookup ${host}`)).map(({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4,
    })),
  resolveTxt: (name) => withTimeout(dns.resolveTxt(name), FETCH_TIMEOUT_MS, `TXT ${name}`),
  request: pinnedHttpsRequest,
};

/** Connection-level failures after which the next vetted address is tried. */
const CONNECT_ERRORS = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EADDRNOTAVAIL", "ETIMEDOUT"]);

function isConnectError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && CONNECT_ERRORS.has(code);
}

/**
 * `promise`, or a NetGuardError once `deadline` (epoch ms) passes. One
 * deadline spans every step of an attempt (DNS, connect, response), so the
 * steps share the 5 s instead of getting 5 s each.
 */
export function beforeDeadline<T>(promise: Promise<T>, deadline: number, what: string): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    // The step may still settle; its outcome no longer matters.
    promise.catch(() => undefined);
    return Promise.reject(new NetGuardError(`${what} timed out`));
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NetGuardError(`${what} timed out`)), remaining);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The one message for a host that does not resolve or resolves to any non-public address (no internal-DNS oracle). */
function notPublic(host: string): NetGuardError {
  return new NetGuardError(`${host} is not a public host (it does not resolve, or resolves to a non-public address)`);
}

/**
 * The URL rules of every organisation fetch (spec §3.6), shared by the checks
 * made when a URL is saved and the ones made on every request: HTTPS, no
 * credentials, an allowed port (`ports`, 443 when the URL names none; any
 * when omitted), and a host that resolves before `deadline` (epoch ms) to
 * public addresses only. A failed or non-public resolution gets one message.
 * Throws NetGuardError.
 */
export async function vetUrl(
  deps: Pick<NetDeps, "lookup">,
  rawUrl: string,
  options: { deadline: number; ports?: readonly number[] },
): Promise<{ url: URL; host: string; addresses: ResolvedAddress[] }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new NetGuardError("Not a URL");
  }
  if (url.protocol !== "https:") throw new NetGuardError("Only https URLs are fetched");
  if (url.username || url.password) throw new NetGuardError("URLs with credentials are not fetched");
  const port = url.port ? Number(url.port) : 443;
  if (options.ports && !options.ports.includes(port)) throw new NetGuardError(`Port ${port} is not allowed`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  let addresses: ResolvedAddress[];
  if (literal !== 0) {
    addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await beforeDeadline(deps.lookup(host), options.deadline, `lookup ${host}`);
    } catch (error) {
      if (error instanceof NetGuardError) throw error;
      throw notPublic(host);
    }
  }
  if (addresses.length === 0 || !addresses.every((entry) => isPublicAddress(entry.address))) throw notPublic(host);
  return { url, host, addresses };
}

/**
 * Fetches `rawUrl` under the organisation fetch rules (spec §3.6): HTTPS
 * only, no credentials in the URL, every resolved address public (checked
 * after DNS resolution; the connection is pinned to a checked address, so
 * there is no second lookup to rebind), one 5 s deadline for DNS, connect and
 * response together (`deadline` shares it with earlier steps, such as a TXT
 * lookup), 64 KiB, no redirects (a 3xx comes back as is). The vetted
 * addresses are tried in order until one connects. Throws NetGuardError when
 * a rule refuses it or the deadline passes.
 */
export async function guardedRequest(
  deps: NetDeps,
  rawUrl: string,
  init: {
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    /** Epoch ms by which the whole attempt must be done; defaults to now + timeoutMs. */
    deadline?: number;
    maxBytes?: number;
    /** Ports the URL may name (443 when it names none); any port when omitted. */
    ports?: readonly number[];
    /** A response larger than maxBytes keeps its status and loses its body, instead of being refused. */
    truncate?: boolean;
  },
): Promise<{ status: number; body: Uint8Array }> {
  const deadline = init.deadline ?? Date.now() + (init.timeoutMs ?? FETCH_TIMEOUT_MS);
  const { url, host, addresses } = await vetUrl(deps, rawUrl, { deadline, ports: init.ports });
  const maxBytes = init.maxBytes ?? FETCH_MAX_BYTES;
  let lastError: unknown;
  for (const [index, target] of addresses.entries()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new NetGuardError(`${host} timed out`);
    let response: PinnedResponse;
    try {
      response = await beforeDeadline(
        deps.request({
          url,
          address: target.address,
          family: target.family,
          method: init.method,
          headers: init.headers ?? {},
          body: init.body,
          timeoutMs: remaining,
          maxBytes,
        }),
        deadline,
        host,
      );
    } catch (error) {
      lastError = error;
      if (isConnectError(error) && index < addresses.length - 1) continue;
      throw error;
    }
    if (response.truncated) {
      if (init.truncate) return { status: response.status, body: new Uint8Array() };
      throw new NetGuardError(`The response is larger than ${maxBytes} bytes`);
    }
    return { status: response.status, body: response.body };
  }
  throw lastError;
}
