"use client"

import * as React from "react"
import { Card } from "./card"

interface AnimatedCardProps extends React.ComponentProps<typeof Card> {
  delay?: number
}

const AnimatedCard = React.forwardRef<
  HTMLDivElement,
  AnimatedCardProps
>(({ delay = 0, children, className, ...props }, ref) => {
  // Map delay to staggered fade-in class
  const delayClass = delay <= 0 ? 'animate-fade-in'
    : delay <= 0.05 ? 'animate-fade-in-delay-1'
    : delay <= 0.1 ? 'animate-fade-in-delay-2'
    : delay <= 0.15 ? 'animate-fade-in-delay-3'
    : delay <= 0.2 ? 'animate-fade-in-delay-4'
    : 'animate-fade-in-delay-5'

  return (
    <div ref={ref} className={delayClass}>
      <Card className={className} {...props}>
        {children}
      </Card>
    </div>
  )
})
AnimatedCard.displayName = "AnimatedCard"

export { AnimatedCard }
