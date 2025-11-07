import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn, getInitials } from "@/lib/utils"
import type { PublicUser } from "@shared/schema"

const sizeStyles = {
  sm: {
    avatar: "h-8 w-8",
    fallback: "text-xs",
  },
  md: {
    avatar: "h-10 w-10",
    fallback: "text-sm",
  },
} as const satisfies Record<"sm" | "md", { avatar: string; fallback: string }>

type UserAvatarProps = {
  user: Pick<PublicUser, "fullName" | "googleAvatar" | "yandexAvatar">
  size?: keyof typeof sizeStyles
  className?: string
}

export function UserAvatar({ user, size = "md", className }: UserAvatarProps) {
  const styles = sizeStyles[size] ?? sizeStyles.md
  const imageUrl = user.googleAvatar || user.yandexAvatar || ""
  const hasImage = Boolean(imageUrl)
  const initials = getInitials(user.fullName)

  return (
    <Avatar className={cn(styles.avatar, className)}>
      {hasImage ? <AvatarImage src={imageUrl} alt="" loading="lazy" /> : null}
      <AvatarFallback
        aria-label={!hasImage && user.fullName ? user.fullName : undefined}
        aria-hidden={hasImage ? true : undefined}
        className={cn("bg-muted", styles.fallback)}
      >
        {initials || "??"}
      </AvatarFallback>
    </Avatar>
  )
}
