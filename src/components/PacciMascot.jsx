// src/components/PacciMascot.jsx
// "Pacci" — mascote infantilizado inspirado em Luca Pacioli, o pai da contabilidade.
// Usa uma viseira verde de contador e um bigode italiano exagerado.
import React from 'react';

const SIZE_CLASSES = {
  sm: 'h-14 w-14',
  md: 'h-20 w-20',
  lg: 'h-32 w-32',
};

function PacciFace({ mood }) {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full" role="img" aria-label={`Pacci - humor ${mood}`}>
      {/* orelhas */}
      <circle cx="34" cy="105" r="16" fill="#F2C9A0" />
      <circle cx="166" cy="105" r="16" fill="#F2C9A0" />

      {/* cabeça */}
      <circle cx="100" cy="105" r="70" fill="#F6D2A6" />

      {/* viseira de contador */}
      <path d="M35 78 Q100 35 165 78 L165 88 Q100 55 35 88 Z" fill="#16A34A" />
      <circle cx="100" cy="60" r="8" fill="#16A34A" />

      {/* bigode */}
      <path
        d="M60 128 Q75 118 100 126 Q125 118 140 128 Q128 150 100 138 Q72 150 60 128 Z"
        fill="#5B4636"
      />

      {/* sobrancelhas */}
      {mood === 'sad' ? (
        <>
          <path d="M65 90 Q78 100 92 92" stroke="#5B4636" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M108 92 Q122 100 135 90" stroke="#5B4636" strokeWidth="5" fill="none" strokeLinecap="round" />
        </>
      ) : mood === 'hint' ? (
        <>
          <path d="M63 95 Q78 82 93 92" stroke="#5B4636" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M107 90 Q122 88 137 96" stroke="#5B4636" strokeWidth="5" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M63 92 Q78 84 93 90" stroke="#5B4636" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M107 90 Q122 84 137 92" stroke="#5B4636" strokeWidth="5" fill="none" strokeLinecap="round" />
        </>
      )}

      {/* olhos */}
      {mood === 'happy' ? (
        <>
          <path d="M65 104 Q75 92 85 104" stroke="#3B2A20" strokeWidth="6" fill="none" strokeLinecap="round" />
          <path d="M115 104 Q125 92 135 104" stroke="#3B2A20" strokeWidth="6" fill="none" strokeLinecap="round" />
        </>
      ) : mood === 'sad' ? (
        <>
          <circle cx="75" cy="106" r="7" fill="#3B2A20" />
          <circle cx="125" cy="106" r="7" fill="#3B2A20" />
          {/* lágrimas cômicas */}
          <path d="M73 116 Q68 130 73 142 Q78 130 73 116 Z" fill="#60A5FA" />
          <path d="M127 116 Q122 132 127 148 Q132 132 127 116 Z" fill="#60A5FA" />
        </>
      ) : mood === 'hint' ? (
        <>
          <circle cx="78" cy="102" r="7" fill="#3B2A20" />
          <circle cx="128" cy="100" r="7" fill="#3B2A20" />
        </>
      ) : (
        <>
          <circle cx="75" cy="104" r="7" fill="#3B2A20" />
          <circle cx="125" cy="104" r="7" fill="#3B2A20" />
        </>
      )}

      {/* boca */}
      {mood === 'happy' ? (
        <path d="M78 148 Q100 168 122 148" stroke="#8B3A1F" strokeWidth="5" fill="#FFF" strokeLinecap="round" />
      ) : mood === 'sad' ? (
        <path d="M80 156 Q100 142 120 156" stroke="#8B3A1F" strokeWidth="5" fill="none" strokeLinecap="round" />
      ) : mood === 'hint' ? (
        <circle cx="100" cy="150" r="6" fill="#8B3A1F" />
      ) : (
        <path d="M85 150 Q100 156 115 150" stroke="#8B3A1F" strokeWidth="5" fill="none" strokeLinecap="round" />
      )}

      {/* lâmpada da dica */}
      {mood === 'hint' && (
        <g transform="translate(148,40)">
          <circle cx="0" cy="0" r="14" fill="#FDE047" stroke="#F59E0B" strokeWidth="3" />
          <rect x="-5" y="12" width="10" height="6" rx="2" fill="#9CA3AF" />
        </g>
      )}
    </svg>
  );
}

/**
 * @param {'happy'|'neutral'|'hint'|'sad'} mood
 * @param {string} [message] - texto exibido no balão de fala
 * @param {'sm'|'md'|'lg'} [size]
 */
export default function PacciMascot({ mood = 'neutral', message, size = 'md', className = '' }) {
  return (
    <div className={`flex items-end gap-3 ${className}`}>
      <div className={`shrink-0 ${SIZE_CLASSES[size]}`}>
        <PacciFace mood={mood} />
      </div>

      {message && (
        <div className="relative max-w-xs rounded-2xl rounded-bl-sm border-2 border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-sm font-semibold leading-snug text-slate-700">{message}</p>
        </div>
      )}
    </div>
  );
}
