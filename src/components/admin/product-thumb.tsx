import Image from "next/image";
import { productImageUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";

export function ProductThumb({
  path,
  name,
  size = 40,
  className,
}: {
  path: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const url = productImageUrl(path);

  if (url) {
    return (
      <Image
        src={url}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-md border border-border object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "grid shrink-0 place-items-center rounded-md border border-border bg-secondary font-display text-sm font-bold text-muted-foreground",
        className,
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
