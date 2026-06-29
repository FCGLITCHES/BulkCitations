import { cn } from "@/lib/utils";

export interface BrandLogoProps {
  className?: string;
}

export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <img
      src="/brand-logo.png"
      alt=""
      aria-hidden="true"
      width={694}
      height={750}
      draggable={false}
      className={cn("h-8 w-auto shrink-0 object-contain", className)}
    />
  );
}
