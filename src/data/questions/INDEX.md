# Banco de Questões — TaxLingo (Reforma Tributária)

Progresso: **1000 / 1000** questões geradas. ✅

| # | Nível | Arquivo | Questões |
|---|-------|---------|----------|
| 1 | Estagiário | `reforma_tributaria_estagiario.json` | 140 |
| 2 | Auxiliar | `reforma_tributaria_auxiliar.json` | 140 |
| 3 | Assistente | `reforma_tributaria_assistente.json` | 140 |
| 4 | Analista Júnior | `reforma_tributaria_analista_junior.json` | 140 |
| 5 | Analista Pleno | `reforma_tributaria_analista_pleno.json` | 140 |
| 6 | Analista Sênior | `reforma_tributaria_analista_senior.json` | 140 |
| 7 | Especialista | `reforma_tributaria_especialista.json` | 160 |

Cada arquivo é um array JSON de objetos no schema:
`{ id, level, type, scenario, question, options?, correctAnswer, explanation, pacciTip }`

IDs seguem o padrão `REF-<PREFIXO>-NNN` (EST, AUX, ASS, JR, PL, SR, ESP).

`src/data/mockData.js` fatia automaticamente cada nível em lições de 3-5 questões
+ 1 Exame de Transição (15-20 questões) por nível, via `buildLevelLessons()`.
