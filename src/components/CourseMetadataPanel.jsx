// src/components/CourseMetadataPanel.jsx
//
// Painel "Metadados do Curso" (Painel de Contingência, só master, ver
// MasterContingencyPanel.jsx) — cadastra e edita cursos (título, descrição,
// ícone, cor, banner, ativo). Escrita direta via supabase-js
// (supabase.from('courses').upsert), protegida pela policy
// courses_write_master (RLS) — sem Edge Function, mesmo padrão de
// updateProfile. O id do curso é a chave usada em todo o resto do sistema
// (lições/questões/company_course_access apontam pra ele), por isso fica
// travado depois de criado — trocar o id exigiria migrar todo o conteúdo
// vinculado, e isso não é feito por aqui.

import React, { useEffect, useState } from 'react';
import { BookMarked, AlertCircle, Check, Lock } from 'lucide-react';
import * as api from '../lib/api';

const ICON_OPTIONS = ['Landmark', 'Calculator', 'FileSpreadsheet', 'Briefcase', 'Headset', 'Scale', 'Stamp', 'BookOpen'];
const COLOR_OPTIONS = ['emerald', 'blue', 'amber', 'purple', 'sky', 'rose', 'indigo'];

const EMPTY_FORM = {
  id: '',
  title: '',
  description: '',
  icon: ICON_OPTIONS[0],
  color: COLOR_OPTIONS[0],
  bannerUrl: '',
  isActive: false,
  orderIndex: 0,
};

export default function CourseMetadataPanel() {
  const [courses, setCourses] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    setListError(null);
    try {
      setCourses(await api.fetchCourses());
    } catch (err) {
      setListError(err.message || 'Não foi possível carregar os cursos.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleEdit = (course) => {
    setForm({
      id: course.id,
      title: course.title ?? '',
      description: course.description ?? '',
      icon: course.icon ?? ICON_OPTIONS[0],
      color: course.color ?? COLOR_OPTIONS[0],
      bannerUrl: course.bannerUrl ?? '',
      isActive: !course.locked,
      orderIndex: course.orderIndex ?? 0,
    });
    setIsEditing(true);
    setSaved(false);
    setError(null);
  };

  const handleNew = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setSaved(false);
    setError(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const id = form.id.trim();
    if (!isEditing && !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      setError('O id do curso precisa ser minúsculo, só letras/números/hífen (ex: "contabilidade-avancada").');
      return;
    }
    if (!form.title.trim()) {
      setError('Informe o título do curso.');
      return;
    }

    setLoading(true);
    try {
      await api.adminUpsertCourse({ ...form, id });
      setSaved(true);
      const wasEditing = isEditing;
      await load();
      if (!wasEditing) handleNew();
    } catch (err) {
      setError(err.message || 'Não foi possível salvar o curso.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-600">
        <BookMarked className="h-4 w-4" />
        Metadados do Curso
      </p>
      <p className="mb-3 text-[11px] text-slate-400">
        Cadastre um curso aqui antes de liberar acesso por empresa ou importar conteúdo pra ele.
      </p>

      {listError && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {listError}
        </p>
      )}

      {courses && courses.length > 0 && (
        <div className="mb-3 max-h-40 space-y-1 overflow-y-auto">
          {courses.map((course) => (
            <button
              key={course.id}
              type="button"
              onClick={() => handleEdit(course)}
              className={`flex w-full items-center justify-between rounded-xl border-2 px-3 py-1.5 text-left text-xs font-bold transition-colors ${
                isEditing && form.id === course.id
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-slate-100 text-slate-600 hover:border-slate-200'
              }`}
            >
              <span className="truncate">{course.title}</span>
              <span className="shrink-0 text-[10px] font-extrabold uppercase text-slate-400">
                {course.locked ? 'Inativo' : 'Ativo'}
              </span>
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
            {isEditing ? `Editando: ${form.id}` : 'Novo curso'}
          </p>
          {isEditing && (
            <button type="button" onClick={handleNew} className="text-[11px] font-bold text-slate-400 hover:text-slate-600">
              Cancelar edição
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isEditing && <Lock className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />}
          <input
            type="text"
            required
            disabled={isEditing}
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            placeholder="id (ex: contabilidade-avancada)"
            className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>

        <input
          type="text"
          required
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Título"
          className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Descrição (mostrada no card do curso)"
          rows={2}
          className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />

        <div className="grid grid-cols-2 gap-2">
          <select
            value={form.icon}
            onChange={(e) => setForm({ ...form, icon: e.target.value })}
            className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
          >
            {ICON_OPTIONS.map((icon) => (
              <option key={icon} value={icon}>
                {icon}
              </option>
            ))}
          </select>
          <select
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
            className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
          >
            {COLOR_OPTIONS.map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
        </div>

        <input
          type="text"
          value={form.bannerUrl}
          onChange={(e) => setForm({ ...form, bannerUrl: e.target.value })}
          placeholder="URL do banner (opcional)"
          className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
        />

        <div className="flex items-center gap-3">
          <input
            type="number"
            value={form.orderIndex}
            onChange={(e) => setForm({ ...form, orderIndex: Number(e.target.value) })}
            placeholder="Ordem"
            className="w-24 rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-emerald-400"
          />
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4 rounded border-2 border-slate-300 text-emerald-500 focus:ring-emerald-400"
            />
            Ativo
          </label>
        </div>
        <p className="text-[10px] text-slate-400">
          Curso inativo aparece pra todo mundo como "Disponível em breve" (nenhuma lição fica acessível). Mesmo
          ativo, uma empresa só enxerga o curso se tiver acesso liberado no painel ao lado.
        </p>

        {error && (
          <p className="flex items-start gap-1.5 whitespace-pre-line text-[11px] font-bold text-rose-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 translate-y-0.5" />
            {error}
          </p>
        )}
        {saved && (
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
            <Check className="h-3.5 w-3.5 shrink-0" />
            Curso salvo!
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-slate-700 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
        >
          {loading ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Criar curso'}
        </button>
      </form>
    </div>
  );
}
