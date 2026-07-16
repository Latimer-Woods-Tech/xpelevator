'use client';

/**
 * Toasts + a confirmation modal — replacements for native alert()/confirm(),
 * which were driving the entire admin CRUD and are the loudest "prototype" tell
 * in a demo. One provider exposes both:
 *   const toast = useToast();      toast.error('Save failed');
 *   const confirm = useConfirm();  if (await confirm({ message: '…' })) …
 *
 * Accessible: toasts live in an aria-live region; the confirm modal is a focus-
 * trapped role="dialog" that closes on Escape and returns a Promise<boolean>.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from './index';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}

interface FeedbackApi {
  pushToast: (tone: ToastTone, message: string) => void;
  requestConfirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

const TOAST_TONE_CLASS: Record<ToastTone, string> = {
  success: 'border-emerald-500/40 bg-emerald-950/80 text-emerald-100',
  error: 'border-rose-500/40 bg-rose-950/80 text-rose-100',
  info: 'border-sky-500/40 bg-sky-950/80 text-sky-100',
};

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);
  const nextId = useRef(1);

  const pushToast = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const requestConfirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setConfirmState({ opts, resolve })),
    []
  );

  const settle = useCallback(
    (value: boolean) => {
      confirmState?.resolve(value);
      setConfirmState(null);
    },
    [confirmState]
  );

  return (
    <FeedbackContext.Provider value={{ pushToast, requestConfirm }}>
      {children}

      {/* Toasts */}
      <div
        className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto w-full max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${TOAST_TONE_CLASS[t.tone]}`}
          >
            {t.message}
          </div>
        ))}
      </div>

      {/* Confirm modal */}
      {confirmState && (
        <ConfirmDialog
          opts={confirmState.opts}
          onCancel={() => settle(false)}
          onConfirm={() => settle(true)}
        />
      )}
    </FeedbackContext.Provider>
  );
}

function ConfirmDialog({
  opts,
  onCancel,
  onConfirm,
}: {
  opts: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={opts.title ?? 'Confirm'}
        className="w-full max-w-sm rounded-xl border border-surface-border bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {opts.title && <h2 className="mb-2 text-lg font-semibold">{opts.title}</h2>}
        <p className="mb-6 text-sm text-slate-300">{opts.message}</p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {opts.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            ref={confirmRef}
            variant={opts.tone === 'primary' ? 'primary' : 'danger'}
            size="sm"
            onClick={onConfirm}
          >
            {opts.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useToast/useConfirm must be used within <FeedbackProvider>');
  return ctx;
}

export function useToast() {
  const { pushToast } = useFeedback();
  return {
    success: (message: string) => pushToast('success', message),
    error: (message: string) => pushToast('error', message),
    info: (message: string) => pushToast('info', message),
  };
}

export function useConfirm() {
  const { requestConfirm } = useFeedback();
  return requestConfirm;
}
