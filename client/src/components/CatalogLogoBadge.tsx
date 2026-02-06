import { useState } from "react";
import { cn } from "@/lib/utils";

type CatalogLogoBadgeProps = {
  src?: string;
  alt: string;
  fallback: string;
  wrapperClassName?: string;
  imageClassName?: string;
};

export function CatalogLogoBadge({
  src,
  alt,
  fallback,
  wrapperClassName,
  imageClassName,
}: CatalogLogoBadgeProps) {
  const [hasImageError, setHasImageError] = useState(false);
  const canRenderImage = Boolean(src) && !hasImageError;

  return (
    <div
      className={cn(
        "flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-slate-200/80 bg-white text-[10px] font-semibold uppercase tracking-tight text-slate-600",
        wrapperClassName,
      )}
    >
      {canRenderImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn("h-full w-full object-contain p-1.5", imageClassName)}
          onError={() => setHasImageError(true)}
        />
      ) : (
        fallback
      )}
    </div>
  );
}
