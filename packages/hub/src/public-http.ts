/**
 * GET for addresses that came from outside (the page of a content, the image it names). It only talks
 * to public servers over https: the address is checked when the connection is made, after the name is
 * resolved, so neither a redirect nor a name that points inside (this computer, the network of the
 * server) can be used to read what is there. No cookies, and nothing about the user, are sent.
 */
import { type LookupAddress, lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import { BlockList, type LookupFunction, isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

const MAX_REDIRECTS = 5;

/** IPv4 ranges that are not servers on the internet. */
const PRIVATE_V4 = new BlockList();
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
  ["224.0.0.0", 3],
] as const)
  PRIVATE_V4.addSubnet(network, prefix, "ipv4");

// Of IPv6, only 2000::/3 is public, without the ranges in it that carry other addresses or are examples
const PUBLIC_V6 = new BlockList();
PUBLIC_V6.addSubnet("2000::", 3, "ipv6");
const PRIVATE_V6 = new BlockList();
PRIVATE_V6.addSubnet("2001::", 23, "ipv6");
PRIVATE_V6.addSubnet("2001:db8::", 32, "ipv6");
PRIVATE_V6.addSubnet("2002::", 16, "ipv6");

export function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return !PRIVATE_V4.check(address, "ipv4");
    case 6:
      return PUBLIC_V6.check(address, "ipv6") && !PRIVATE_V6.check(address, "ipv6");
    default:
      return false;
  }
}

/** Why an address is not asked at all, or null. */
export function refusal(url: URL): string | null {
  if (url.protocol !== "https:") return "not https";
  if (url.port !== "") return "unusual port";
  if (url.username !== "" || url.password !== "") return "credentials in the address";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0 && !isPublicAddress(host)) return "not a public address";
  return null;
}

/** `dns.lookup` that fails when a name points to an address that is not public. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, found) => {
    const addresses = (found ?? []) as LookupAddress[];
    if (error) return callback(error, "", 0);
    if (addresses.length === 0 || !addresses.every(({ address }) => isPublicAddress(address)))
      return callback(new Error(`${hostname} is not a public address`), "", 0);
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

export interface PublicResponse {
  status: number;
  /** The address that answered, after redirects. */
  url: string;
  body: Uint8Array;
}

export type PublicGet = (
  url: string,
  options: { accept: string; maxBytes: number },
) => Promise<PublicResponse>;

interface RawResponse extends PublicResponse {
  location: string | undefined;
}

function getOnce(url: URL, accept: string, maxBytes: number, signal: AbortSignal): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const call = request(
      url,
      {
        signal,
        lookup: publicLookup,
        agent: false,
        headers: {
          Accept: accept,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "de,en;q=0.5",
          "User-Agent": "Mozilla/5.0 (compatible; Mosaik)",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            const error = new Error(`${url.hostname} sent more than ${maxBytes} bytes`);
            reject(error);
            call.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              url: url.href,
              location: response.headers.location,
              body: decode(Buffer.concat(chunks), response.headers["content-encoding"], maxBytes),
            });
          } catch (error) {
            reject(error as Error);
          }
        });
      },
    );
    call.on("error", reject);
    call.end();
  });
}

function decode(body: Buffer, encoding: string | undefined, maxOutputLength: number): Uint8Array {
  if (body.length === 0) return body;
  switch (encoding?.toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return gunzipSync(body, { maxOutputLength });
    case "deflate":
      return inflateSync(body, { maxOutputLength });
    case "br":
      return brotliDecompressSync(body, { maxOutputLength });
    default:
      return body;
  }
}

/** Asks for an address, following redirects. Rejects when it is refused, too large or does not answer. */
export const getPublic: PublicGet = async (address, { accept, maxBytes }) => {
  const signal = AbortSignal.timeout(15_000);
  let url = new URL(address);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const reason = refusal(url);
    if (reason) throw new Error(`${url.hostname}: ${reason}`);
    const { location, ...response } = await getOnce(url, accept, maxBytes, signal);
    if (response.status < 300 || response.status >= 400 || !location) return response;
    url = new URL(location, url);
  }
  throw new Error(`${url.hostname}: too many redirects`);
};
