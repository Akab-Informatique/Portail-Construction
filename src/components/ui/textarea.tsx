import * as React from "react"

import { cn } from "@/lib/utils"
import { CorrectPill, useCanCorrect } from "@/components/CorrectButton"

/**
 * Every text area carries a small "Correct" button for staff: it fixes spelling and grammar with the AI.
 * Pass `correct={false}` where it makes no sense (codes, JSON, one-choice-per-line lists).
 */
function Textarea({ className, correct = true, ...props }: React.ComponentProps<"textarea"> & { correct?: boolean }) {
  const wrap = React.useRef<HTMLDivElement>(null)
  const canCorrect = useCanCorrect()
  const [typed, setTyped] = React.useState("")
  const value = props.value !== undefined ? String(props.value) : typed
  const show = correct && canCorrect && !props.disabled && !props.readOnly && value.trim().length >= 3

  return (
    <div ref={wrap} className="relative w-full" onInput={(e) => setTyped((e.target as HTMLTextAreaElement).value)}>
      <textarea
        data-slot="textarea"
        className={cn(
          "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
          className
        )}
        {...props}
      />
      {show ? <CorrectPill text={value} getEl={() => wrap.current?.querySelector("textarea") ?? null} /> : null}
    </div>
  )
}

export { Textarea }
