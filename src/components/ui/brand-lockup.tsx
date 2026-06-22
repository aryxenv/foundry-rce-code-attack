import accountLogo from "@/assets/account.png";
import microsoftLogo from "@/assets/microsoft.svg";
import { cn } from "@/lib/utils";

export function BrandLockup({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex h-5 shrink-0 items-center gap-2", className)}
      aria-label="Microsoft and Foundry"
    >
      <img
        src={microsoftLogo}
        alt="Microsoft"
        className="h-full w-auto object-contain"
      />
      <span className="text-xs font-semibold text-muted-foreground">×</span>
      <img
        src={accountLogo}
        alt="Foundry"
        className="h-full w-auto object-contain"
      />
    </div>
  );
}
