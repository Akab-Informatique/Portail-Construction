import * as React from "react"

import { cn } from "@/lib/utils"
import { CorrectPill, useCanCorrect } from "@/components/CorrectButton"

const inputClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-white/40 px-3 py-1 text-base shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40"

/** `correct` adds the "Correct" button (AI spelling and grammar) for staff: use it on free-text lines such as titles and answers. */
function Input({ className, type, correct = false, ...props }: React.ComponentProps<"input"> & { correct?: boolean }) {
  if (correct && (type === undefined || type === "text")) return <CorrectInput className={className} {...props} />
  return <input type={type} data-slot="input" className={cn(inputClass, className)} {...props} />
}

function CorrectInput({ className, ...props }: React.ComponentProps<"input">) {
  const wrap = React.useRef<HTMLDivElement>(null)
  const canCorrect = useCanCorrect()
  const [typed, setTyped] = React.useState("")
  const value = props.value !== undefined ? String(props.value) : typed
  const show = canCorrect && !props.disabled && !props.readOnly && value.trim().length >= 3
  return (
    <div ref={wrap} className="relative w-full" onInput={(e) => setTyped((e.target as HTMLInputElement).value)}>
      <input type="text" data-slot="input" className={cn(inputClass, className)} {...props} />
      {show ? <CorrectPill text={value} getEl={() => wrap.current?.querySelector("input") ?? null} /> : null}
    </div>
  )
}

export { Input }
