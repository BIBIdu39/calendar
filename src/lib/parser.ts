import ICAL from 'ical.js';
import type { CourseEvent, CourseType } from './types';

// Enhanced Course Type detection
function detectCourseType(title: string, description: string): CourseType {
  const text = `${title} ${description}`.toUpperCase();

  if (/\b(EXAM|DS|PARTIEL|EVAL|EVALUATION|CONTROLE)\b/i.test(text)) return 'EXAM';
  if (/\b(SAE|PROJET|PROJ|WORKSHOP)\b/i.test(text)) return 'PROJECT';
  if (/\b(TP[A-Z0-9]*|TRAVAUX\s+PRATIQUES?)\b/i.test(text)) return 'TP';
  if (/\b(TD\s*G?\d*|TRAVAUX\s+DIRIGES?)\b/i.test(text)) return 'TD';
  if (/\b(CM|COURS\s+MAGISTRAL)\b/i.test(text)) return 'CM';

  return 'OTHER';
}

// Extract Resource/Module code like R1.07, R1.03, SAE1.01, 12R1.03
function extractCode(text: string): string | undefined {
  const match = text.match(/\b([RS]\d+\.[\w-]+|[A-Z]{2,}\d+)\b/i) || text.match(/([RS]\d+\.[\w-]+)/i);
  return match ? match[1].toUpperCase() : undefined;
}

// Extract student group / subdivision (e.g. "G1", "TPB P1", "S1-TPB", "TPE")
function extractGroup(title: string, description: string): string | undefined {
  const match = `${title} ${description}`.match(/\b(TP[A-Z0-9]+(?:\s*P\d+)?|TD\s*G?\d+|G\d+(?:\s*P\d+)?)\b/i);
  return match ? match[1].trim() : undefined;
}

// Clean course title for display while preserving meaning
function cleanTitle(rawSummary: string, code?: string): string {
  let title = rawSummary.trim();

  // Strip leading prefixes like "33 ", "12", "11 ", "F11 ", "24 ", "21 "
  title = title.replace(/^([A-Z]?\d+[\s_-]+)+/i, '');

  // Remove the extracted module code from title if present
  if (code) {
    const codeRegex = new RegExp(`\\b${code.replace('.', '\\.')}\\b[-_\\s]*`, 'i');
    title = title.replace(codeRegex, '');
  }

  // Remove common suffixes like "-CM", "-TD G1", "-TPB P1", " TD", " TPB", etc.
  title = title.replace(/[-_\s]+(CM|TD|TP[A-Z0-9]*|EXAM|DS|SAE)(\s*(G\d+|P\d+|[A-Z0-9]+))?$/i, '');
  title = title.replace(/[-_\s]+(CM|TD|TP[A-Z0-9]*)$/i, '');

  // Clean trailing and leading dashes, colons, underscores
  title = title.replace(/^[-_:;\s]+|[-_:;\s]+$/g, '').trim();

  // If cleaning resulted in an empty or tiny string, fallback to rawSummary
  return title.length > 1 ? title : rawSummary;
}

function extractTeacher(description: string): string {
  if (!description) return 'Non spécifié';

  const lines = description.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/(?:Enseignant|Professeur|Intervenant)s?\s*:\s*(.+)/i);
    if (match) return match[1].trim();
  }

  // Fallback: look for lines that look like a person's name (e.g. DUPONT Jean)
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[A-ZÉÈÊËÀÂÎÏÔÛÇ\s-]{2,}\s+[A-Za-zÉÈÊËÀÂÎÏÔÛÇ\s-]+$/.test(trimmed) && trimmed.length < 40) {
      return trimmed;
    }
  }

  return 'Non spécifié';
}

function extractLocation(location: string, description: string): { location: string; room?: string; building?: string } {
  let rawLoc = (location || '').trim();

  if (!rawLoc && description) {
    const match = description.match(/(?:Salle|Lieu|Amphi)\s*:\s*(.+)/i);
    if (match) rawLoc = match[1].trim();
  }

  if (!rawLoc) return { location: 'Salle non définie' };

  let formatted = rawLoc;
  if (/^Amphi\d+$/i.test(formatted)) {
    formatted = formatted.replace(/(Amphi)(\d+)/i, '$1 $2');
  }

  return {
    location: formatted,
    room: formatted
  };
}

export function parseICS(icsData: string): CourseEvent[] {
  if (!icsData || typeof icsData !== 'string') return [];

  try {
    const jcalData = ICAL.parse(icsData);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents('vevent');

    const result: CourseEvent[] = [];

    for (const vevent of vevents) {
      try {
        const event = new ICAL.Event(vevent);

        const rawTitle = (event.summary || 'Cours sans titre').trim();
        const description = (event.description || '').trim();
        const code = extractCode(rawTitle) || extractCode(description);
        const title = cleanTitle(rawTitle, code);
        const group = extractGroup(rawTitle, description);
        const type = detectCourseType(rawTitle, description);
        const locInfo = extractLocation(event.location, description);

        // Safe date parsing with fallbacks
        let start: Date;
        let end: Date;

        try {
          start = event.startDate ? event.startDate.toJSDate() : new Date();
        } catch {
          start = new Date();
        }

        try {
          end = event.endDate ? event.endDate.toJSDate() : new Date(start.getTime() + 2 * 3600 * 1000);
        } catch {
          end = new Date(start.getTime() + 2 * 3600 * 1000);
        }

        result.push({
          id: event.uid || `${rawTitle}-${start.getTime()}-${Math.random()}`,
          rawTitle,
          title,
          code,
          group,
          type,
          start,
          end,
          location: locInfo.location,
          room: locInfo.room,
          building: locInfo.building,
          teacher: extractTeacher(description),
          description,
          notes: ''
        });
      } catch (eventErr) {
        console.warn('Erreur sur un événement individuel (ignoré) :', eventErr);
      }
    }

    return result.sort((a, b) => a.start.getTime() - b.start.getTime());
  } catch (err) {
    console.error('Erreur lors du parsing ICS global :', err);
    return [];
  }
}
