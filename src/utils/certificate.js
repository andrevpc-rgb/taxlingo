// src/utils/certificate.js
//
// Certificado de Conclusão — liberado só quando o colaborador termina a
// trilha inteira (passa no Exame de Transição de Especialista, o último
// nível de carreira). Gerado 100% no cliente com jsPDF: sem backend, sem
// arquivo pra hospedar, o PDF nasce e já baixa na hora do clique.

// jsPDF é importado dinamicamente (ver downloadCertificate) em vez de no
// topo do arquivo — é uma lib relativamente pesada que só interessa a quem
// já terminou a trilha inteira (bem mais raro que o resto do app), não faz
// sentido inflar o bundle inicial de todo mundo com ela.

const WORKLOAD_HOURS = 20;

const EMERALD = [16, 185, 129];
const EMERALD_DARK = [4, 120, 87];
const AMBER = [180, 83, 9];
const SLATE = [51, 65, 85];
const SLATE_LIGHT = [100, 116, 139];

// A trilha de um curso só conta como concluída quando o Exame de Transição
// do ÚLTIMO nível está com completed=true — chegar a esse nível não basta,
// é preciso ter passado no exame dele também. Em vez de comparar por
// orderIndex (que o modo mock nunca preenche — ver buildLevelLessons em
// mockData.js), basta varrer de trás pra frente: todo nível termina com um
// "<id>-exam" como última lição (ver buildLevelLessons em mockData.js e
// scripts/seed.mjs), então o último item de type 'exam' no array já é,
// por construção, o exame do último nível — funciona igual em ambos os
// modos, já que os dois entregam `lessons` na ordem certa da trilha.
export function hasCompletedTrail(modules, courseId) {
  const course = (modules ?? []).find((m) => m.id === courseId);
  const lessons = course?.lessons ?? [];
  for (let i = lessons.length - 1; i >= 0; i--) {
    if (lessons[i].type === 'exam') return Boolean(lessons[i].completed);
  }
  return false;
}

// Código determinístico (não é um hash criptográfico — só precisa ser
// estável e parecer único): o mesmo colaborador sempre gera o mesmo código,
// mesmo baixando o certificado de novo mais tarde.
function hashToBase36(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).toUpperCase();
}

function companySlug(company) {
  const raw = company?.code || company?.name || 'TAXLINGO';
  const slug = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  return (slug || 'TAXLINGO').slice(0, 8);
}

// Inclui o courseId no hash para que o mesmo colaborador, concluindo
// trilhas diferentes, não gere o mesmo código de validação para cursos
// distintos — cada certificado precisa de uma "impressão digital" própria.
function buildValidationCode(userId, courseId, company) {
  const suffix = hashToBase36(`${userId}:${courseId}`).padStart(5, '0').slice(0, 5);
  return `TL-${companySlug(company)}-${suffix}`;
}

export async function downloadCertificate({ user, company, course }) {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const centerX = pageWidth / 2;

  // Moldura decorativa dupla (verde grosso por fora, dourado fino por dentro).
  doc.setDrawColor(...EMERALD_DARK);
  doc.setLineWidth(1.2);
  doc.rect(8, 8, pageWidth - 16, pageHeight - 16);
  doc.setDrawColor(...AMBER);
  doc.setLineWidth(0.4);
  doc.rect(12, 12, pageWidth - 24, pageHeight - 24);

  // Logo: quadrado verde com "T" (mesmo mark do cabeçalho do app) + wordmark.
  const markSize = 14;
  doc.setFillColor(...EMERALD);
  doc.roundedRect(centerX - markSize / 2, 22, markSize, markSize, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('T', centerX, 22 + markSize / 2 + 1.8, { align: 'center' });

  doc.setTextColor(...EMERALD_DARK);
  doc.setFontSize(13);
  doc.text('TaxLingo', centerX, 44, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_LIGHT);
  doc.text('by OneAct', centerX, 49, { align: 'center' });

  // Título.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(27);
  doc.setTextColor(...SLATE);
  doc.text('CERTIFICADO DE CONCLUSÃO', centerX, 68, { align: 'center' });

  // Corpo.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...SLATE);
  doc.text('Certificamos que', centerX, 84, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...EMERALD_DARK);
  doc.text(user.name, centerX, 97, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...SLATE);
  const companyLine = company?.name ? `colaborador(a) de ${company.name},` : 'colaborador(a),';
  doc.text(companyLine, centerX, 107, { align: 'center' });
  doc.text('concluiu com aproveitamento o treinamento', centerX, 115, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(course.title, centerX, 126, { align: 'center', maxWidth: pageWidth - 70 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text(`com carga horária total de ${WORKLOAD_HOURS} horas.`, centerX, 138, { align: 'center' });

  // Linha decorativa acima do rodapé.
  doc.setDrawColor(...AMBER);
  doc.setLineWidth(0.3);
  doc.line(centerX - 40, 154, centerX + 40, 154);

  // Rodapé: data de conclusão + código de validação.
  const completionDate = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const validationCode = buildValidationCode(user.id, course.id, company);

  doc.setFontSize(10);
  doc.setTextColor(...SLATE_LIGHT);
  doc.text(`Emitido em ${completionDate}`, centerX - 55, pageHeight - 24, { align: 'center' });
  doc.text(`Código de validação: ${validationCode}`, centerX + 55, pageHeight - 24, { align: 'center' });

  const safeName = user.name.trim().replace(/\s+/g, '_');
  const safeCourse = course.title.trim().replace(/\s+/g, '_');
  doc.save(`Certificado_TaxLingo_${safeCourse}_${safeName}.pdf`);
}
