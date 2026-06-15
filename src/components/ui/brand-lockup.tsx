import accountLogo from "@/assets/account.webp";
import microsoftLogo from "@/assets/microsoft.svg";
import { cn } from "@/lib/utils";

export function BrandLockup({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex h-5 shrink-0 items-center gap-2", className)}
      aria-label="Microsoft and Techorama"
    >
      <img
        src={microsoftLogo}
        alt="Microsoft"
        className="h-full w-auto object-contain"
      />
      <span className="text-xs font-semibold text-muted-foreground">×</span>
      <img
        src={accountLogo}
        alt="Techorama"
        className="h-full w-auto object-contain"
      />
    </div>
  );
}
