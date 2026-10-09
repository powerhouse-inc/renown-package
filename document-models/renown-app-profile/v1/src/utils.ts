const DID_PKH = /^did:pkh:eip155:[1-9][0-9]{0,19}:0x[0-9a-fA-F]{40}$/;
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{32,128}$/;
const DATA_IMAGE =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function protocolOf(value: string): string | null {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
}

export function isAppDid(value: string): boolean {
  return DID_KEY.test(value);
}

export function isPublisherDid(value: string): boolean {
  return DID_PKH.test(value);
}

export function isWebsite(value: string): boolean {
  const protocol = protocolOf(value);
  return protocol === "https:" || protocol === "http:";
}

export function isLogo(value: string): boolean {
  return DATA_IMAGE.test(value) || protocolOf(value) === "https:";
}
