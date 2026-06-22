'use client';

import { useEffect, useState } from 'react';
import { isAuthenticated } from '@/lib/auth';
import AuthScreen from '@/components/AuthScreen';
import Dashboard from '@/components/Dashboard';

export default function Home() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    setAuthed(isAuthenticated());
  }, []);

  // Evita flash de conteúdo durante hidratação
  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #1B4332 0%, #2D6A4F 100%)' }}>
        <div className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white spinner" />
      </div>
    );
  }

  if (!authed) {
    return <AuthScreen onAuth={() => setAuthed(true)} />;
  }

  return <Dashboard onLogout={() => setAuthed(false)} />;
}
