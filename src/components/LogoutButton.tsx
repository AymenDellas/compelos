'use client';

import { useState } from 'react';

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Could not sign out. Please try again.');
      window.location.assign('/login');
    } catch {
      setError('Could not sign out. Please try again.');
      setPending(false);
    }
  }

  return <div>
    <button className="btn btn-ghost" type="button" disabled={pending} onClick={signOut}>
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
    {error && <span role="alert" style={{ color: '#b42318', fontSize: 12 }}>{error}</span>}
  </div>;
}
