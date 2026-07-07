import { createContext, useCallback, useContext, useId, useRef, useState } from 'react';
import { Icons } from './Icons';

const FeedbackContext = createContext(null);

export function AppFeedbackProvider({ children }) {
  const [confirmState, setConfirmState] = useState(null);
  const [toasts, setToasts] = useState([]);
  const resolverRef = useRef(null);
  const confirmTitleId = useId();

  const confirm = useCallback((options) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    setConfirmState({
      title: opts.title || 'Confirm action',
      message: opts.message || 'Are you sure?',
      confirmLabel: opts.confirmLabel || 'Confirm',
      cancelLabel: opts.cancelLabel || 'Cancel',
      danger: opts.danger ?? true,
    });
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const closeConfirm = useCallback((value) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setConfirmState(null);
    resolve?.(value);
  }, []);

  const notify = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((items) => [...items, { id, message, type }]);
    setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 3600);
  }, []);

  return (
    <FeedbackContext.Provider value={{ confirm, notify }}>
      {children}

      {confirmState && (
        <div className="modal-backdrop feedback-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && closeConfirm(false)}>
          <div className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby={confirmTitleId}>
            <div className="modal-header">
              <span className="modal-title" id={confirmTitleId}>{confirmState.title}</span>
              <button className="modal-close" onClick={() => closeConfirm(false)} aria-label="Cancel">
                <Icons.X size={16} />
              </button>
            </div>
            <div className="confirm-message">{confirmState.message}</div>
            <div className="modal-footer">
              <button className="btn btn-sec" onClick={() => closeConfirm(false)}>
                {confirmState.cancelLabel}
              </button>
              <button className={`btn ${confirmState.danger ? 'btn-danger' : 'btn-pri'}`} onClick={() => closeConfirm(true)}>
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="toast-stack" aria-live="polite" aria-atomic="false">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.type}`}>
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useConfirm() {
  return useContext(FeedbackContext)?.confirm || (async () => true);
}

export function useNotify() {
  return useContext(FeedbackContext)?.notify || (() => {});
}
