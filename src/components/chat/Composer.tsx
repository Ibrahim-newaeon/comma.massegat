'use client';
// src/components/chat/Composer.tsx
import { useRef, useState, useEffect } from 'react';
import type { Dict } from '@/lib/i18n/dict';
import { VoiceRecorder } from '@/components/files/VoiceRecorder';

export function Composer({
  dict, disabled, onSend, onTypingStart, onTypingStop, onFiles, hasPendingAttachments,
}: {
  dict: Dict;
  disabled: boolean;
  onSend: (body: string) => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  onFiles: (files: File[]) => void;
  hasPendingAttachments: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [value, setValue] = useState('');
  const typingRef = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => { if (stopTimer.current) clearTimeout(stopTimer.current); }, []);

  function handleChange(next: string) {
    setValue(next);

    if (!typingRef.current && next.length > 0) {
      typingRef.current = true;
      onTypingStart();
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      typingRef.current = false;
      onTypingStop();
    }, 2500);
  }

  function submit() {
    const body = value.trim();
    // A message may be attachments only — an empty body is valid then.
    if ((!body && !hasPendingAttachments) || disabled) return;
    onSend(body);
    setValue('');
    typingRef.current = false;
    onTypingStop();
    textarea.current?.focus();
  }

  return (
    <div
      className={`flex items-end gap-2 border-t p-3 ${
        dragging ? 'border-[var(--accent)] bg-[var(--surface)]' : 'border-[var(--border)]'
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) onFiles(files);
      }}
      data-testid="composer"
      data-dragging={dragging}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        data-testid="file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          e.target.value = '';   // allows re-selecting the same file
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={disabled}
        data-testid="attach-file"
        aria-label={dict.attachFile}
        className="touch-target shrink-0 rounded-md border border-[var(--border)] px-3 disabled:opacity-50"
      >
        📎
      </button>

      <VoiceRecorder
        dict={dict}
        disabled={disabled}
        onRecorded={(file) => onFiles([file])}
      />
      <textarea
        ref={textarea}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter newlines — identical behaviour in both
          // directions. IME composition must not trigger a send.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length > 0) { e.preventDefault(); onFiles(files); }
        }}
        // dir="auto" flips live on the first strong character typed.
        dir="auto"
        rows={1}
        disabled={disabled}
        placeholder={dict.messagePlaceholder}
        aria-label={dict.messagePlaceholder}
        data-testid="composer-input"
        className="min-h-[56px] flex-1 resize-none rounded-md border border-[var(--border)] px-3 py-3 text-sm disabled:opacity-50"
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || (value.trim().length === 0 && !hasPendingAttachments)}
        data-testid="composer-send"
        aria-label={dict.send}
        className="touch-target rounded-md bg-[var(--accent)] px-4 font-medium text-[var(--accent-on)] disabled:opacity-50"
      >
        {dict.send}
      </button>
    </div>
  );
}
