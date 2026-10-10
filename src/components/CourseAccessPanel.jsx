// src/components/CourseAccessPanel.jsx
//
// Painel "Acesso por Empresa" (Painel de Contingência, só master, ver
// MasterContingencyPanel.jsx) — concede ou revoga o acesso de uma empresa a
// um curso (tabela company_course_access, allow-list pura — ver
// schema.sql: curso SEM linha aqui pra uma empresa = invisível pra ela,
// exceto se o curso estiver inativo, aí todo mundo vê como "Disponível em
// breve"). Escrita direta via supabase-js, protegida pela policy
// company_course_access_write_master (RLS), já existente desde a Fase 1 da
// migração multi-curso.

import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, AlertCircle, RefreshCcw } from 'lucide-react';
import * as api from '../lib/api';
import { useGame } from '../context/GameContext.jsx';

export default function CourseAccessPanel() {
  const { companies } = useGame();
  const [courses, setCourses] = useState(null);
  const [grants, setGrants] = useState(null);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [togglingCompanyId, setTogglingCompanyId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [coursesData, grantsData] = await Promise.all([api.fetchCourses(), api.fetchCourseAccessGrants()]);
      setCourses(coursesData);
      setGrants(grantsData);
      setSelectedCourseId((prev) => prev || coursesData[0]?.id || '');
    } catch (err) {
      setError(err.message || 'Não foi possível carregar o acesso por empresa.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grantedCompanyIds = useMemo(() => {
    if (!grants) return new Set();
    return new Set(grants.filter((g) => g.course_id === selectedCourseId).map((g) => g.company_id));
  }, [grants, selectedCourseId]);

  const handleToggle = async (companyId, hasAccess) => {
    setTogglingCompanyId(companyId);
    setError(null);
    try {
      if (hasAccess) {
        await api.revokeCourseAccess({ companyId, courseId: selectedCourseId });
        setGrants((prev) => prev.filter((g) => !(g.company_id === companyId && g.course_id === selectedCourseId)));
      } else {
        await api.grantCourseAccess({ companyId, courseId: selectedCourseId });
        setGrants((prev) => [...prev, { company_id: companyId, course_id: selectedCourseId }]);
      }
    } catch (err) {
      setError(err.message || 'Não foi possível alterar o acesso.');
    } finally {
      setTogglingCompanyId(null);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-600">
          <KeyRound className="h-4 w-4" />
          Acesso por Empresa
        </p>
        <button type="button" onClick={load} className="text-slate-400 hover:text-slate-600" aria-label="Recarregar">
          <RefreshCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mb-3 text-[11px] text-slate-400">
        Allow-list: uma empresa só vê o curso se estiver marcada aqui (curso inativo é visível a todos como
        "Disponível em breve", independente da marcação).
      </p>

      {error && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {loading && !courses && <p className="text-xs text-slate-400">Carregando...</p>}

      {courses && courses.length > 0 && (
        <select
          value={selectedCourseId}
          onChange={(e) => setSelectedCourseId(e.target.value)}
          className="mb-3 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        >
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title}
            </option>
          ))}
        </select>
      )}

      {courses && grants && (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {companies.map((company) => {
            const hasAccess = grantedCompanyIds.has(company.id);
            return (
              <label
                key={company.id}
                className="flex items-center justify-between gap-2 rounded-xl border-2 border-slate-100 px-3 py-2 text-xs font-bold text-slate-700"
              >
                <span className="truncate">
                  {company.name} ({company.code})
                </span>
                <input
                  type="checkbox"
                  checked={hasAccess}
                  disabled={togglingCompanyId === company.id}
                  onChange={() => handleToggle(company.id, hasAccess)}
                  className="h-4 w-4 shrink-0 rounded border-2 border-slate-300 text-emerald-500 focus:ring-emerald-400"
                />
              </label>
            );
          })}
          {companies.length === 0 && <p className="text-xs text-slate-400">Nenhuma empresa cadastrada.</p>}
        </div>
      )}
    </div>
  );
}
