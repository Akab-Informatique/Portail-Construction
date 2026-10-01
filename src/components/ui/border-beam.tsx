import type { CSSProperties } from "react"

import { cn } from "@/lib/utils"

interface BorderBeamProps {
  /** The size of the border beam. */
  size?: number
  /** Seconds for one lap around the border. */
  duration?: number
  /** Seconds the beam is offset along its lap. */
  delay?: number
  /** The color of the border beam from. */
  colorFrom?: string
  /** The color of the border beam to. */
  colorTo?: string
  /** The class name of the border beam. */
  className?: string
  /** The style of the border beam. */
  style?: CSSProperties
  /** Whether to reverse the animation direction. */
  reverse?: boolean
  /** The initial offset position (0-100). */
  initialOffset?: number
  /** The border width of the beam. */
  borderWidth?: number
}

/**
 * A light that travels around the element's border. Pure CSS (offset-path +
 * keyframes) so the login page does not need an animation library.
 */
export const BorderBeam = ({
  className,
  size = 50,
  delay = 0,
  duration = 6,
  colorFrom = "#ffaa40",
  colorTo = "#9c40ff",
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1,
}: BorderBeamProps) => {
  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]"
      style={{ "--border-beam-width": `${borderWidth}px` } as CSSProperties}
    >
      <div
        className={cn(
          "absolute aspect-square",
          "bg-linear-to-l from-(--color-from) via-(--color-to) to-transparent",
          className
        )}
        style={
          {
            width: size,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            offsetDistance: `${initialOffset}%`,
            "--color-from": colorFrom,
            "--color-to": colorTo,
            animation: `frx-border-beam ${duration}s linear ${-(delay + (initialOffset / 100) * duration)}s infinite${reverse ? " reverse" : ""}`,
            ...style,
          } as CSSProperties
        }
      />
    </div>
  )
}
