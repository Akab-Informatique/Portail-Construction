import * as React from "react"

import { cn } from "@/lib/utils"
import { List, ListOrdered } from "lucide-react"
import { CorrectPill, setNativeValue, useCanCorrect } from "@/components/CorrectButton"
import { useI18n } from "@/lib/i18n"

const BULLET = /^(\s*)([•\-*])\s/
const NUMBER = /^(\s*)(\d+)[.)]\s/

/** Turns the lines touched by the selection into a bullet or numbered list, or back into plain lines when they already are one. */
function toggleList(el: HTMLTextAreaElement, kind: "bullet" | "number") {
  const text = el.value
  const start = text.lastIndexOf("\n", el.selectionStart - 1) + 1
  const endAt = text.indexOf("\n", el.selectionEnd)
  const end = endAt === -1 ? text.length : endAt
  const lines = text.slice(start, end).split("\n")
  const marker = kind === "bullet" ? BULLET : NUMBER
  const content = lines.filter((l) => l.trim())
  const already = content.length > 0 && content.every((l) => marker.test(l))
  let n = 0
  const next = lines.map((l) => {
    const plain = l.replace(BULLET, "$1").replace(NUMBER, "$1")
    if (already || !l.trim()) return plain
    n += 1
    return kind === "bullet" ? `• ${plain.trimStart()}` : `${n}. ${plain.trimStart()}`
  })
  const replaced = next.join("\n")
  setNativeValue(el, text.slice(0, start) + replaced + text.slice(end))
  el.focus()
  el.setSelectionRange(start, start + replaced.length)
}

/** Enter at the end of a bullet or numbered line starts the next one; Enter on an empty one ends the list. */
function continueList(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
  const el = e.currentTarget
  if (el.selectionStart !== el.selectionEnd) return
  const pos = el.selectionStart
  const lineStart = el.value.lastIndexOf("\n", pos - 1) + 1
  const line = el.value.slice(lineStart, pos)
  const bullet = line.match(BULLET)
  const number = line.match(NUMBER)
  const hit = bullet ?? number
  if (!hit || pos !== (el.value.indexOf("\n", pos) === -1 ? el.value.length : el.value.indexOf("\n", pos))) return
  e.preventDefault()
  if (!line.slice(hit[0].length).trim()) {
    // an empty item: end the list
    setNativeValue(el, el.value.slice(0, lineStart) + el.value.slice(pos))
    el.setSelectionRange(lineStart, lineStart)
    return
  }
  const prefix = bullet ? `${hit[1]}${bullet[2]} ` : `${hit[1]}${Number(number![2]) + 1}. `
  setNativeValue(el, el.value.slice(0, pos) + "\n" + prefix + el.value.slice(pos))
  const caret = pos + 1 + prefix.length
  el.setSelectionRange(caret, caret)
}

/**
 * Every text area carries a small "Correct" button for staff: it fixes spelling and grammar with the AI.
 * Pass `correct={false}` where it makes no sense (codes, JSON, one-choice-per-line lists).
 */
function Textarea({ className, correct = true, onKeyDown, ...props }: React.ComponentProps<"textarea"> & { correct?: boolean }) {
  const { t } = useI18n()
  const wrap = React.useRef<HTMLDivElement>(null)
  const canCorrect = useCanCorrect()
  const [typed, setTyped] = React.useState("")
  const value = props.value !== undefined ? String(props.value) : typed
  const lists = correct && !props.disabled && !props.readOnly
  const show = correct && canCorrect && !props.disabled && !props.readOnly && value.trim().length >= 3

  return (
    <div ref={wrap} className="relative w-full" onInput={(e) => setTyped((e.target as HTMLTextAreaElement).value)}>
      <textarea
        data-slot="textarea"
        className={cn(
          "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
          className
        )}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (!e.defaultPrevented && lists) continueList(e)
        }}
        {...props}
      />
      {lists ? (
        <div className="absolute -bottom-2.5 left-2 z-10 inline-flex h-5 items-center overflow-hidden rounded-full border bg-background/95 shadow-sm backdrop-blur">
          {(
            [
              ["bullet", List, "list.bullet"],
              ["number", ListOrdered, "list.number"],
            ] as const
          ).map(([kind, Icon, label]) => (
            <button
              key={kind}
              type="button"
              tabIndex={-1}
              title={t(label)}
              aria-label={t(label)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const el = wrap.current?.querySelector("textarea")
                if (el) toggleList(el, kind)
              }}
              className="flex h-5 w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon className="size-3" />
            </button>
          ))}
        </div>
      ) : null}
      {show ? <CorrectPill text={value} getEl={() => wrap.current?.querySelector("textarea") ?? null} /> : null}
    </div>
  )
}

export { Textarea }
