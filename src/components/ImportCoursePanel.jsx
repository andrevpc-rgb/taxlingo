// src/components/ImportCoursePanel.jsx
//
// Painel "Importar Curso" (Painel de Contingência, só master, ver
// MasterContingencyPanel.jsx) — cola ou sobe um .json com o conteúdo
// completo de um curso (mesmo formato de src/data/questions/*.json, com um
// wrapper de curso em volta) e substitui TODO o conteúdo (lições+questões)
// daquele curso de uma vez, via a Edge Function admin-course-import — é o
// que permite publicar/atualizar um curso sem precisar de deploy de
// frontend nem rodar scripts/seed.mjs manualmente.
//
// O curso em si (metadados: id/título/ícone/cor) precisa já existir —
// cadastre primeiro no painel "Metadados do Curso" ao lado.

import React, { useRef, useState } from 'react';
import { UploadCloud, AlertCircle, Check } from 'lucide-react';
import * as api from '../lib/api';

const EXAMPLE_PAYLOAD = `{
  "course": { "id": "etica-profissional" },
  "lessons": [
    {
      "id": "etica-1",
      "title": "Ética · Lição 1",
      "type": "regular",
      "xpReward": 20,
      "questions": [
        {
          "id": "ETICA-001",
          "type": "multiple_choice",
          "scenario": "...",
          "question": "...",
          "options": ["...", "...", "...", "..."],
          "correctAnswer": "...",
          "explanation": "...",
          "pacciTip": "...",
          "topic": "..."
        }
      ]
    },
    {
      "id": "etica-exam",
      "title": "Ética · Avaliação Final",
      "type": "exam",
      "xpReward": 60,
      "passThreshold": 0.8,
      "questions": [ /* ... */ ]
    }
  ]
}`;

export default function ImportCoursePanel() {
  const [jsonText, setJsonText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    setJsonText(text);
    setError(null);
    setResult(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    let payload;
    try {
      payload = JSON.parse(jsonText);
    } catch (err) {
      setError(`JSON inválido: ${err.message}`);
      return;
    }

    setLoading(true);
    try {
      const data = await api.adminImportCourseContent(payload);
      setResult(data);
    } catch (err) {
      setError(err.message || 'Não foi possível importar o conteúdo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-600">
        <UploadCloud className="h-4 w-4" />
        Importar Curso
      </p>
      <p className="mb-3 text-[11px] text-slate-400">
        Cola ou sobe um .json com as lições/questões do curso — substitui TODO o conteúdo atual daquele curso de uma
        vez só. O curso precisa já estar cadastrado em "Metadados do Curso". Dois formatos aceitos: {'{'} course,
        levels {'}'} (trilha de carreira, com exame a cada nível, igual Reforma Tributária/Contabilidade) ou {'{'}{' '}
        course, lessons {'}'} (lista direta de lições, pra curso sem trilha de carreira).
      </p>

      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-slate-600 hover:border-slate-300"
          >
            Carregar arquivo .json
          </button>
          <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileChange} className="hidden" />
          <button
            type="button"
            onClick={() => {
              setJsonText(EXAMPLE_PAYLOAD);
              setError(null);
              setResult(null);
            }}
            className="text-[11px] font-bold text-slate-400 hover:text-slate-600"
          >
            Ver exemplo de formato
          </button>
        </div>

        <textarea
          required
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          placeholder="Cole aqui o JSON do curso..."
          rows={8}
          spellCheck={false}
          className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 font-mono text-[11px] text-slate-700 outline-none focus:border-emerald-400"
        />

        {error && (
          <p className="flex items-start gap-1.5 whitespace-pre-line text-[11px] font-bold text-rose-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 translate-y-0.5" />
            {error}
          </p>
        )}
        {result && (
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
            <Check className="h-3.5 w-3.5 shrink-0" />
            Curso "{result.courseId}" atualizado: {result.lessonsCount} lições, {result.questionsCount} questões.
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-slate-700 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
        >
          {loading ? 'Importando...' : 'Importar conteúdo'}
        </button>
      </form>
    </div>
  );
}
