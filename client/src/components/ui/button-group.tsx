"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function ButtonGroup({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "inline-flex -space-x-px shadow-xs rtl:space-x-reverse [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md [&>*:not(:first-child):not(:last-child)]:rounded-none [&>*]:rounded-none",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function ButtonGroupSeparator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "bg-border w-px h-6 self-center pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

export { ButtonGroup, ButtonGroupSeparator }
