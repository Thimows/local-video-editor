"use client"

import { useEffect, useState } from "react"
import { IconExclamationCircleFilled as CircleExclamation } from "@tabler/icons-react"

import { ChromiumBrowserPills } from "@/components/chromium-browser-support"
import { isCurrentBrowserChromium } from "@/lib/browser/chromium"
import {
  getNonChromiumBrowserWarningAcknowledgedAt,
  saveNonChromiumBrowserWarningAcknowledgedAt,
} from "@/lib/editor/db"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog"

const WARNING_REPEAT_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000
const WARNING_COUNTDOWN_SECONDS = 5

export function NonChromiumBrowserWarningDialog() {
  const [open, setOpen] = useState(false)
  const [countdownSeconds, setCountdownSeconds] = useState(
    WARNING_COUNTDOWN_SECONDS
  )
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function checkBrowserWarning() {
      if (isCurrentBrowserChromium()) {
        return
      }

      const acknowledgedAt =
        await getNonChromiumBrowserWarningAcknowledgedAt().catch(() => null)
      const shouldShow =
        acknowledgedAt === null ||
        Date.now() - acknowledgedAt > WARNING_REPEAT_INTERVAL_MS

      if (!cancelled && shouldShow) {
        setCountdownSeconds(WARNING_COUNTDOWN_SECONDS)
        setOpen(true)
      }
    }

    void checkBrowserWarning()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!open || countdownSeconds <= 0) {
      return
    }

    const timeout = window.setTimeout(() => {
      setCountdownSeconds((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearTimeout(timeout)
  }, [countdownSeconds, open])

  async function continueAnyway() {
    if (countdownSeconds > 0 || isSaving) {
      return
    }

    setIsSaving(true)
    await saveNonChromiumBrowserWarningAcknowledgedAt().catch(() => undefined)
    setOpen(false)
    setIsSaving(false)
  }

  const waiting = countdownSeconds > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true)
        }
      }}
      disablePointerDismissal
    >
      <DialogContent
        className="w-[min(calc(100vw-2rem),34rem)]"
        showCloseButton={false}
      >
        <div className="flex items-start gap-3 pr-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <CircleExclamation className="size-5" />
          </span>
          <div className="grid gap-3">
            <DialogTitle className="flex min-h-9 items-center">
              Works best on Chromium browsers
            </DialogTitle>
            <DialogDescription>
              You are not on a Chromium browser. Some editor features can behave
              unexpectedly here, and local video editing can get risky fast. Use
              a Chromium browser for the most reliable experience.
            </DialogDescription>
            <ChromiumBrowserPills />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            onClick={continueAnyway}
            disabled={waiting || isSaving}
          >
            {waiting
              ? `I'm feeling risky (${countdownSeconds})`
              : "I'm feeling risky"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
