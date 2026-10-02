import { cn } from "@/lib/utils";

export function CloudflareBadge({ className }: { className?: string }) {
  return <a href="https://www.cloudflare.com/" target="_blank" rel="noopener noreferrer" className={cn("inline-block shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
    <img src="/cloudflare-protected-badge.png" alt="Protected by Cloudflare" width={761} height={264} loading="lazy" className="block h-auto w-[190px]" />
  </a>;
}
