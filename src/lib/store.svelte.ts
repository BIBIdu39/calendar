import type { CourseEvent, Preferences, CourseType } from './types';
import { parseICS } from './parser';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { DEFAULT_RAW_ICS } from './default-data';

export const WORKING_LYON1_URL =
  'https://edt.univ-lyon1.fr/jsp/custom/modules/plannings/anonymous_cal.jsp?resources=47168,12102&projectId=1&calType=ical&firstDate=2026-08-18&lastDate=2027-08-01';

export function normalizeCalendarUrl(input?: string): string {
  let url = (input || '').trim().replace(/^["']|["']$/g, '').trim();
  if (!url) return WORKING_LYON1_URL;

  if (/^webcal:\/\//i.test(url)) {
    url = url.replace(/^webcal:\/\//i, 'https://');
  } else if (/^webcals:\/\//i.test(url)) {
    url = url.replace(/^webcals:\/\//i, 'https://');
  }

  // If the user pastes any Lyon 1 portal link or encryptedUrl, seamlessly convert to the working direct anonymous_cal export feed
  if (
    url.includes('edt.univ-lyon1.fr') &&
    (url.includes('portal') || url.includes('encryptedUrl') || !url.includes('anonymous_cal.jsp'))
  ) {
    return WORKING_LYON1_URL;
  }

  return url;
}

const defaultPreferences: Preferences = {
  url: WORKING_LYON1_URL,
  theme: 'dark',
  density: 'comfortable',
  startHour: 8,
  endHour: 20,
  colors: {},
  notes: {},
  lastSync: undefined
};

// Course Type Styles (used for badges and fallbacks)
export const TYPE_STYLES: Record<CourseType, { label: string; badgeBg: string; badgeText: string; accent: string }> = {
  CM: {
    label: 'Cours Magistral',
    badgeBg: 'bg-indigo-500/25 border border-indigo-400/40',
    badgeText: 'text-indigo-200',
    accent: '#6366f1'
  },
  TD: {
    label: 'Travaux Dirigés',
    badgeBg: 'bg-purple-500/25 border border-purple-400/40',
    badgeText: 'text-purple-200',
    accent: '#a855f7'
  },
  TP: {
    label: 'Travaux Pratiques',
    badgeBg: 'bg-emerald-500/25 border border-emerald-400/40',
    badgeText: 'text-emerald-200',
    accent: '#10b981'
  },
  EXAM: {
    label: 'Examen / DS',
    badgeBg: 'bg-rose-500/30 border border-rose-400/50',
    badgeText: 'text-rose-200',
    accent: '#f43f5e'
  },
  PROJECT: {
    label: 'SAÉ / Projet',
    badgeBg: 'bg-amber-500/25 border border-amber-400/40',
    badgeText: 'text-amber-200',
    accent: '#f59e0b'
  },
  OTHER: {
    label: 'Autre',
    badgeBg: 'bg-cyan-500/25 border border-cyan-400/40',
    badgeText: 'text-cyan-200',
    accent: '#06b6d4'
  }
};

export interface SubjectTheme {
  bg: string;
  border: string;
  accent: string;
  badgeBg: string;
  badgeText: string;
}

// Rich, solid and distinct color palette matching modern calendar apps
export const MODERN_PALETTES = [
  '#d946ef', // Fuchsia / Magenta (Maths)
  '#0284c7', // Sky / Cyan (Archi / Dev)
  '#10b981', // Emerald Green (TP / Web)
  '#8b5cf6', // Violet / Purple (TD / Langues)
  '#ea580c', // Orange / Rust (Economie / Gestion)
  '#2563eb', // Royal Blue (Intro Système)
  '#14b8a6', // Teal (Conception BD)
  '#f43f5e', // Rose Red (Examens / Projets)
  '#7c3aed', // Deep Purple (Communication)
  '#f59e0b', // Amber / Gold
  '#06b6d4', // Vivid Cyan
  '#059669', // Forest Green
];

export function getSubjectColor(title: string, customColor?: string): string {
  if (customColor) return customColor;
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  return MODERN_PALETTES[Math.abs(hash) % MODERN_PALETTES.length];
}

export function getEventTheme(title: string, customColor?: string): SubjectTheme {
  const accent = customColor || getSubjectColor(title);

  // Parse hex to rgba
  let hex = accent.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.substring(0, 2), 16) || 99;
  const g = parseInt(hex.substring(2, 4), 16) || 102;
  const b = parseInt(hex.substring(4, 6), 16) || 241;

  return {
    bg: `rgba(${r}, ${g}, ${b}, 0.32)`,
    border: `rgba(${r}, ${g}, ${b}, 0.55)`,
    accent: accent,
    badgeBg: `rgba(${r}, ${g}, ${b}, 0.45)`,
    badgeText: '#ffffff'
  };
}

// Compute overlapping columns layout for courses in the same time slot
export function computeOverlapLayout(events: CourseEvent[]): CourseEvent[] {
  if (!events || events.length === 0) return [];

  // Group events by day key (YYYY-MM-DD or toDateString)
  const dayGroups: Record<string, CourseEvent[]> = {};
  for (const e of events) {
    const key = new Date(e.start).toDateString();
    if (!dayGroups[key]) dayGroups[key] = [];
    dayGroups[key].push(e);
  }

  const result: CourseEvent[] = [];

  for (const dayKey in dayGroups) {
    const dayEvents = dayGroups[dayKey].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    // Group into clusters of overlapping events
    const clusters: CourseEvent[][] = [];
    let currentCluster: CourseEvent[] = [];
    let clusterEnd = 0;

    for (const ev of dayEvents) {
      const evStart = new Date(ev.start).getTime();
      const evEnd = new Date(ev.end).getTime();

      if (currentCluster.length === 0) {
        currentCluster.push(ev);
        clusterEnd = evEnd;
      } else if (evStart < clusterEnd) {
        currentCluster.push(ev);
        clusterEnd = Math.max(clusterEnd, evEnd);
      } else {
        clusters.push(currentCluster);
        currentCluster = [ev];
        clusterEnd = evEnd;
      }
    }
    if (currentCluster.length > 0) {
      clusters.push(currentCluster);
    }

    // Assign column indices within each cluster
    for (const cluster of clusters) {
      const columns: CourseEvent[][] = [];

      for (const ev of cluster) {
        let placed = false;
        for (let colIdx = 0; colIdx < columns.length; colIdx++) {
          const lastInCol = columns[colIdx][columns[colIdx].length - 1];
          if (new Date(lastInCol.end).getTime() <= new Date(ev.start).getTime()) {
            columns[colIdx].push(ev);
            ev.colIndex = colIdx;
            placed = true;
            break;
          }
        }
        if (!placed) {
          ev.colIndex = columns.length;
          columns.push([ev]);
        }
      }

      const totalCols = columns.length;
      for (const ev of cluster) {
        ev.totalCols = totalCols;
        result.push(ev);
      }
    }
  }

  return result;
}

function getInitialPreferences(): Preferences {
  try {
    if (typeof localStorage !== 'undefined') {
      const localPrefs =
        localStorage.getItem('cal_preferences') ||
        localStorage.getItem('preferences') ||
        localStorage.getItem('calendar_preferences');
      if (localPrefs) {
        const parsed = JSON.parse(localPrefs);
        return {
          ...defaultPreferences,
          ...parsed,
          url: normalizeCalendarUrl(parsed.url)
        };
      }
    }
  } catch (e) {
    console.warn('Erreur lecture localStorage initial :', e);
  }
  return defaultPreferences;
}

function getInitialEvents(): CourseEvent[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const localCache =
        localStorage.getItem('cal_events_cache') ||
        localStorage.getItem('calendar_cache') ||
        localStorage.getItem('cached_events');
      if (localCache && localCache.toUpperCase().includes('BEGIN:VCALENDAR')) {
        const parsed = parseICS(localCache);
        if (parsed.length > 0) {
          return computeOverlapLayout(parsed);
        }
      }
    }
  } catch (e) {
    console.warn('Erreur lecture cache initial :', e);
  }

  // Pre-seed with verified student timetable if no cache is loaded yet!
  if (DEFAULT_RAW_ICS) {
    try {
      const parsed = parseICS(DEFAULT_RAW_ICS);
      if (parsed.length > 0) {
        return computeOverlapLayout(parsed);
      }
    } catch (e) {
      console.warn('Erreur parsing DEFAULT_RAW_ICS :', e);
    }
  }

  return [];
}

export function createCalendarStore() {
  let events = $state<CourseEvent[]>(getInitialEvents());
  let preferences = $state<Preferences>(getInitialPreferences());
  let loading = $state(false);
  let error = $state<string | null>(null);
  let searchQuery = $state('');
  let selectedEvent = $state<CourseEvent | null>(null);

  async function loadPreferences() {
    try {
      if (isTauri()) {
        const { LazyStore } = await import('@tauri-apps/plugin-store');
        const tauriStore = new LazyStore('calendar_preferences.json');
        const loadedPrefs = await tauriStore.get<Preferences>('preferences');
        if (loadedPrefs && loadedPrefs.url) {
          preferences = { ...defaultPreferences, ...loadedPrefs };
          preferences.url = normalizeCalendarUrl(preferences.url);
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('cal_preferences', JSON.stringify(preferences));
          }
        }
        if (events.length === 0) {
          const cachedRaw = await tauriStore.get<string>('cached_events');
          if (cachedRaw && cachedRaw.toUpperCase().includes('BEGIN:VCALENDAR')) {
            const parsed = parseICS(cachedRaw);
            if (parsed.length > 0) {
              events = computeOverlapLayout(parsed);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Note store Tauri :', e);
    }
  }

  async function savePreferences() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('cal_preferences', JSON.stringify(preferences));
      }
      if (isTauri()) {
        const { LazyStore } = await import('@tauri-apps/plugin-store');
        const tauriStore = new LazyStore('calendar_preferences.json');
        await tauriStore.set('preferences', preferences);
        await tauriStore.save();
      }
    } catch (e) {
      console.warn('Note sauvegarde préférences :', e);
    }
  }

  async function fetchICSData(targetUrl: string): Promise<string> {
    const url = normalizeCalendarUrl(targetUrl);

    // 1. Native Rust reqwest (Tauri desktop)
    if (isTauri()) {
      try {
        const text = await invoke<string>('fetch_calendar', { url });
        if (text && text.toUpperCase().includes('BEGIN:VCALENDAR')) {
          return text;
        }
      } catch (rustErr) {
        console.warn('Rust fetch_calendar fallback:', rustErr);
      }

      try {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        const res = await tauriFetch(url);
        if (res.ok) {
          const text = await res.text();
          if (text.toUpperCase().includes('BEGIN:VCALENDAR')) {
            return text;
          }
        }
      } catch (pluginErr) {
        console.warn('Tauri plugin-http fallback:', pluginErr);
      }
    }

    // 2. Serverless proxy (Vercel / Netlify) or Vite Dev Proxy
    try {
      const proxyRes = await window.fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
      if (proxyRes.ok) {
        const text = await proxyRes.text();
        if (text && text.toUpperCase().includes('BEGIN:VCALENDAR')) {
          return text;
        }
      }
    } catch {}

    try {
      const proxyRes = await window.fetch(`/api/proxy-calendar?url=${encodeURIComponent(url)}`);
      if (proxyRes.ok) {
        const text = await proxyRes.text();
        if (text && text.toUpperCase().includes('BEGIN:VCALENDAR')) {
          return text;
        }
      }
    } catch {}

    // 3. Direct fetch
    try {
      const directRes = await window.fetch(url);
      if (directRes.ok) {
        const text = await directRes.text();
        if (text && text.toUpperCase().includes('BEGIN:VCALENDAR')) {
          return text;
        }
      }
    } catch {
      // Expected CORS block in browser
    }

    // 4. Public CORS proxies
    const corsProxies = [
      `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    ];
    for (const proxy of corsProxies) {
      try {
        const pRes = await window.fetch(proxy);
        if (pRes.ok) {
          const text = await pRes.text();
          if (text && text.toUpperCase().includes('BEGIN:VCALENDAR')) {
            return text;
          }
        }
      } catch {}
    }

    // If all network calls fail but we already have events loaded, return empty to not overwrite
    if (events.length > 0) {
      return '';
    }

    throw new Error(
      "Impossible de joindre le serveur iCal de l'université. Vos cours enregistrés restent consultables."
    );
  }

  async function syncEvents() {
    const rawUrl = preferences.url || WORKING_LYON1_URL;
    loading = true;
    error = null;

    try {
      const cleanUrl = normalizeCalendarUrl(rawUrl);
      preferences.url = cleanUrl;

      const rawICS = await fetchICSData(cleanUrl);

      if (rawICS && rawICS.toUpperCase().includes('BEGIN:VCALENDAR')) {
        const parsed = parseICS(rawICS);
        if (parsed.length > 0) {
          events = computeOverlapLayout(parsed);
          preferences.lastSync = new Date().toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit'
          });

          // Save cache
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('cal_events_cache', rawICS);
              localStorage.setItem('cal_preferences', JSON.stringify(preferences));
            }
            if (isTauri()) {
              const { LazyStore } = await import('@tauri-apps/plugin-store');
              const tauriStore = new LazyStore('calendar_preferences.json');
              await tauriStore.set('cached_events', rawICS);
              await tauriStore.set('preferences', preferences);
              await tauriStore.save();
            }
          } catch (cacheErr) {
            console.warn('Erreur non bloquante sauvegarde cache :', cacheErr);
          }
        }
      } else if (events.length === 0) {
        throw new Error(
          "Le lien ne contient pas de calendrier iCalendar valide (vérifiez que l'URL d'exportation est publique)"
        );
      } else {
        // Keep existing courses, update sync label
        preferences.lastSync =
          new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) +
          ' (hors-ligne)';
      }
    } catch (err: any) {
      console.error('Erreur synchronisation :', err);
      if (events.length === 0) {
        error = err?.message || 'Échec de synchronisation avec le serveur universitaire';
      }
    } finally {
      loading = false;
    }
  }

  function importICSContent(rawICS: string): boolean {
    error = null;
    try {
      if (!rawICS || !rawICS.toUpperCase().includes('BEGIN:VCALENDAR')) {
        throw new Error("Le fichier fourni ne contient pas de données iCalendar (.ics) valides.");
      }
      const parsed = parseICS(rawICS);
      if (parsed.length === 0) {
        throw new Error("Aucun cours trouvé dans ce fichier iCalendar.");
      }
      events = computeOverlapLayout(parsed);
      preferences.lastSync =
        new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) +
        ' (import fichier)';
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('cal_events_cache', rawICS);
      }
      return true;
    } catch (e: any) {
      error = e?.message || 'Erreur lors de la lecture du fichier .ics';
      return false;
    }
  }

  function setUrl(url: string) {
    preferences.url = normalizeCalendarUrl(url);
    savePreferences();
    syncEvents();
  }

  function setSubjectColor(subject: string, color: string) {
    preferences.colors[subject] = color;
    savePreferences();
  }

  function setEventNote(id: string, note: string) {
    preferences.notes[id] = note;
    savePreferences();
  }

  function setTheme(theme: Preferences['theme']) {
    preferences.theme = theme;
    savePreferences();
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  return {
    get events() { return events; },
    get preferences() { return preferences; },
    get loading() { return loading; },
    get error() { return error; },
    get searchQuery() { return searchQuery; },
    set searchQuery(val: string) { searchQuery = val; },
    get selectedEvent() { return selectedEvent; },
    set selectedEvent(ev: CourseEvent | null) { selectedEvent = ev; },
    loadPreferences,
    savePreferences,
    syncEvents,
    importICSContent,
    setUrl,
    setSubjectColor,
    setEventNote,
    setTheme
  };
}

export const calendarStore = createCalendarStore();
