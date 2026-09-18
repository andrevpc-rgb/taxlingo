// src/components/NotificationModal.jsx
//
// Aviso de "sua sugestão foi aplicada" — mostrado ao logar/abrir a Home
// quando existem notificações não lidas (ver GameContext.jsx: efeito que
// busca api.fetchUnreadNotifications). Mostra uma por vez; ao fechar,
// dismissNotification tira do topo da fila e credita a recompensa no saldo
// local (a gravação em si já aconteceu no banco quando o master resolveu o
// report, ver api.resolveQuestionReports).

import React from 'react';
import { PartyPopper, Diamond } from 'lucide-react';
import { useGame } from '../context/GameContext.jsx';

export default function NotificationModal() {
  const { pendingNotifications, dismissNotification } = useGame();
  const notification = pendingNotifications?.[0];
  if (!notification) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-sm rounded-3xl border-2 border-emerald-200 bg-white p-6 text-center shadow-xl">
        <PartyPopper className="mx-auto mb-2 h-10 w-10 text-emerald-500" />
        <h2 className="text-lg font-extrabold text-slate-800">{notification.title}</h2>
        <p className="mt-2 text-sm font-medium text-slate-500">{notification.message}</p>

        {notification.rewardGems > 0 && (
          <p className="mt-3 flex items-center justify-center gap-1.5 rounded-2xl bg-cyan-50 px-3 py-2 text-sm font-extrabold text-cyan-600">
            <Diamond className="h-4 w-4 fill-cyan-500 text-cyan-500" />
            +{notification.rewardGems} gemas creditadas na sua conta!
          </p>
        )}

        <button
          type="button"
          onClick={() => dismissNotification(notification.id)}
          className="mt-5 w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_#047857] transition-transform active:translate-y-0.5 active:shadow-none"
        >
          Que bom!
        </button>
      </div>
    </div>
  );
}
