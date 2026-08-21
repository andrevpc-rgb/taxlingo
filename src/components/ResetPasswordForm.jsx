// src/components/ResetPasswordForm.jsx
//
// Tela exibida quando o usuário clica no link do e-mail de "esqueci minha
// senha" (evento PASSWORD_RECOVERY do Supabase Auth, ver GameContext.jsx).
// Pede a senha nova duas vezes e chama completePasswordReset(), que já
// deixa o usuário logado ao final — não precisa entrar de novo.

import React, { useState } from 'react';
import { KeyRound, AlertCircle, Check } from 'lucide-react';
import { useGame } from '../context/GameContext.jsx';

export default function ResetPasswordForm() {
  const { completePasswordReset } = useGame();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (password.length < 4) {
      setError('A senha precisa ter pelo menos 4 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    const result = await completePasswordReset(password);
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
    }
    // sucesso: completePasswordReset já despacha AUTH_SUCCESS, o App.jsx
    // troca de tela sozinho — não precisa fazer nada mais aqui.
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border-2 border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500 text-white">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-extrabold text-slate-800">Defina sua senha nova</h1>
          <p className="text-xs font-medium text-slate-400">Escolha uma senha nova para continuar.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reset-password" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
              Senha nova
            </label>
            <input
              id="reset-password"
              type="password"
              required
              minLength={4}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 4 caracteres"
              autoComplete="new-password"
              className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
            />
          </div>
          <div>
            <label htmlFor="reset-password-confirm" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
              Confirme a senha nova
            </label>
            <input
              id="reset-password-confirm"
              type="password"
              required
              minLength={4}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Digite de novo"
              autoComplete="new-password"
              className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
            />
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-xs font-bold text-rose-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_#047857] active:translate-y-0.5 active:shadow-none disabled:opacity-60"
          >
            <Check className="h-4 w-4" />
            {loading ? 'Salvando...' : 'Salvar senha nova'}
          </button>
        </form>
      </div>
    </div>
  );
}
