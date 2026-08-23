'use client';
// src/lib/calls/usePictureInPicture.ts
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Document Picture-in-Picture — a real OS-level window the user can drag to a
 * second monitor.
 *
 * ⚠️ Why this and NOT window.open:
 * Opening a new window means mounting a second React tree, which would rejoin
 * the LiveKit room in a fresh context. Same identity, two connections — LiveKit
 * evicts the first with DUPLICATE_IDENTITY and the disconnect handler tears
 * down the second. Both calls die. That cost an hour on Phase 3.
 *
 * Document PiP MOVES the existing DOM node into the new window. The media
 * elements, their tracks, and the connection are never re-established.
 *
 * Chrome and Edge only. Everything else falls back to in-page layout.
 */
type DocumentPiP = {
  requestWindow: (opts: { width: number; height: number }) => Promise<Window>;
  window: Window | null;
};

function api(): DocumentPiP | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { documentPictureInPicture?: DocumentPiP })
    .documentPictureInPicture ?? null;
}

export function pipSupported(): boolean {
  return api() !== null;
}

export function usePictureInPicture(onClosed?: () => void) {
  const [active, setActive] = useState(false);
  const pipWindow = useRef<Window | null>(null);
  const placeholder = useRef<Comment | null>(null);
  const movedNode = useRef<HTMLElement | null>(null);

  /** Returns the node to its original position, wherever the call came from. */
  const restore = useCallback(() => {
    const node = movedNode.current;
    const mark = placeholder.current;
    if (node && mark?.parentNode) {
      mark.parentNode.insertBefore(node, mark);
      mark.remove();
    }
    movedNode.current = null;
    placeholder.current = null;
    pipWindow.current = null;
    setActive(false);
    onClosed?.();
  }, [onClosed]);

  const open = useCallback(async (node: HTMLElement) => {
    const pip = api();
    if (!pip || pipWindow.current) return false;

    try {
      const win = await pip.requestWindow({ width: 480, height: 320 });
      pipWindow.current = win;

      /**
       * Stylesheets do NOT follow the node. Without copying them the call
       * renders as unstyled HTML in the floating window — which looks broken
       * rather than minimal.
       */
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const css = Array.from(sheet.cssRules).map((r) => r.cssText).join('');
          const style = win.document.createElement('style');
          style.textContent = css;
          win.document.head.appendChild(style);
        } catch {
          // Cross-origin sheet — link it instead of reading it.
          if (sheet.href) {
            const link = win.document.createElement('link');
            link.rel = 'stylesheet';
            link.href = sheet.href;
            win.document.head.appendChild(link);
          }
        }
      }

      // Carry theme and direction across, or the window is light-mode LTR
      // regardless of the user's settings.
      win.document.documentElement.setAttribute(
        'data-theme', document.documentElement.getAttribute('data-theme') ?? 'system');
      win.document.documentElement.setAttribute(
        'dir', document.documentElement.getAttribute('dir') ?? 'ltr');
      win.document.body.style.margin = '0';
      // Falls back to the brand aubergine if the copied stylesheets have not
      // applied yet — a white flash in a floating window is jarring.
      win.document.body.style.background = 'var(--bg, #2B0429)';

      // Leave a marker so the node returns to exactly where it was.
      const mark = document.createComment('pip-placeholder');
      node.parentNode?.insertBefore(mark, node);
      placeholder.current = mark;
      movedNode.current = node;

      win.document.body.append(node);
      win.addEventListener('pagehide', restore, { once: true });

      setActive(true);
      return true;
    } catch {
      pipWindow.current = null;
      return false;
    }
  }, [restore]);

  const close = useCallback(() => {
    pipWindow.current?.close();
    // pagehide fires and restore() runs, but call it directly in case the
    // window was already gone.
    if (!pipWindow.current) restore();
  }, [restore]);

  // Leaving the page with a floating window open would strand it.
  useEffect(() => () => { pipWindow.current?.close(); }, []);

  return { active, open, close, supported: pipSupported() };
}
