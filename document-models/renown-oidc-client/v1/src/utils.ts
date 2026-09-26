const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DID_PKH = /^did:pkh:eip155:\d+:(0x[0-9a-fA-F]{40})$/;

export function normalizeSubject(subject: string): string {
  const s = subject.trim();
  if (ADDRESS.test(s)) return s.toLowerCase();
  const m = DID_PKH.exec(s);
  if (m) return m[1].toLowerCase();
  throw new Error(`Invalid subject: ${subject}`);
}

export function isValidRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
}
