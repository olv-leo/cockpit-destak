'use client';

import { useState } from 'react';
import { Eye, EyeOff, Leaf, Lock, AlertCircle } from 'lucide-react';
import { saveAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

interface AuthScreenProps {
  onAuth: () => void;
}

export default function AuthScreen({ onAuth }: AuthScreenProps) {
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });

      if (res.ok) {
        saveAuth(code.trim());
        onAuth();
      } else {
        setError('Código de acesso inválido. Tente novamente.');
      }
    } catch {
      setError('Erro de conexão. Verifique sua internet.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #1B4332 0%, #2D6A4F 40%, #1B4332 100%)' }}>

      {/* Padrão de fundo decorativo */}
      <div className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
        }} />

      {/* Círculos decorativos */}
      <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, #40916C 0%, transparent 70%)', transform: 'translate(30%, -30%)' }} />
      <div className="absolute bottom-0 left-0 w-96 h-96 rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, #40916C 0%, transparent 70%)', transform: 'translate(-30%, 30%)' }} />

      {/* Card principal */}
      <div className="relative w-full max-w-md mx-4 fade-in-up">
        <div className="rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)' }}>

          {/* Header do card */}
          <div className="px-8 pt-8 pb-6 text-center"
            style={{ background: 'linear-gradient(135deg, #1B4332 0%, #2D6A4F 100%)' }}>
            <div className="flex items-center justify-center w-16 h-16 rounded-full mx-auto mb-4"
              style={{ background: 'rgba(255,255,255,0.15)' }}>
              <Leaf className="w-8 h-8 text-white" strokeWidth={1.5} />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-wide">DESTAK</h1>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Agropecuária · Cockpit de Gestão
            </p>
          </div>

          {/* Formulário */}
          <div className="px-8 py-8">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-full"
                style={{ background: '#D8F3DC', color: '#1B4332' }}>
                <Lock className="w-3.5 h-3.5" />
                <span className="font-medium">Acesso Restrito</span>
              </div>
              <p className="text-sm mt-3" style={{ color: '#6B7280' }}>
                Insira o código de acesso para entrar no sistema
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative">
                <input
                  type={showCode ? 'text' : 'password'}
                  value={code}
                  onChange={(e) => { setCode(e.target.value); setError(''); }}
                  placeholder="Código de acesso"
                  className={cn(
                    "w-full px-4 py-3.5 pr-12 rounded-xl border-2 text-base outline-none transition-all duration-200",
                    "placeholder:text-gray-400 bg-white",
                    error
                      ? "border-red-400 focus:border-red-500"
                      : "border-gray-200 focus:border-[#40916C]"
                  )}
                  style={{ color: '#1A2E23', fontFamily: 'monospace', letterSpacing: '0.1em' }}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowCode(!showCode)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors"
                  style={{ color: '#9CA3AF' }}
                  tabIndex={-1}
                >
                  {showCode ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm"
                  style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !code.trim()}
                className="w-full py-3.5 rounded-xl font-semibold text-white text-base transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background: loading ? '#40916C' : 'linear-gradient(135deg, #1B4332 0%, #40916C 100%)',
                  boxShadow: loading ? 'none' : '0 4px 14px rgba(27, 67, 50, 0.4)'
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="spinner w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Verificando...
                  </span>
                ) : (
                  'Entrar no Sistema'
                )}
              </button>
            </form>

            <p className="text-center text-xs mt-6" style={{ color: '#9CA3AF' }}>
              Acesso válido por 90 dias após o login
            </p>
          </div>
        </div>

        {/* Rodapé */}
        <p className="text-center text-xs mt-4" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Destak Agropecuária · Sistema de Gestão de Dados
        </p>
      </div>
    </div>
  );
}
