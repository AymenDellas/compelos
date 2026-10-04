'use client';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get('password');
    setPending(true); setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error || 'Could not sign in. Please try again.'); setPending(false); return; }
      window.location.assign(next);
    } catch { setError('Could not connect. Please try again.'); setPending(false); }
  }
  return <form onSubmit={submit} className="mt-8 space-y-5">
    <div className="space-y-2">
      <label htmlFor="workspace-password" className="block text-sm font-medium">Workspace password</label>
      <div className="relative">
        <input id="workspace-password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" required maxLength={128} autoFocus className="field w-full !min-h-12 !pr-12" aria-describedby={error ? 'login-error' : undefined} />
        <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'} className="absolute right-1 top-1 h-10 w-10 flex items-center justify-center text-[var(--text-dim)] rounded-md focus-visible:outline-2 focus-visible:outline-[var(--signal)]">{visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
      </div>
    </div>
    {error && <p id="login-error" role="alert" className="text-sm text-[var(--bad)]">{error}</p>}
    <button type="submit" disabled={pending} className="btn btn-primary !min-h-12 w-full justify-center">{pending ? 'Opening workspace…' : 'Enter workspace'}{!pending && <ArrowRight className="w-4 h-4" />}</button>
  </form>;
}
