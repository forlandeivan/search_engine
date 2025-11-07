import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getInitials(fullName: string) {
  if (!fullName) {
    return ""
  }

  const normalized = fullName.trim().replace(/\s+/g, " ")

  if (!normalized) {
    return ""
  }

  const words = normalized.split(" ").filter(Boolean)

  if (words.length === 0) {
    return ""
  }

  const firstWordChars = Array.from(words[0])
  const secondWordChars = words[1] ? Array.from(words[1]) : []

  const firstInitial = firstWordChars[0] ?? ""
  const secondInitial = (secondWordChars[0] ?? firstWordChars[1]) ?? ""

  const initials = `${firstInitial}${secondInitial}`.trim()

  return initials.toUpperCase()
}
