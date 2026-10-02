/** TXT lookups over DNS-over-HTTPS (Cloudflare's resolver), so verification needs no extra infrastructure. */
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const normalizeDomain = (raw: string): string | null => {
  const d = raw.trim().toLowerCase().replace(/\.$/, "");
  return DOMAIN.test(d) ? d : null;
};

export const txtHost = (domain: string) => `_flaregit.${domain}`;
export const txtValue = (token: string) => `flaregit-site-verification=${token}`;

export async function lookupTxt(name: string): Promise<string[]> {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`DNS resolver answered ${res.status}`);
  const body = (await res.json()) as { Status: number; Answer?: Array<{ type: number; data: string }> };
  if (body.Status !== 0 && body.Status !== 3) throw new Error(`DNS lookup failed (status ${body.Status})`); // 3 = NXDOMAIN: no record yet
  return (body.Answer ?? []).filter((a) => a.type === 16).map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s+"/g, ""));
}
