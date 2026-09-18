// src/components/ChangelogModal.jsx
//
// Popup "O que há de novo" — ver App.jsx (mostrado quando
// user.lastSeenChangelogVersion difere de CURRENT_CHANGELOG_VERSION) e
// src/data/changelog.js (conteúdo). Some sozinho depois que o usuário clica
// em "Entendi", que grava a versão atual no perfil (Supabase ou localStorage,
// conforme o modo — ver updateProfile em GameContext.jsx).

import React from 'react';
import { Sparkles } from 'lucide-react';
import { CHANGELOG_ENTRIES } from '../data/changelog';

export default function ChangelogModal({ onDismiss }) {
  const entry = CHANGELOG_ENTRIES[0];
  if (!entry) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border-2 border-slate-200 bg-white shadow-xl">
        <div className="shrink-0 border-b-2 border-slate-100 px-6 pb-4 pt-6 text-center">
          <Sparkles className="mx-auto mb-2 h-9 w-9 text-emerald-500" />
          <h2 className="text-lg font-extrabold text-slate-800">{entry.title}</h2>
          <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">O que há de novo no TaxLingo</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-4">
            {entry.sections.map((section) => (
              <div key={section.title}>
                <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-700">
                  <span aria-hidden="true">{section.emoji}</span>
                  {section.title}
                </p>
                <ul className="mt-1.5 space-y-1 pl-1">
                  {section.items.map((item) => (
                    <li key={item} className="flex gap-2 text-xs leading-relaxed text-slate-500">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-t-2 border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onDismiss}
            className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_#047857] transition-transform active:translate-y-0.5 active:shadow-none"
          >
            Entendi / Começar a Treinar
          </button>
        </div>
      </div>
    </div>
  );
}
