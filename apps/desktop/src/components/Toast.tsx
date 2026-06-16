import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { useStore } from '../store';

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

function ToastItem({ id, text, type }: { id: string; text: string; type: 'success' | 'error' | 'info' }) {
  const popToast = useStore((s) => s.popToast);
  const Icon = ICONS[type];

  useEffect(() => {
    const timer = setTimeout(() => popToast(id), 3000);
    return () => clearTimeout(timer);
  }, [id, popToast]);

  return (
    <div className={`toast-item toast-${type}`} onClick={() => popToast(id)}>
      <Icon size={14} />
      <span>{text}</span>
      <button className="toast-close" aria-label="关闭"><X size={12} /></button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} text={t.text} type={t.type} />
      ))}
    </div>
  );
}