// src/components/UserProfile.jsx
import React, { useState } from 'react';
import { X, Building2, Mail, LogOut, Check, GraduationCap, Lock } from 'lucide-react';
import { useGame } from '../context/GameContext.jsx';
import { AVATAR_CATEGORIES } from '../data/mockData';
import { hasCompletedTrail, downloadCertificate } from '../utils/certificate';

const ROLE_LABELS = {
  admin: 'Administrador(a)',
  master: 'Master',
  employee: 'Colaborador(a)',
};

const AVATAR_TABS = Object.entries(AVATAR_CATEGORIES).map(([key, category]) => ({
  key,
  label: category.label,
  emojis: category.emojis,
}));

export default function UserProfile({ onClose }) {
  const { user, currentCompany, modules, updateProfile, logout } = useGame();
  const certificateUnlocked = hasCompletedTrail(modules);

  const [name, setName] = useState(user?.name ?? '');
  const [jobTitle, setJobTitle] = useState(user?.jobTitle ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? AVATAR_TABS[0].emojis[0]);
  const [avatarTab, setAvatarTab] = useState(AVATAR_TABS[0].key);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingCertificate, setGeneratingCertificate] = useState(false);

  if (!user) return null;

  const activeTab = AVATAR_TABS.find((tab) => tab.key === avatarTab) ?? AVATAR_TABS[0];

  const handleSave = async (event) => {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('O nome não pode ficar em branco.');
      return;
    }
    if (newPassword && newPassword.length < 4) {
      setError('A nova senha precisa ter pelo menos 4 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    // updateProfile é assíncrono no modo Supabase (chamada de rede) e
    // síncrono no modo mock — em ambos os casos dá pra aguardar aqui antes
    // de mostrar "salvo", em vez de assumir sucesso otimisticamente.
    setSaving(true);
    await updateProfile({ name, jobTitle, avatarUrl, newPassword: newPassword || undefined });
    setSaving(false);
    setNewPassword('');
    setConfirmPassword('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleLogout = () => {
    logout();
    onClose?.();
  };

  const handleDownloadCertificate = async () => {
    if (!certificateUnlocked || generatingCertificate) return;
    setGeneratingCertificate(true);
    try {
      await downloadCertificate({ user, company: currentCompany });
    } finally {
      setGeneratingCertificate(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-8">
      <div className="relative w-full max-w-sm overflow-y-auto rounded-3xl border-2 border-slate-200 bg-white p-6 shadow-xl" style={{ maxHeight: '90vh' }}>
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-slate-400 hover:bg-slate-100"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="mb-4 text-lg font-extrabold text-slate-800">Meu Perfil</h2>

        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Avatar</p>

            <div className="mb-3 flex gap-1 rounded-2xl bg-slate-100 p-1">
              {AVATAR_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setAvatarTab(tab.key)}
                  className={`flex-1 rounded-xl py-1.5 text-[11px] font-extrabold uppercase tracking-wide transition-colors ${
                    activeTab.key === tab.key ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {activeTab.emojis.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setAvatarUrl(choice)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-lg transition-colors ${
                    avatarUrl === choice ? 'bg-emerald-100 ring-2 ring-emerald-400' : 'bg-slate-100 hover:bg-slate-200'
                  }`}
                  aria-label={`Escolher avatar ${choice}`}
                >
                  <span aria-hidden="true">{choice}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="profile-name" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
              Nome
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
            />
          </div>

          <div>
            <label htmlFor="profile-job-title" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">
              Cargo na empresa
            </label>
            <input
              id="profile-job-title"
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Ex: Analista Fiscal"
              className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
            />
          </div>

          <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2.5 text-sm text-slate-500">
            <Mail className="h-4 w-4 shrink-0" />
            {user.email}
          </div>

          <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2.5 text-sm text-slate-500">
            <Building2 className="h-4 w-4 shrink-0" />
            <div>
              <p className="font-bold text-slate-600">{currentCompany?.name ?? '—'}</p>
              <p className="text-xs">{ROLE_LABELS[user.role] ?? user.role}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDownloadCertificate}
            disabled={!certificateUnlocked || generatingCertificate}
            title={
              certificateUnlocked
                ? 'Baixar seu certificado em PDF'
                : 'Conclua o Exame de Transição de Especialista (o último nível da trilha) para liberar'
            }
            className={`flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-extrabold uppercase tracking-wide transition-transform active:translate-y-0.5 ${
              certificateUnlocked
                ? 'bg-amber-500 text-white shadow-[0_4px_0_0_#b45309] active:shadow-none disabled:cursor-wait disabled:opacity-70'
                : 'cursor-not-allowed bg-slate-100 text-slate-400'
            }`}
          >
            {!certificateUnlocked && <Lock className="h-4 w-4 shrink-0" />}
            {generatingCertificate ? 'Gerando PDF...' : '🎓 Baixar Meu Certificado'}
          </button>
          {!certificateUnlocked && (
            <p className="-mt-3 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
              <GraduationCap className="h-3.5 w-3.5 shrink-0" />
              Libera ao concluir o Exame de Transição de Especialista, o último nível da trilha.
            </p>
          )}

          <div className="grid gap-2">
            <label htmlFor="profile-new-password" className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Nova senha (opcional)
            </label>
            <input
              id="profile-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Deixe em branco para manter a atual"
              autoComplete="new-password"
              className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
            />
            {newPassword && (
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirme a nova senha"
                autoComplete="new-password"
                className="w-full rounded-2xl border-2 border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
              />
            )}
          </div>

          {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
          {saved && (
            <p className="flex items-center gap-1 text-xs font-bold text-emerald-600">
              <Check className="h-4 w-4" /> Perfil atualizado!
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_#047857] active:translate-y-0.5 active:shadow-none disabled:cursor-wait disabled:opacity-70"
          >
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleLogout}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-rose-200 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-rose-500 hover:bg-rose-50"
        >
          <LogOut className="h-4 w-4" />
          Sair da conta
        </button>
      </div>
    </div>
  );
}
