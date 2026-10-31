/*!
MIT License

Copyright (c) 2025 Sameer Singh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
"use client";

// Adapted from Lina by SameerJS6 (https://lina.sameer.sh) — use-has-primary-touch.
// Detects touch-primary devices (coarse pointer + touch points), updating live
// on pointer-mode and media-query changes. Returns false on the server and the
// first client render, so the non-touch branch is the hydration-stable default.

import { useEffect, useState } from "react";

export function useTouchPrimary() {
  const [isTouchPrimary, setIsTouchPrimary] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const controller = new AbortController();
    const { signal } = controller;

    const handleTouch = () => {
      const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
      const prefersTouch = window.matchMedia("(pointer: coarse)").matches;
      setIsTouchPrimary(hasTouch && prefersTouch);
    };

    const mq = window.matchMedia("(pointer: coarse)");
    mq.addEventListener("change", handleTouch, { signal });
    window.addEventListener("pointerdown", handleTouch, { signal });

    handleTouch();

    return () => controller.abort();
  }, []);

  return isTouchPrimary;
}
