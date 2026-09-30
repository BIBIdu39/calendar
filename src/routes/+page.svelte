<script lang="ts">
  import { calendarStore, TYPE_STYLES, getEventTheme, MODERN_PALETTES } from '$lib/store.svelte';
  import type { CourseEvent, CourseType } from '$lib/types';
  import {
    ChevronLeft,
    ChevronRight,
    Calendar,
    CalendarRange,
    Clock,
    MapPin,
    User,
    Search,
    RefreshCw,
    Settings,
    X,
    Copy,
    Check,
    Palette,
    FileText,
    Sparkles,
    AlertCircle,
    Info,
    ArrowRight,
    ExternalLink,
    Upload,
    List,
    Columns3,
    SlidersHorizontal,
    Share2,
    Download
  } from 'lucide-svelte';
  import { format, startOfWeek, addDays, isSameDay, differenceInMinutes } from 'date-fns';
  import { fr } from 'date-fns/locale';
  import { onMount } from 'svelte';

  // Helper to determine if courses for the day are finished (after 18:30)
  function isAfter18h30(date: Date = new Date()): boolean {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    return hours > 18 || (hours === 18 && minutes >= 30);
  }

  // Get initial/effective target date: today, or tomorrow if after 18:30
  function getEffectiveDate(): Date {
    const now = new Date();
    if (isAfter18h30(now)) {
      return addDays(now, 1);
    }
    return now;
  }

  let currentDate = $state(getEffectiveDate());
  let view = $state<'day' | 'week' | 'agenda'>('week');
  let showSettings = $state(false);
  let activeTab = $state<'feed' | 'appearance' | 'update' | 'shortcuts'>('feed');
  let icsUrlInput = $state(calendarStore.preferences.url);
  let selectedFilter = $state<CourseType | 'ALL'>('ALL');
  let copiedRoom = $state(false);
  let showLyon1Help = $state(false);
  let showMobileSearch = $state(false);
  let showMobileFilterMenu = $state(false);
  let isMobile = $state(false);

  // App In-App Updater State
  const APP_VERSION = '1.0.0';
  let isCheckingUpdate = $state(false);
  let updateStatus = $state<{
    available: boolean;
    latestVersion: string;
    currentVersion: string;
    downloadUrl: string;
    releaseNotes?: string;
  } | null>(null);
  let updateError = $state<string | null>(null);
  let updateCheckDone = $state(false);

  async function checkForAppUpdate(silent = false) {
    if (!silent) triggerHaptic();
    isCheckingUpdate = true;
    updateError = null;
    if (!silent) {
      updateStatus = null;
      updateCheckDone = false;
    }

    try {
      const res = await fetch('https://api.github.com/repos/BIBIdu39/calendar/releases/latest', {
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });

      if (!res.ok) {
        throw new Error(`Serveur GitHub inaccessible (${res.status})`);
      }

      const data = await res.json();
      const latestTag = (data.tag_name || '').replace(/^v/, '');
      const releaseNotes = data.body || '';

      const apkAsset = data.assets?.find((a: any) => a.name?.toLowerCase().endsWith('.apk'));
      const downloadUrl = apkAsset?.browser_download_url ||
        'https://github.com/BIBIdu39/calendar/releases/latest/download/Calendar-Android.apk';

      function isNewer(latest: string, current: string): boolean {
        const lParts = latest.split('.').map(n => parseInt(n, 10) || 0);
        const cParts = current.split('.').map(n => parseInt(n, 10) || 0);
        for (let i = 0; i < Math.max(lParts.length, cParts.length); i++) {
          const l = lParts[i] || 0;
          const c = cParts[i] || 0;
          if (l > c) return true;
          if (l < c) return false;
        }
        return false;
      }

      const isAvailable = isNewer(latestTag, APP_VERSION);

      updateStatus = {
        available: isAvailable,
        latestVersion: latestTag || '1.0.0',
        currentVersion: APP_VERSION,
        downloadUrl,
        releaseNotes
      };
      updateCheckDone = true;
    } catch (err: any) {
      if (!silent) {
        console.error('Erreur vérification mise à jour:', err);
        updateError = err.message || 'Impossible de vérifier les mises à jour';
      }
    } finally {
      isCheckingUpdate = false;
    }
  }

  function downloadAndInstallUpdate(url?: string) {
    triggerHaptic();
    const targetUrl = url || updateStatus?.downloadUrl || 'https://github.com/BIBIdu39/calendar/releases/latest/download/Calendar-Android.apk';
    if (typeof window !== 'undefined') {
      window.open(targetUrl, '_blank');
    }
  }

  // Touch swipe gesture tracking for mobile
  let touchStartX = 0;
  let touchStartY = 0;

  function updateIsMobile() {
    if (typeof window !== 'undefined') {
      const ua = navigator.userAgent.toLowerCase();
      const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
      const isSmall = window.innerWidth < 768;
      const prev = isMobile;
      isMobile = isMobileUA || isSmall;
      if (!prev && isMobile && view === 'week') {
        view = 'day';
      }
    }
  }

  onMount(() => {
    updateIsMobile();
    if (isMobile) {
      view = 'day';
    }
    // Silently check for update after 2.5s
    setTimeout(() => {
      checkForAppUpdate(true);
    }, 2500);

    window.addEventListener('resize', updateIsMobile);
    return () => {
      window.removeEventListener('resize', updateIsMobile);
    };
  });

  // Sync icsUrlInput when store preferences change
  $effect(() => {
    if (calendarStore.preferences.url && !icsUrlInput) {
      icsUrlInput = calendarStore.preferences.url;
    }
  });

  // Watch URL for Lyon 1 portal pattern
  $effect(() => {
    if (icsUrlInput.includes('/portal/') || icsUrlInput.includes('encryptedUrl')) {
      showLyon1Help = true;
    }
  });

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      try {
        const text = await file.text();
        const success = calendarStore.importICSContent(text);
        if (success) {
          showSettings = false;
        }
      } catch (err: any) {
        console.error('Erreur import fichier .ics:', err);
      }
    }
  }

  // Keep track of which week has events if the current week is empty
  let nearestEventWeek = $derived.by(() => {
    if (calendarStore.events.length === 0) return null;
    const sorted = [...calendarStore.events].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );
    const now = new Date();
    const upcoming = sorted.find(e => new Date(e.start).getTime() >= now.getTime()) || sorted[0];
    return upcoming ? new Date(upcoming.start) : null;
  });

  // Calculate 6 days for the week (Lundi - Samedi)
  function getWeekDays(date: Date) {
    const start = startOfWeek(date, { weekStartsOn: 1 });
    return Array.from({ length: 6 }).map((_, i) => addDays(start, i));
  }

  let weekDays = $derived(getWeekDays(currentDate));

  // Determine which days to show in the time grid
  let daysToShow = $derived.by(() => {
    if (view === 'day') {
      return [currentDate];
    }
    return weekDays;
  });

  // Count events for a specific day
  function getEventsCountForDay(day: Date) {
    return calendarStore.events.filter(e => isSameDay(new Date(e.start), day)).length;
  }

  // Count total events in currently displayed week
  let currentWeekEventsCount = $derived.by(() => {
    return weekDays.reduce((acc, day) => acc + getEventsCountForDay(day), 0);
  });

  // Filter events for a given day
  function getFilteredEventsForDay(day: Date) {
    return calendarStore.events.filter(event => {
      if (!isSameDay(new Date(event.start), day)) return false;

      // Filter by type
      if (selectedFilter !== 'ALL' && event.type !== selectedFilter) return false;

      // Filter by search query
      if (calendarStore.searchQuery.trim()) {
        const q = calendarStore.searchQuery.toLowerCase();
        const matchesTitle = event.title.toLowerCase().includes(q);
        const matchesRaw = event.rawTitle.toLowerCase().includes(q);
        const matchesCode = event.code?.toLowerCase().includes(q);
        const matchesLoc = event.location.toLowerCase().includes(q);
        const matchesTeacher = event.teacher.toLowerCase().includes(q);
        return matchesTitle || matchesRaw || matchesCode || matchesLoc || matchesTeacher;
      }

      return true;
    });
  }

  // Agenda list view items (starting from today/tomorrow, not from start of week)
  let agendaDays = $derived.by(() => {
    // Starts directly from current effective date (today or tomorrow after 18:30)
    const days = Array.from({ length: 7 }).map((_, i) => addDays(currentDate, i));
    return days.map(day => ({
      date: day,
      isToday: isSameDay(day, new Date()),
      events: getFilteredEventsForDay(day).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    }));
  });

  // Navigation functions
  function triggerHaptic() {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(8); } catch {}
    }
  }

  function goPrev() {
    triggerHaptic();
    if (view === 'day') {
      currentDate = addDays(currentDate, -1);
    } else {
      currentDate = addDays(currentDate, -7);
    }
  }

  function goNext() {
    triggerHaptic();
    if (view === 'day') {
      currentDate = addDays(currentDate, 1);
    } else {
      currentDate = addDays(currentDate, 7);
    }
  }

  function goToday() {
    triggerHaptic();
    currentDate = getEffectiveDate();
  }

  function jumpToNearestWeek() {
    triggerHaptic();
    if (nearestEventWeek) {
      currentDate = new Date(nearestEventWeek);
    }
  }

  // Touch gestures for mobile swipe
  function handleTouchStart(e: TouchEvent) {
    touchStartX = e.changedTouches[0].clientX;
    touchStartY = e.changedTouches[0].clientY;
  }

  function handleTouchEnd(e: TouchEvent) {
    // Only allow swipe navigation in 'day' view:
    // In 'week' view, swipe is disabled so horizontal scrolling across days works smoothly without switching weeks!
    if (view !== 'day') return;

    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;

    if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      if (deltaX < 0) {
        goNext();
      } else {
        goPrev();
      }
    }
  }

  // Keyboard shortcuts (Desktop)
  function handleKeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      if (e.key === 'Escape') {
        (e.target as HTMLElement).blur();
        calendarStore.selectedEvent = null;
        showSettings = false;
      }
      return;
    }

    if (e.key === 'ArrowLeft') goPrev();
    if (e.key === 'ArrowRight') goNext();
    if (e.key.toLowerCase() === 't') goToday();
    if (e.key.toLowerCase() === 'r') calendarStore.syncEvents();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      document.getElementById('calendar-search-input')?.focus();
    }
    if (e.key === 'Escape') {
      calendarStore.selectedEvent = null;
      showSettings = false;
    }
  }

  const HOUR_HEIGHT = 64; // px per hour
  const startHour = 8;
  const endHour = 20;
  const totalHours = endHour - startHour; // 12 hours (8h00 to 20h00)
  const totalGridHeight = totalHours * HOUR_HEIGHT; // 768px

  // Semester classes at Lyon 1 started on Monday September 7, 2026 (Semaine 1)
  const SEMESTER_START_MONDAY = new Date('2026-09-07T00:00:00');

  function getAcademicWeek(date: Date): number {
    const monday = startOfWeek(date, { weekStartsOn: 1 });
    const diffMs = monday.getTime() - SEMESTER_START_MONDAY.getTime();
    const diffWeeks = Math.floor(diffMs / (7 * 24 * 3600 * 1000));
    return Math.max(1, diffWeeks + 1);
  }

  let academicWeekNumber = $derived(getAcademicWeek(currentDate));

  let isCurrentPeriod = $derived.by(() => {
    const target = getEffectiveDate();
    if (view === 'day') {
      return isSameDay(currentDate, target);
    }
    return isSameDay(
      startOfWeek(currentDate, { weekStartsOn: 1 }),
      startOfWeek(target, { weekStartsOn: 1 })
    );
  });

  let formattedPeriodTitle = $derived.by(() => {
    if (view === 'day') {
      return format(currentDate, 'EEEE d MMMM', { locale: fr });
    }
    if (view === 'agenda') {
      const start = currentDate;
      const end = addDays(currentDate, 6);
      if (start.getMonth() === end.getMonth()) {
        return `${format(start, 'd', { locale: fr })} – ${format(end, 'd MMMM yyyy', { locale: fr })}`;
      } else {
        return `${format(start, 'd MMM', { locale: fr })} – ${format(end, 'd MMM yyyy', { locale: fr })}`;
      }
    }
    const days = weekDays;
    const start = days[0];
    const end = days[days.length - 1];
    if (start.getMonth() === end.getMonth()) {
      return `${format(start, 'd', { locale: fr })} – ${format(end, 'd MMMM yyyy', { locale: fr })}`;
    } else {
      return `${format(start, 'd MMM', { locale: fr })} – ${format(end, 'd MMM yyyy', { locale: fr })}`;
    }
  });

  // Calculate card layout and pixel-perfect style
  function calculateCardStyle(event: CourseEvent) {
    const start = new Date(event.start);
    const end = new Date(event.end);

    const startMins = (start.getHours() - startHour) * 60 + start.getMinutes();
    const durationMins = Math.max(25, differenceInMinutes(end, start));

    const topPx = Math.max(0, Math.round((startMins / 60) * HOUR_HEIGHT));
    const heightPx = Math.max(32, Math.round((durationMins / 60) * HOUR_HEIGHT) - 3);

    // Overlap layout
    const totalCols = event.totalCols || 1;
    const colIndex = event.colIndex || 0;
    const widthPct = 100 / totalCols;
    const leftPct = widthPct * colIndex;

    const customColor = calendarStore.preferences.colors[event.title];
    const theme = getEventTheme(event.title, customColor);

    const styleString = `top: ${topPx}px; height: ${heightPx}px; width: calc(${widthPct}% - 6px); left: calc(${leftPct}% + 3px); background-color: ${theme.bg}; border-color: ${theme.border}; border-left-color: ${theme.accent};`;

    return {
      styleString,
      theme,
      isCompact: heightPx < 55
    };
  }

  // Real-time current time line
  let currentTime = $state(new Date());
  $effect(() => {
    const interval = setInterval(() => { currentTime = new Date(); }, 60000);
    return () => clearInterval(interval);
  });

  let currentTimePositionPx = $derived.by(() => {
    const currentMins = (currentTime.getHours() - startHour) * 60 + currentTime.getMinutes();
    return Math.round((currentMins / 60) * HOUR_HEIGHT);
  });

  function copyRoomToClipboard(room: string) {
    triggerHaptic();
    navigator.clipboard.writeText(room);
    copiedRoom = true;
    setTimeout(() => { copiedRoom = false; }, 2000);
  }

  // Hours array (8h to 20h)
  const hours = Array.from({ length: totalHours + 1 }).map((_, i) => i + startHour);
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  role="region"
  aria-label="Calendrier interactif"
  class="flex flex-col h-full bg-background text-text overflow-hidden select-none"
  ontouchstart={handleTouchStart}
  ontouchend={handleTouchEnd}
>
  <!-- ================= TOP APP BAR ================= -->
  {#if !isMobile}
    <!-- DESKTOP TOP HEADER -->
    <header class="h-14 px-4 border-b border-border flex items-center justify-between shrink-0 glass z-30 gap-3">
      <!-- Left Navigation -->
      <div class="flex items-center gap-2">
        <div class="flex items-center bg-surface-elevated/80 p-0.5 rounded-xl border border-border shadow-sm">
          <button
            onclick={goPrev}
            class="p-1.5 hover:bg-surface text-text-muted hover:text-text rounded-lg transition-all"
            title="Précédent (Flèche gauche)"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onclick={goNext}
            class="p-1.5 hover:bg-surface text-text-muted hover:text-text rounded-lg transition-all"
            title="Suivant (Flèche droite)"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <button
          onclick={goToday}
          class="px-2.5 py-1 text-xs font-semibold rounded-xl border transition-all flex items-center gap-1.5 shadow-sm {isCurrentPeriod
            ? 'bg-surface-elevated/40 text-text-faint border-border/50 cursor-default opacity-80'
            : 'bg-primary text-white border-primary/50 hover:bg-primary/90 hover:shadow-md hover:scale-[1.02] cursor-pointer'}"
          title="Revenir à aujourd'hui (T)"
        >
          <span>Aujourd'hui</span>
          <kbd class="text-[9px] px-1 py-0.2 rounded font-mono {isCurrentPeriod ? 'bg-background border border-border text-text-faint' : 'bg-white/20 text-white'}">T</kbd>
        </button>

        <div class="flex items-center gap-2 pl-1.5">
          <Calendar size={16} class="text-primary shrink-0" />
          <h1 class="text-sm font-bold text-text tracking-tight capitalize whitespace-nowrap">
            {formattedPeriodTitle}
          </h1>
          <span class="text-[11px] px-2.5 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary font-bold whitespace-nowrap">
            Semaine {academicWeekNumber}
          </span>
          {#if isCurrentPeriod}
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-semibold whitespace-nowrap hidden sm:inline-flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              En cours
            </span>
          {/if}
        </div>

        {#if calendarStore.events.length > 0 && currentWeekEventsCount === 0 && nearestEventWeek}
          <button
            onclick={jumpToNearestWeek}
            class="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 transition-all shadow-sm"
            title="Aller directement à la semaine contenant des cours"
          >
            <Sparkles size={12} />
            <span>Voir cours ({format(nearestEventWeek, 'd MMM', { locale: fr })})</span>
          </button>
        {/if}
      </div>

      <!-- Center Search & Filter Chips -->
      <div class="flex-1 max-w-md hidden md:flex items-center gap-2">
        <div class="relative w-full">
          <Search size={13} class="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
          <input
            id="calendar-search-input"
            type="text"
            bind:value={calendarStore.searchQuery}
            placeholder="Rechercher matière, salle, prof... (Ctrl+F)"
            class="w-full h-8 pl-8 pr-8 text-xs bg-surface-elevated/70 border border-border rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all placeholder:text-text-faint"
          />
          {#if calendarStore.searchQuery}
            <button
              onclick={() => calendarStore.searchQuery = ''}
              class="absolute right-2 top-1/2 -translate-y-1/2 text-text-faint hover:text-text p-1"
            >
              <X size={12} />
            </button>
          {/if}
        </div>

        <!-- Filter Pills -->
        <div class="flex items-center gap-0.5 bg-surface-elevated/70 p-0.5 rounded-xl border border-border shrink-0">
          <button
            onclick={() => selectedFilter = 'ALL'}
            class="px-2 py-1 text-[11px] font-medium rounded-lg transition-all {selectedFilter === 'ALL' ? 'bg-primary text-white shadow-sm' : 'text-text-muted hover:text-text'}"
          >
            Tous
          </button>
          <button
            onclick={() => selectedFilter = 'CM'}
            class="px-2 py-1 text-[11px] font-medium rounded-lg transition-all {selectedFilter === 'CM' ? 'bg-indigo-600 text-white shadow-sm' : 'text-text-muted hover:text-text'}"
          >
            CM
          </button>
          <button
            onclick={() => selectedFilter = 'TD'}
            class="px-2 py-1 text-[11px] font-medium rounded-lg transition-all {selectedFilter === 'TD' ? 'bg-purple-600 text-white shadow-sm' : 'text-text-muted hover:text-text'}"
          >
            TD
          </button>
          <button
            onclick={() => selectedFilter = 'TP'}
            class="px-2 py-1 text-[11px] font-medium rounded-lg transition-all {selectedFilter === 'TP' ? 'bg-emerald-600 text-white shadow-sm' : 'text-text-muted hover:text-text'}"
          >
            TP
          </button>
          <button
            onclick={() => selectedFilter = 'EXAM'}
            class="px-2 py-1 text-[11px] font-medium rounded-lg transition-all {selectedFilter === 'EXAM' ? 'bg-rose-600 text-white shadow-sm' : 'text-text-muted hover:text-text'}"
          >
            DS
          </button>
        </div>
      </div>

      <!-- Right Controls -->
      <div class="flex items-center gap-2">
        <!-- View Switcher -->
        <div class="bg-surface-elevated/80 p-0.5 rounded-xl border border-border flex text-xs font-medium shadow-sm">
          <button
            onclick={() => view = 'week'}
            class="px-2.5 py-1 rounded-lg transition-all {view === 'week' ? 'bg-primary text-white shadow-sm' : 'text-text-muted hover:text-text'}"
          >
            Semaine
          </button>
          <button
            onclick={() => view = 'day'}
            class="px-2.5 py-1 rounded-lg transition-all {view === 'day' ? 'bg-primary text-white shadow-sm' : 'text-text-muted hover:text-text'}"
          >
            Jour
          </button>
          <button
            onclick={() => view = 'agenda'}
            class="px-2.5 py-1 rounded-lg transition-all {view === 'agenda' ? 'bg-primary text-white shadow-sm' : 'text-text-muted hover:text-text'}"
          >
            Agenda
          </button>
        </div>

        <!-- Sync Button -->
        <button
          onclick={() => calendarStore.syncEvents()}
          disabled={calendarStore.loading}
          class="h-8 px-3 bg-surface-elevated/80 hover:bg-surface border border-border rounded-xl flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text transition-all group shadow-sm disabled:opacity-50"
          title="Synchroniser le calendrier iCal (R)"
        >
          <RefreshCw size={13} class={calendarStore.loading ? 'animate-spin text-primary' : 'group-hover:rotate-180 transition-transform duration-500'} />
          <span class="hidden sm:inline">
            {calendarStore.loading ? 'Sync...' : calendarStore.preferences.lastSync ? `${calendarStore.preferences.lastSync}` : 'Sync'}
          </span>
        </button>

        <!-- Settings Button -->
        <button
          onclick={() => { icsUrlInput = calendarStore.preferences.url; showSettings = true; }}
          class="h-8 w-8 inline-flex items-center justify-center bg-surface-elevated/80 hover:bg-surface border border-border rounded-xl text-text-muted hover:text-text transition-all shadow-sm"
          title="Paramètres de l'emploi du temps"
        >
          <Settings size={14} />
        </button>
      </div>
    </header>
  {:else}
    <!-- ANDROID MOBILE TOP APP BAR -->
    <header class="h-14 px-3 border-b border-border flex items-center justify-between shrink-0 glass z-30 gap-2">
      <!-- Left: Navigation Arrows & Title -->
      <div class="flex items-center gap-2 min-w-0">
        <div class="flex items-center bg-surface-elevated/90 p-0.5 rounded-xl border border-border/70 shrink-0">
          <button
            onclick={goPrev}
            class="p-1.5 hover:bg-surface text-text-muted hover:text-text rounded-lg transition-all active:scale-95"
            aria-label="Précédent"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onclick={goNext}
            class="p-1.5 hover:bg-surface text-text-muted hover:text-text rounded-lg transition-all active:scale-95"
            aria-label="Suivant"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <button
          onclick={goToday}
          class="text-left flex flex-col justify-center min-w-0 cursor-pointer active:opacity-75"
        >
          <div class="flex items-center gap-1.5">
            <h1 class="text-xs font-bold text-text capitalize truncate leading-tight">
              {formattedPeriodTitle}
            </h1>
            <span class="text-[9px] px-1.5 py-0.2 rounded-full bg-primary/20 text-primary font-bold shrink-0 border border-primary/30">
              S{academicWeekNumber}
            </span>
          </div>
          <span class="text-[10px] text-text-muted font-medium">
            {#if isCurrentPeriod}
              {isAfter18h30() ? 'Demain (cours finis)' : 'Aujourd\'hui'}
            {:else}
              Revenir à {isAfter18h30() ? 'demain' : 'aujourd\'hui'}
            {/if}
          </span>
        </button>
      </div>

      <!-- Right: Action Icons (Search, Filter, Sync) -->
      <div class="flex items-center gap-1 shrink-0">
        <button
          onclick={() => showMobileSearch = !showMobileSearch}
          class="p-2 rounded-xl border transition-all active:scale-95 {showMobileSearch || calendarStore.searchQuery ? 'bg-primary text-white border-primary' : 'bg-surface-elevated/80 border-border text-text-muted hover:text-text'}"
          aria-label="Rechercher"
        >
          <Search size={15} />
        </button>

        <button
          onclick={() => showMobileFilterMenu = !showMobileFilterMenu}
          class="p-2 rounded-xl border transition-all active:scale-95 {selectedFilter !== 'ALL' ? 'bg-primary text-white border-primary' : 'bg-surface-elevated/80 border-border text-text-muted hover:text-text'}"
          aria-label="Filtrer"
        >
          <SlidersHorizontal size={15} />
        </button>

        <button
          onclick={() => calendarStore.syncEvents()}
          disabled={calendarStore.loading}
          class="p-2 rounded-xl bg-surface-elevated/80 border border-border text-text-muted hover:text-text transition-all active:scale-95 disabled:opacity-50"
          aria-label="Synchroniser"
        >
          <RefreshCw size={15} class={calendarStore.loading ? 'animate-spin text-primary' : ''} />
        </button>
      </div>
    </header>

    <!-- Mobile Search Bar (Collapsible) -->
    {#if showMobileSearch}
      <div class="p-2.5 border-b border-border bg-surface flex items-center gap-2 shrink-0 animate-in slide-in-from-top duration-150">
        <div class="relative flex-1 flex items-center">
          <Search size={14} class="absolute left-3 text-text-faint" />
          <input
            type="text"
            bind:value={calendarStore.searchQuery}
            placeholder="Rechercher cours, salle, prof..."
            class="w-full h-9 pl-9 pr-8 text-xs bg-surface-elevated border border-border rounded-xl focus:outline-none focus:border-primary text-text placeholder:text-text-faint"
          />
          {#if calendarStore.searchQuery}
            <button
              onclick={() => calendarStore.searchQuery = ''}
              class="absolute right-2 p-1 text-text-faint hover:text-text"
            >
              <X size={14} />
            </button>
          {/if}
        </div>
        <button
          onclick={() => { showMobileSearch = false; }}
          class="text-xs font-semibold text-text-muted px-2 py-1"
        >
          Annuler
        </button>
      </div>
    {/if}

    <!-- Mobile Filter Chips Bar (Collapsible or Filter Menu) -->
    {#if showMobileFilterMenu}
      <div class="px-3 py-2 border-b border-border bg-surface/80 flex items-center gap-1.5 overflow-x-auto shrink-0 animate-in slide-in-from-top duration-150">
        <span class="text-[10px] font-bold text-text-faint uppercase tracking-wider mr-1 shrink-0">Filtre:</span>
        {#each ['ALL', 'CM', 'TD', 'TP', 'EXAM'] as filterKey}
          <button
            onclick={() => { selectedFilter = filterKey as any; }}
            class="px-3 py-1 text-xs font-semibold rounded-lg shrink-0 transition-all {selectedFilter === filterKey ? 'bg-primary text-white shadow-sm' : 'bg-surface-elevated border border-border text-text-muted'}"
          >
            {filterKey === 'ALL' ? 'Tous' : filterKey === 'EXAM' ? 'DS' : filterKey}
          </button>
        {/each}
      </div>
    {/if}

    <!-- Mobile Day Strip Selector (Barre des jours) for Day view -->
    {#if view === 'day'}
      <div class="flex items-center justify-between px-2 py-1.5 border-b border-border/50 bg-surface/80 backdrop-blur-md shrink-0">
        {#each weekDays as day}
          {@const isSelected = isSameDay(day, currentDate)}
          {@const isToday = isSameDay(day, new Date())}
          {@const count = getEventsCountForDay(day)}
          <button
            type="button"
            onclick={() => { triggerHaptic(); currentDate = day; }}
            class="flex flex-col items-center py-1 px-1.5 rounded-xl transition-all flex-1 mx-0.5 {isSelected ? 'bg-primary text-white shadow-md shadow-primary/30' : isToday ? 'bg-primary/15 text-primary border border-primary/40 font-bold' : 'hover:bg-surface text-text-muted'}"
          >
            <span class="text-[10px] font-bold uppercase tracking-wider {isSelected ? 'text-white' : isToday ? 'text-primary font-extrabold' : 'text-text-muted'}">
              {format(day, 'EEE', { locale: fr })}
            </span>
            <span class="text-xs font-bold mt-0.5 {isSelected ? 'text-white' : isToday ? 'text-primary font-black' : 'text-text'}">
              {format(day, 'd')}
            </span>
            {#if count > 0}
              <div class="w-1.5 h-1.5 rounded-full mt-1 {isSelected ? 'bg-white' : isToday ? 'bg-primary' : 'bg-text-muted'}"></div>
            {:else}
              <div class="w-1.5 h-1.5 mt-1"></div>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- ================= MAIN VIEWPORT CONTENT ================= -->
  <div class="flex-1 flex flex-col overflow-hidden relative">
    <!-- Global Error Notification Banner (Always visible in all views) -->
    {#if calendarStore.error}
      <div class="absolute top-2 left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md z-50 bg-rose-950/95 border border-rose-500/60 text-rose-200 px-3.5 py-2.5 rounded-xl shadow-2xl flex items-center justify-between gap-2 backdrop-blur-md text-xs animate-in slide-in-from-top-2 duration-150">
        <div class="flex items-center gap-2 min-w-0">
          <AlertCircle size={15} class="text-rose-400 shrink-0" />
          <span class="truncate">{calendarStore.error}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            onclick={() => { icsUrlInput = calendarStore.preferences.url; showSettings = true; }}
            class="underline font-semibold text-rose-300 hover:text-white text-[11px]"
          >
            Options
          </button>
          <button
            onclick={() => { calendarStore.error = null; }}
            class="text-rose-400 hover:text-white p-0.5"
            aria-label="Fermer"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    {/if}

    {#if view === 'agenda'}
      <!-- ================= AGENDA / LIST VIEW (Mobile & Tablet favorite!) ================= -->
      <div class="flex-1 overflow-y-auto px-3 py-3 space-y-4 touch-scroll">
        {#if calendarStore.events.length === 0 && !calendarStore.loading}
          <!-- Empty State -->
          <div class="p-8 text-center text-text-muted">
            <Calendar size={32} class="mx-auto text-primary mb-2 opacity-50" />
            <p class="text-sm font-semibold">Aucun cours disponible</p>
            <p class="text-xs text-text-faint mt-1">Configurez votre lien iCalendar dans les Paramètres.</p>
          </div>
        {:else}
          {#each agendaDays as dayGroup}
            <div class="space-y-2">
              <!-- Day Header -->
              <div class="sticky top-0 z-20 py-1.5 bg-background/95 backdrop-blur-md flex items-center justify-between border-b border-border/60">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-extrabold uppercase tracking-wider capitalize {dayGroup.isToday ? 'text-primary' : 'text-text'}">
                    {format(dayGroup.date, 'EEEE d MMMM', { locale: fr })}
                  </span>
                  {#if dayGroup.isToday}
                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary font-bold border border-primary/30">
                      Aujourd'hui
                    </span>
                  {/if}
                </div>
                <span class="text-[11px] font-semibold text-text-muted">
                  {dayGroup.events.length} cours
                </span>
              </div>

              <!-- Day's events -->
              {#if dayGroup.events.length === 0}
                <div class="p-3 rounded-xl bg-surface/30 border border-border/30 text-center text-xs text-text-faint">
                  Aucun cours prévu
                </div>
              {:else}
                <div class="space-y-2">
                  {#each dayGroup.events as event (event.id)}
                    {@const customColor = calendarStore.preferences.colors[event.title]}
                    {@const theme = getEventTheme(event.title, customColor)}
                    {@const duration = differenceInMinutes(event.end, event.start)}

                    <button
                      type="button"
                      onclick={() => { triggerHaptic(); calendarStore.selectedEvent = event; }}
                      class="w-full text-left p-3 rounded-2xl border transition-all active:scale-[0.99] flex flex-col gap-2 relative overflow-hidden backdrop-blur-md shadow-sm"
                      style="background-color: {theme.bg}; border-color: {theme.border}; border-left-width: 5px; border-left-color: {theme.accent};"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-1.5 flex-wrap">
                          <span
                            class="text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider"
                            style="background-color: {theme.badgeBg}; color: #ffffff;"
                          >
                            {event.type}
                          </span>
                          {#if event.code}
                            <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/40 text-white/90 border border-white/10">
                              {event.code}
                            </span>
                          {/if}
                          {#if event.group}
                            <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/10 text-white/80">
                              {event.group}
                            </span>
                          {/if}
                        </div>

                        <!-- Time & Duration -->
                        <div class="flex items-center gap-1 text-[11px] font-mono font-bold text-white shrink-0">
                          <Clock size={11} class="text-white/80" />
                          <span>{format(event.start, 'HH:mm')} - {format(event.end, 'HH:mm')}</span>
                          <span class="text-[10px] text-white/70 font-normal">({duration}m)</span>
                        </div>
                      </div>

                      <!-- Title -->
                      <h3 class="text-sm font-bold text-white leading-snug break-words">
                        {event.title}
                      </h3>

                      <!-- Bottom info (Room & Teacher) -->
                      <div class="flex items-center justify-between text-xs text-white/90 pt-1 border-t border-white/10">
                        <div class="flex items-center gap-1.5 font-bold bg-black/40 px-2 py-0.5 rounded-lg border border-white/10">
                          <MapPin size={12} class="text-white/80" />
                          <span>{event.location}</span>
                        </div>

                        {#if calendarStore.preferences.notes[event.id]}
                          <div class="flex items-center gap-1 text-amber-300 text-[11px] font-medium">
                            <FileText size={12} />
                            <span>Note</span>
                          </div>
                        {:else if event.teacher && event.teacher !== 'Non spécifié'}
                          <div class="flex items-center gap-1 text-white/75 text-[11px]">
                            <User size={11} />
                            <span class="truncate max-w-[140px]">{event.teacher}</span>
                          </div>
                        {/if}
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <!-- ================= TIMETABLE GRID (Day or Week) ================= -->
      <div class="flex-1 overflow-y-auto overflow-x-auto relative flex flex-col touch-scroll">
        <!-- Sticky Day Headers Row -->
        <div class="h-11 flex border-b border-border/50 sticky top-0 bg-background/95 backdrop-blur-md z-30 {view === 'week' && isMobile ? 'min-w-[650px]' : ''}">
          <!-- Spacer above time column -->
          <div class="{isMobile ? 'w-12' : 'w-14'} shrink-0 border-r border-border/40 flex items-center justify-center text-[10px] font-mono text-text-faint/70 select-none">
          </div>

          {#each daysToShow as day}
            {@const isToday = isSameDay(day, new Date())}
            {@const count = getEventsCountForDay(day)}
            <div class="flex-1 border-r border-border/40 px-2 flex items-center justify-between transition-colors {isToday ? 'bg-primary/10 border-b-2 border-b-primary' : ''}">
              <div class="flex items-center gap-1.5">
                <span class="text-[11px] uppercase tracking-wider {isToday ? 'font-extrabold text-primary' : 'font-semibold text-text-muted'}">
                  {format(day, 'EEE', { locale: fr })}
                </span>
                <span class="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold transition-all {isToday ? 'bg-primary text-white shadow-sm' : 'bg-surface text-text border border-border/50'}">
                  {format(day, 'd')}
                </span>
              </div>
              {#if count > 0}
                <span class="text-[10px] font-semibold px-1.5 py-0.2 rounded-full {isToday ? 'bg-primary/20 text-primary font-bold' : 'bg-surface-elevated text-text-muted border border-border/50'}">
                  {count}
                </span>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Main Grid Body with Exact Pixel Height -->
        <div class="flex relative {view === 'week' && isMobile ? 'min-w-[650px]' : ''}" style="height: {totalGridHeight}px;">
          <!-- Time Numbers Column -->
          <div class="{isMobile ? 'w-12' : 'w-14'} shrink-0 border-r border-border/40 relative select-none bg-background/50">
            {#each hours as hour, i}
              <div
                class="absolute w-full flex justify-end pr-2 text-[10px] sm:text-[11px] font-mono text-text-muted {i === 0 ? 'top-0.5' : '-translate-y-1/2'}"
                style="{i === 0 ? '' : `top: ${i * HOUR_HEIGHT}px;`}"
              >
                {hour.toString().padStart(2, '0')}:00
              </div>
            {/each}
          </div>

          <!-- Day Columns Canvas Area -->
          <div class="flex-1 flex relative">

            <!-- Zero Events Onboarding Screen (Direct Setup) -->
            {#if calendarStore.events.length === 0 && !calendarStore.loading}
              <div class="absolute inset-0 flex flex-col items-center justify-center p-4 sm:p-6 text-center z-30">
                <div class="max-w-md w-full bg-surface-elevated/90 border border-border p-5 sm:p-6 rounded-2xl shadow-2xl backdrop-blur-md">
                  <div class="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/25 flex items-center justify-center mx-auto mb-3 shadow-sm text-primary">
                    <Calendar size={22} />
                  </div>
                  <h2 class="text-base font-bold text-text mb-1">
                    Synchronisez votre Emploi du Temps
                  </h2>
                  <p class="text-xs text-text-muted mb-4 leading-relaxed">
                    Collez le lien de votre calendrier iCalendar (.ics ou webcal://) délivré par votre université (ADE Campus, Celcat, ENT...).
                  </p>

                  <div class="space-y-3">
                    <input
                      type="text"
                      bind:value={icsUrlInput}
                      placeholder="https://ade.univ.fr/.../anonymous_cal.jsp?..."
                      class="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-xs text-text font-mono focus:outline-none focus:border-primary transition-all placeholder:text-text-faint"
                    />

                    <button
                      onclick={() => { calendarStore.setUrl(icsUrlInput); }}
                      disabled={!icsUrlInput.trim() || calendarStore.loading}
                      class="w-full py-2.5 rounded-xl text-xs font-semibold bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw size={13} class={calendarStore.loading ? 'animate-spin' : ''} />
                      <span>{calendarStore.loading ? 'Synchronisation en cours...' : 'Charger mon planning'}</span>
                    </button>

                    <div class="relative flex py-1 items-center">
                      <div class="flex-grow border-t border-border/50"></div>
                      <span class="flex-shrink mx-2 text-[10px] text-text-faint uppercase tracking-wider font-semibold">ou</span>
                      <div class="flex-grow border-t border-border/50"></div>
                    </div>

                    <input
                      id="onboard-ics-file"
                      type="file"
                      accept=".ics,text/calendar"
                      class="hidden"
                      onchange={handleFileUpload}
                    />
                    <button
                      type="button"
                      onclick={() => document.getElementById('onboard-ics-file')?.click()}
                      class="w-full py-2.5 rounded-xl text-xs font-semibold bg-surface border border-border hover:bg-surface/80 text-text transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                    >
                      <Upload size={13} class="text-primary" />
                      <span>Importer un fichier .ics</span>
                    </button>
                  </div>
                </div>
              </div>
            {/if}

            <!-- Empty Week Notification -->
            {#if calendarStore.events.length > 0 && currentWeekEventsCount === 0 && !calendarStore.loading}
              <div class="absolute inset-0 flex flex-col items-center justify-center p-6 text-center pointer-events-none z-20">
                <div class="bg-surface-elevated/90 border border-border p-5 rounded-2xl shadow-xl backdrop-blur-md pointer-events-auto max-w-sm">
                  <Calendar size={20} class="mx-auto text-primary mb-2" />
                  <h3 class="text-sm font-bold text-text mb-1">Aucun cours cette semaine</h3>
                  <p class="text-xs text-text-muted mb-3">
                    Vous n'avez aucun cours programmé pour cette semaine spécifique.
                  </p>
                  {#if nearestEventWeek}
                    <button
                      onclick={jumpToNearestWeek}
                      class="px-4 py-2 rounded-xl text-xs font-semibold bg-primary hover:bg-primary/90 text-white shadow-md shadow-primary/20 transition-all flex items-center justify-center gap-1.5 mx-auto active:scale-95"
                    >
                      <span>Aller au {format(nearestEventWeek, 'd MMMM yyyy', { locale: fr })}</span>
                      <ArrowRight size={13} />
                    </button>
                  {/if}
                </div>
              </div>
            {/if}

            <!-- Horizontal Grid Lines -->
            <div class="absolute inset-0 pointer-events-none">
              {#each hours as _, i}
                <div
                  class="absolute w-full border-t border-border/25"
                  style="top: {i * HOUR_HEIGHT}px;"
                ></div>
                {#if i < hours.length - 1}
                  <div
                    class="absolute w-full border-t border-dashed border-border/10"
                    style="top: {(i + 0.5) * HOUR_HEIGHT}px;"
                  ></div>
                {/if}
              {/each}
            </div>

            <!-- Day Columns with Cards -->
            {#each daysToShow as day}
              {@const isToday = isSameDay(day, new Date())}
              {@const dayEvents = getFilteredEventsForDay(day)}

              <div class="flex-1 border-r border-border/40 relative {isToday ? 'bg-primary/[0.02]' : ''}">
                <!-- Realtime Time Indicator Line -->
                {#if isToday}
                  <div
                    class="absolute left-0 right-0 z-30 pointer-events-none flex items-center -translate-y-1/2"
                    style="top: {currentTimePositionPx}px;"
                  >
                    <div class="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-md shadow-rose-500/80 -ml-1.25 flex items-center justify-center">
                      <div class="w-1 h-1 rounded-full bg-white"></div>
                    </div>
                    <div class="flex-1 h-[2px] bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]"></div>
                  </div>
                {/if}

                <!-- Event Cards -->
                {#each dayEvents as event (event.id)}
                  {@const layout = calculateCardStyle(event)}

                  <button
                    type="button"
                    onclick={() => { triggerHaptic(); calendarStore.selectedEvent = event; }}
                    class="absolute rounded-xl p-2 text-left overflow-hidden transition-all duration-150 border cursor-pointer group shadow-sm flex flex-col justify-between hover:scale-[1.01] active:scale-[0.98] hover:shadow-xl hover:z-40 backdrop-blur-md"
                    style="{layout.styleString} border-left-width: 4px;"
                    title="{event.title} ({format(event.start, 'HH:mm')} - {format(event.end, 'HH:mm')})"
                  >
                    <!-- Top Meta: Code, Type & Time -->
                    <div class="min-h-0">
                      <div class="flex items-center justify-between gap-1 mb-0.5">
                        <div class="flex items-center gap-1 overflow-hidden shrink min-w-0">
                          <span
                            class="text-[9px] font-bold px-1.5 py-0.2 rounded uppercase tracking-wider shrink-0"
                            style="background-color: {layout.theme.badgeBg}; color: #ffffff;"
                          >
                            {event.type}
                          </span>
                          {#if event.code}
                            <span class="text-[9px] font-mono font-bold px-1 py-0.2 rounded bg-black/40 text-white/90 border border-white/10 truncate">
                              {event.code}
                            </span>
                          {/if}
                          {#if event.group && !layout.isCompact}
                            <span class="text-[9px] font-semibold px-1 py-0.2 rounded bg-white/10 text-white/80 truncate">
                              {event.group}
                            </span>
                          {/if}
                        </div>
                        <span class="text-[10px] font-mono text-white/95 shrink-0 font-bold drop-shadow-sm ml-auto">
                          {format(event.start, 'HH:mm')}
                        </span>
                      </div>

                      <!-- Course Title -->
                      <h3 class="text-xs font-bold text-white leading-snug line-clamp-2 tracking-tight drop-shadow-sm break-words">
                        {event.title}
                      </h3>
                    </div>

                    <!-- Bottom Meta: Room & Teacher -->
                    <div class="pt-1 mt-0.5 border-t border-white/10 flex items-center justify-between text-[10px] text-white/90 gap-1 shrink-0">
                      <div class="flex items-center gap-1 font-semibold truncate bg-black/40 px-1.5 py-0.5 rounded border border-white/10 shadow-sm max-w-[70%]">
                        <MapPin size={10} class="shrink-0 text-white/80" />
                        <span class="truncate">{event.location}</span>
                      </div>

                      {#if calendarStore.preferences.notes[event.id]}
                        <FileText size={11} class="text-amber-300 shrink-0" />
                      {:else if event.teacher && event.teacher !== 'Non spécifié' && !layout.isCompact}
                        <div class="flex items-center gap-1 text-white/70 truncate max-w-[45%] text-[9px]">
                          <User size={9} class="shrink-0" />
                          <span class="truncate">{event.teacher}</span>
                        </div>
                      {/if}
                    </div>
                  </button>
                {/each}
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <!-- ================= FLOATING ACTION BUTTON (FAB) "Aujourd'hui" ================= -->
    {#if isMobile && !isCurrentPeriod}
      <button
        onclick={goToday}
        class="fixed bottom-20 right-4 z-40 bg-primary text-white shadow-xl shadow-primary/30 px-3.5 py-2.5 rounded-full flex items-center gap-2 text-xs font-bold transition-all active:scale-95 animate-in slide-in-from-bottom duration-200"
      >
        <Calendar size={15} />
        <span>Aujourd'hui</span>
      </button>
    {/if}

    <!-- ================= COURSE INSPECTOR: DESKTOP SIDEBAR ================= -->
    {#if !isMobile && calendarStore.selectedEvent}
      {@const ev = calendarStore.selectedEvent}
      {@const customColor = calendarStore.preferences.colors[ev.title]}
      {@const theme = getEventTheme(ev.title, customColor)}

      <aside class="w-80 border-l border-border glass-elevated flex flex-col z-40 shadow-2xl animate-in slide-in-from-right duration-200">
        <div class="p-4 border-b border-border flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span
              class="text-xs font-bold px-2 py-0.5 rounded-md"
              style="background-color: {theme.badgeBg}; color: #ffffff;"
            >
              {ev.type}
            </span>
            {#if ev.code}
              <span class="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-surface border border-border text-text">
                {ev.code}
              </span>
            {/if}
          </div>
          <button
            onclick={() => calendarStore.selectedEvent = null}
            class="p-1 rounded-lg text-text-muted hover:text-text hover:bg-surface transition-all"
            title="Fermer (Échap)"
          >
            <X size={16} />
          </button>
        </div>

        <div class="p-4 flex-1 overflow-y-auto space-y-4 text-xs">
          <div>
            <h2 class="text-base font-bold text-text leading-snug tracking-tight">
              {ev.title}
            </h2>
            {#if ev.rawTitle !== ev.title}
              <p class="text-[11px] text-text-faint mt-1 font-mono break-all bg-surface/50 p-1.5 rounded-lg border border-border/40">
                ADE: {ev.rawTitle}
              </p>
            {/if}
          </div>

          <!-- Date & Time Slot -->
          <div class="p-3 rounded-xl bg-surface border border-border flex items-start gap-3">
            <Clock size={16} class="text-primary mt-0.5 shrink-0" />
            <div>
              <p class="font-bold text-text capitalize">
                {format(ev.start, 'EEEE d MMMM yyyy', { locale: fr })}
              </p>
              <p class="text-text-muted mt-0.5 font-mono">
                {format(ev.start, 'HH:mm')} - {format(ev.end, 'HH:mm')}
                <span class="text-text-faint">({differenceInMinutes(ev.end, ev.start)} min)</span>
              </p>
            </div>
          </div>

          <!-- Room / Salle Card -->
          <div class="p-3 rounded-xl bg-surface border border-border flex items-start justify-between gap-2">
            <div class="flex items-start gap-3">
              <MapPin size={16} class="text-rose-500 mt-0.5 shrink-0" />
              <div>
                <p class="text-[10px] text-text-muted font-bold uppercase tracking-wider">Salle de cours</p>
                <p class="text-xs font-bold text-text mt-0.5">{ev.location}</p>
              </div>
            </div>
            <button
              onclick={() => copyRoomToClipboard(ev.location)}
              class="px-2 py-1 rounded-lg bg-surface-elevated hover:bg-border text-text-muted hover:text-text transition-all flex items-center gap-1 text-[11px] font-semibold border border-border shadow-sm active:scale-95"
              title="Copier la salle"
            >
              {#if copiedRoom}
                <Check size={12} class="text-emerald-500" />
                <span class="text-emerald-500">Copié</span>
              {:else}
                <Copy size={12} />
                <span>Copier</span>
              {/if}
            </button>
          </div>

          <!-- Teacher Card -->
          {#if ev.teacher && ev.teacher !== 'Non spécifié'}
            <div class="p-3 rounded-xl bg-surface border border-border flex items-start gap-3">
              <User size={16} class="text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <p class="text-[10px] text-text-muted font-bold uppercase tracking-wider">Enseignant</p>
                <p class="font-semibold text-text mt-0.5">{ev.teacher}</p>
              </div>
            </div>
          {/if}

          <!-- Group Card -->
          {#if ev.group}
            <div class="p-3 rounded-xl bg-surface border border-border flex items-start gap-3">
              <Sparkles size={16} class="text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p class="text-[10px] text-text-muted font-bold uppercase tracking-wider">Groupe</p>
                <p class="font-semibold text-text mt-0.5">{ev.group}</p>
              </div>
            </div>
          {/if}

          <!-- Subject Color Overwrite -->
          <div class="p-3 rounded-xl bg-surface border border-border space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-text-muted flex items-center gap-1.5">
                <Palette size={13} /> Couleur de la matière
              </span>
              <div class="w-3.5 h-3.5 rounded-full border border-white/20 shadow-sm" style="background-color: {theme.accent};"></div>
            </div>
            <div class="flex items-center gap-1.5 flex-wrap pt-1">
              {#each MODERN_PALETTES as color}
                <button
                  type="button"
                  onclick={() => calendarStore.setSubjectColor(ev.title, color)}
                  class="w-6 h-6 rounded-lg transition-transform hover:scale-110 flex items-center justify-center shadow-sm {theme.accent === color ? 'ring-2 ring-white ring-offset-2 ring-offset-background' : ''}"
                  style="background-color: {color};"
                  aria-label="Choisir couleur"
                >
                  {#if theme.accent === color}
                    <Check size={11} class="text-white" />
                  {/if}
                </button>
              {/each}
            </div>
          </div>

          <!-- Personal Student Notes -->
          <div class="space-y-1.5">
            <label for="event-notes-input" class="font-semibold text-text-muted flex items-center gap-1.5">
              <FileText size={13} /> Notes personnelles (devoirs, examens...)
            </label>
            <textarea
              id="event-notes-input"
              rows={3}
              value={calendarStore.preferences.notes[ev.id] || ''}
              oninput={(e) => calendarStore.setEventNote(ev.id, e.currentTarget.value)}
              placeholder="Ex: Rendre le TP noté, préparer l'exercice 3..."
              class="w-full p-2.5 bg-surface border border-border rounded-xl focus:outline-none focus:border-primary transition-all resize-none placeholder:text-text-faint text-xs"
            ></textarea>
          </div>

          <!-- Raw University Data -->
          {#if ev.description}
            <details class="bg-surface/50 border border-border rounded-xl p-2.5 text-text-muted">
              <summary class="cursor-pointer font-medium hover:text-text select-none text-[11px]">
                Données brutes de l'export ENT
              </summary>
              <pre class="mt-2 text-[10px] font-mono text-text-faint whitespace-pre-wrap break-all bg-background p-2 rounded-lg border border-border/40">
                {ev.description}
              </pre>
            </details>
          {/if}
        </div>
      </aside>
    {/if}

    <!-- ================= COURSE INSPECTOR: ANDROID BOTTOM SHEET ================= -->
    {#if isMobile && calendarStore.selectedEvent}
      {@const ev = calendarStore.selectedEvent}
      {@const customColor = calendarStore.preferences.colors[ev.title]}
      {@const theme = getEventTheme(ev.title, customColor)}

      <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
        <button
          type="button"
          class="flex-1 w-full cursor-default"
          onclick={() => calendarStore.selectedEvent = null}
          aria-label="Fermer"
        ></button>

        <div class="bg-surface-elevated border-t border-border rounded-t-3xl max-h-[85vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-200 pb-safe">
          <!-- Drag Handle Bar -->
          <div class="w-full flex justify-center pt-3 pb-1">
            <div class="w-12 h-1.5 rounded-full bg-border"></div>
          </div>

          <!-- Header -->
          <div class="px-5 py-2.5 border-b border-border flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span
                class="text-xs font-bold px-2 py-0.5 rounded-md"
                style="background-color: {theme.badgeBg}; color: #ffffff;"
              >
                {ev.type}
              </span>
              {#if ev.code}
                <span class="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-surface border border-border text-text">
                  {ev.code}
                </span>
              {/if}
            </div>
            <button
              onclick={() => calendarStore.selectedEvent = null}
              class="p-1.5 rounded-xl text-text-muted hover:text-text hover:bg-surface transition-all active:scale-95"
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
          </div>

          <!-- Content -->
          <div class="p-5 overflow-y-auto space-y-4 text-xs">
            <div>
              <h2 class="text-lg font-bold text-text leading-snug tracking-tight">
                {ev.title}
              </h2>
            </div>

            <!-- Date & Time Slot -->
            <div class="p-3.5 rounded-2xl bg-surface border border-border flex items-start gap-3">
              <Clock size={18} class="text-primary mt-0.5 shrink-0" />
              <div>
                <p class="font-bold text-text capitalize text-sm">
                  {format(ev.start, 'EEEE d MMMM yyyy', { locale: fr })}
                </p>
                <p class="text-text-muted mt-0.5 font-mono text-xs">
                  {format(ev.start, 'HH:mm')} - {format(ev.end, 'HH:mm')}
                  <span class="text-text-faint">({differenceInMinutes(ev.end, ev.start)} min)</span>
                </p>
              </div>
            </div>

            <!-- Room / Salle Card with Big Copy Button -->
            <div class="p-3.5 rounded-2xl bg-surface border border-border flex items-center justify-between gap-2">
              <div class="flex items-center gap-3">
                <MapPin size={18} class="text-rose-500 shrink-0" />
                <div>
                  <p class="text-[10px] text-text-muted font-bold uppercase tracking-wider">Salle</p>
                  <p class="text-sm font-bold text-text mt-0.5">{ev.location}</p>
                </div>
              </div>
              <button
                onclick={() => copyRoomToClipboard(ev.location)}
                class="px-3 py-1.5 rounded-xl bg-surface-elevated hover:bg-border text-text-muted hover:text-text transition-all flex items-center gap-1.5 text-xs font-semibold border border-border shadow-sm active:scale-95"
              >
                {#if copiedRoom}
                  <Check size={14} class="text-emerald-500" />
                  <span class="text-emerald-500">Copié</span>
                {:else}
                  <Copy size={14} />
                  <span>Copier</span>
                {/if}
              </button>
            </div>

            <!-- Teacher & Group Row -->
            <div class="grid grid-cols-2 gap-2">
              {#if ev.teacher && ev.teacher !== 'Non spécifié'}
                <div class="p-3 rounded-xl bg-surface border border-border flex items-center gap-2">
                  <User size={15} class="text-emerald-500 shrink-0" />
                  <div class="min-w-0">
                    <p class="text-[9px] text-text-muted font-bold uppercase">Enseignant</p>
                    <p class="font-semibold text-text text-xs truncate">{ev.teacher}</p>
                  </div>
                </div>
              {/if}
              {#if ev.group}
                <div class="p-3 rounded-xl bg-surface border border-border flex items-center gap-2">
                  <Sparkles size={15} class="text-amber-500 shrink-0" />
                  <div class="min-w-0">
                    <p class="text-[9px] text-text-muted font-bold uppercase">Groupe</p>
                    <p class="font-semibold text-text text-xs truncate">{ev.group}</p>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Subject Color Customizer -->
            <div class="p-3.5 rounded-2xl bg-surface border border-border space-y-2">
              <div class="flex items-center justify-between">
                <span class="font-semibold text-text flex items-center gap-1.5">
                  <Palette size={14} /> Couleur de la matière
                </span>
                <div class="w-4 h-4 rounded-full border border-white/20 shadow-sm" style="background-color: {theme.accent};"></div>
              </div>
              <div class="flex items-center gap-2 flex-wrap pt-1">
                {#each MODERN_PALETTES as color}
                  <button
                    type="button"
                    onclick={() => calendarStore.setSubjectColor(ev.title, color)}
                    class="w-7 h-7 rounded-xl transition-transform active:scale-110 flex items-center justify-center shadow-sm {theme.accent === color ? 'ring-2 ring-white ring-offset-2 ring-offset-background' : ''}"
                    style="background-color: {color};"
                    aria-label="Choisir couleur"
                  >
                    {#if theme.accent === color}
                      <Check size={13} class="text-white" />
                    {/if}
                  </button>
                {/each}
              </div>
            </div>

            <!-- Notes -->
            <div class="space-y-1.5">
              <label for="event-notes-input-mobile" class="font-semibold text-text flex items-center gap-1.5">
                <FileText size={14} /> Notes personnelles (devoirs, examens...)
              </label>
              <textarea
                id="event-notes-input-mobile"
                rows={3}
                value={calendarStore.preferences.notes[ev.id] || ''}
                oninput={(e) => calendarStore.setEventNote(ev.id, e.currentTarget.value)}
                placeholder="Ex: Rendre le TP noté, préparer l'exercice..."
                class="w-full p-3 bg-surface border border-border rounded-xl focus:outline-none focus:border-primary transition-all resize-none placeholder:text-text-faint text-xs"
              ></textarea>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- ================= ANDROID MOBILE BOTTOM NAVIGATION BAR ================= -->
  {#if isMobile}
    <nav class="h-16 border-t border-border bg-surface/90 backdrop-blur-md flex items-center justify-around px-2 shrink-0 z-30 pb-safe">
      <button
        onclick={() => { triggerHaptic(); view = 'day'; }}
        class="flex flex-col items-center justify-center flex-1 py-1 gap-1 transition-all active:scale-95 {view === 'day' ? 'text-primary' : 'text-text-muted hover:text-text'}"
      >
        <div class="px-3 py-1 rounded-full transition-all {view === 'day' ? 'bg-primary/15' : ''}">
          <Calendar size={18} />
        </div>
        <span class="text-[10px] font-semibold {view === 'day' ? 'text-primary font-bold' : ''}">Jour</span>
      </button>


      <button
        onclick={() => { triggerHaptic(); view = 'week'; }}
        class="flex flex-col items-center justify-center flex-1 py-1 gap-1 transition-all active:scale-95 {view === 'week' ? 'text-primary' : 'text-text-muted hover:text-text'}"
      >
        <div class="px-3 py-1 rounded-full transition-all {view === 'week' ? 'bg-primary/15' : ''}">
          <CalendarRange size={18} />
        </div>
        <span class="text-[10px] font-semibold {view === 'week' ? 'text-primary font-bold' : ''}">Semaine</span>
      </button>

      <button
        onclick={() => { triggerHaptic(); view = 'agenda'; }}
        class="flex flex-col items-center justify-center flex-1 py-1 gap-1 transition-all active:scale-95 {view === 'agenda' ? 'text-primary' : 'text-text-muted hover:text-text'}"
      >
        <div class="px-3 py-1 rounded-full transition-all {view === 'agenda' ? 'bg-primary/15' : ''}">
          <List size={18} />
        </div>
        <span class="text-[10px] font-semibold {view === 'agenda' ? 'text-primary font-bold' : ''}">Agenda</span>
      </button>

      <button
        onclick={() => { triggerHaptic(); icsUrlInput = calendarStore.preferences.url; showSettings = true; }}
        class="flex flex-col items-center justify-center flex-1 py-1 gap-1 transition-all active:scale-95 text-text-muted hover:text-text relative"
      >
        <div class="px-3 py-1 rounded-full relative">
          <Settings size={18} />
          {#if updateStatus?.available}
            <span class="absolute top-1 right-2 w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          {/if}
        </div>
        <span class="text-[10px] font-semibold flex items-center gap-0.5">
          <span>Options</span>
          {#if updateStatus?.available}
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          {/if}
        </span>
      </button>
    </nav>
  {/if}

  <!-- ================= SETTINGS MODAL / SHEET ================= -->
  {#if showSettings}
    <div class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div class="bg-surface-elevated border border-border rounded-t-3xl sm:rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col pb-safe">
        <!-- Header -->
        <div class="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div class="flex items-center gap-2">
            <Settings size={18} class="text-primary" />
            <h2 class="text-sm font-bold text-text">Paramètres de l'Emploi du Temps</h2>
          </div>
          <button
            onclick={() => showSettings = false}
            class="p-1 rounded-lg text-text-muted hover:text-text hover:bg-surface transition-all active:scale-95"
          >
            <X size={18} />
          </button>
        </div>

        <!-- Tabs -->
        <div class="flex border-b border-border bg-surface/50 px-5 pt-2 gap-3 text-xs font-semibold overflow-x-auto shrink-0">
          <button
            onclick={() => activeTab = 'feed'}
            class="pb-2.5 transition-all border-b-2 shrink-0 {activeTab === 'feed' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}"
          >
            Flux iCalendar
          </button>
          <button
            onclick={() => activeTab = 'appearance'}
            class="pb-2.5 transition-all border-b-2 shrink-0 {activeTab === 'appearance' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}"
          >
            Thème
          </button>
          <button
            onclick={() => activeTab = 'update'}
            class="pb-2.5 transition-all border-b-2 shrink-0 flex items-center gap-1.5 {activeTab === 'update' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}"
          >
            <Download size={13} />
            <span>Mise à jour</span>
            {#if updateStatus?.available}
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            {/if}
          </button>
          {#if !isMobile}
            <button
              onclick={() => activeTab = 'shortcuts'}
              class="pb-2.5 transition-all border-b-2 shrink-0 {activeTab === 'shortcuts' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}"
            >
              Raccourcis
            </button>
          {/if}
        </div>

        <!-- Body -->
        <div class="p-5 space-y-4 overflow-y-auto text-xs flex-1">
          {#if activeTab === 'feed'}
            <div class="space-y-3">
              <div>
                <label for="ics-feed-input" class="block font-semibold text-text mb-1">
                  URL d'exportation iCal (.ics ou webcal://)
                </label>
                <input
                  id="ics-feed-input"
                  type="text"
                  bind:value={icsUrlInput}
                  placeholder="https://ade.univ.fr/jsp/custom/modules/plannings/anonymous_cal.jsp?..."
                  class="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-xs text-text focus:outline-none focus:border-primary transition-all font-mono placeholder:text-text-faint"
                />
              </div>

              <div class="pt-1">
                <input
                  id="settings-ics-file"
                  type="file"
                  accept=".ics,text/calendar"
                  class="hidden"
                  onchange={handleFileUpload}
                />
                <button
                  type="button"
                  onclick={() => document.getElementById('settings-ics-file')?.click()}
                  class="w-full py-2.5 rounded-xl text-xs font-semibold bg-surface border border-border hover:bg-border/50 text-text transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95"
                >
                  <Upload size={13} class="text-primary" />
                  <span>Importer un fichier .ics depuis mon appareil</span>
                </button>
              </div>

              <!-- Guidance -->
              {#if showLyon1Help}
                <div class="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-left text-[11px] text-amber-200/90 space-y-1.5">
                  <div class="flex items-center gap-1.5 font-bold text-amber-300">
                    <Sparkles size={13} /> Obtenir le bon lien sur edt.univ-lyon1.fr :
                  </div>
                  <ol class="list-decimal list-inside space-y-1 text-text-muted leading-relaxed">
                    <li>Sur ADE Lyon 1, ouvrez le panneau <strong>« Options »</strong> (en bas à gauche).</li>
                    <li>Cliquez sur <strong>« Export Agenda... »</strong>.</li>
                    <li>Réglez la date de fin et cliquez sur <strong>« Générer URL »</strong>.</li>
                    <li>Copiez le lien (qui contient <code>anonymous_cal.jsp?projectId=1&resources=...</code>) et collez-le ci-dessus.</li>
                  </ol>
                </div>
              {:else}
                <button
                  type="button"
                  onclick={() => showLyon1Help = true}
                  class="text-[11px] text-primary hover:underline flex items-center gap-1"
                >
                  <Info size={12} /> Comment obtenir le bon lien sur ADE Campus / Lyon 1 ?
                </button>
              {/if}

              <div class="p-3 rounded-xl bg-surface border border-border/70 text-text-muted space-y-1">
                <div class="flex items-center gap-1.5 font-semibold text-text">
                  <Info size={13} class="text-primary" /> Sécurité & Synchronisation
                </div>
                <p class="text-[11px] leading-relaxed">
                  Le backend contourne automatiquement les blocages <strong>CORS</strong> d'ADE Campus, Celcat, et de vos serveurs ENT.
                </p>
              </div>

              {#if calendarStore.error}
                <div class="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 flex items-center gap-2">
                  <AlertCircle size={15} class="shrink-0 text-rose-400" />
                  <span>{calendarStore.error}</span>
                </div>
              {/if}

              {#if calendarStore.preferences.lastSync}
                <div class="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-2">
                  <Check size={14} class="text-emerald-400 shrink-0" />
                  <span>Dernière synchronisation réussie à {calendarStore.preferences.lastSync} ({calendarStore.events.length} cours).</span>
                </div>
              {/if}

              <!-- Application Version & Quick Update Button -->
              <div class="p-3 rounded-xl bg-surface border border-border/70 flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="font-bold text-text flex items-center gap-1.5 text-xs truncate">
                    <Sparkles size={13} class="text-primary shrink-0" />
                    <span>Application Calendar</span>
                    <span class="text-[10px] px-1.5 py-0.2 rounded-full bg-primary/15 text-primary font-mono font-bold shrink-0">v{APP_VERSION}</span>
                  </div>
                  <div class="text-[10px] text-text-muted mt-0.5 truncate">
                    {#if updateStatus?.available}
                      <span class="text-emerald-500 font-bold">Mise à jour v{updateStatus.latestVersion} disponible !</span>
                    {:else if updateCheckDone}
                      <span>Application à jour</span>
                    {:else}
                      <span>Dépôt GitHub BIBIdu39/calendar</span>
                    {/if}
                  </div>
                </div>
                <button
                  type="button"
                  onclick={() => activeTab = 'update'}
                  class="px-2.5 py-1.5 rounded-lg {updateStatus?.available ? 'bg-emerald-600 text-white font-bold' : 'bg-surface-elevated border border-border hover:bg-surface text-text font-semibold'} text-[11px] flex items-center gap-1 active:scale-95 transition-all shadow-sm shrink-0 cursor-pointer"
                >
                  <Download size={12} class={updateStatus?.available ? 'text-white' : 'text-primary'} />
                  <span>{updateStatus?.available ? 'Mettre à jour' : 'Mise à jour'}</span>
                </button>
              </div>
            </div>

          {:else if activeTab === 'appearance'}
            <div class="space-y-3">
              <span class="block font-semibold text-text">Thème visuel de l'interface</span>
              <div class="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onclick={() => calendarStore.setTheme('dark')}
                  class="p-3 rounded-xl border text-left transition-all active:scale-95 {calendarStore.preferences.theme === 'dark' ? 'border-primary bg-primary/10 text-white' : 'border-border bg-surface text-text-muted hover:border-text-faint'}"
                >
                  <div class="font-bold">Sombre Obsidian</div>
                  <div class="text-[10px] text-text-faint mt-0.5">Style Linear & Raycast</div>
                </button>
                <button
                  type="button"
                  onclick={() => calendarStore.setTheme('pitch')}
                  class="p-3 rounded-xl border text-left transition-all active:scale-95 {calendarStore.preferences.theme === 'pitch' ? 'border-primary bg-primary/10 text-white' : 'border-border bg-surface text-text-muted hover:border-text-faint'}"
                >
                  <div class="font-bold">Pitch Black (OLED)</div>
                  <div class="text-[10px] text-text-faint mt-0.5">Noir pur #000000</div>
                </button>
                <button
                  type="button"
                  onclick={() => calendarStore.setTheme('slate')}
                  class="p-3 rounded-xl border text-left transition-all active:scale-95 {calendarStore.preferences.theme === 'slate' ? 'border-primary bg-primary/10 text-white' : 'border-border bg-surface text-text-muted hover:border-text-faint'}"
                >
                  <div class="font-bold">Ardoise Slate</div>
                  <div class="text-[10px] text-text-faint mt-0.5">Teintes bleutées douces</div>
                </button>
                <button
                  type="button"
                  onclick={() => calendarStore.setTheme('light')}
                  class="p-3 rounded-xl border text-left transition-all active:scale-95 {calendarStore.preferences.theme === 'light' ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border bg-surface text-text-muted hover:border-text-faint'}"
                >
                  <div class="font-bold">Clair Épuré</div>
                  <div class="text-[10px] text-text-muted mt-0.5">Blanc minimaliste</div>
                </button>
              </div>
            </div>

          {:else if activeTab === 'update'}
            <div class="space-y-4">
              <!-- Version & Status Card -->
              <div class="p-4 rounded-2xl bg-surface border border-border space-y-3">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2.5">
                    <div class="w-9 h-9 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center text-primary shrink-0">
                      <Download size={18} />
                    </div>
                    <div>
                      <h3 class="font-bold text-text text-sm">Application Calendar</h3>
                      <p class="text-[11px] text-text-muted">Version installée : <strong>v{APP_VERSION}</strong></p>
                    </div>
                  </div>
                  <span class="text-[10px] px-2 py-0.5 rounded-full bg-surface-elevated border border-border text-text-muted font-mono font-bold shrink-0">
                    v{APP_VERSION}
                  </span>
                </div>

                <!-- Check button -->
                <button
                  type="button"
                  onclick={() => checkForAppUpdate(false)}
                  disabled={isCheckingUpdate}
                  class="w-full py-2.5 rounded-xl text-xs font-semibold bg-primary hover:bg-primary/90 text-white shadow-md shadow-primary/25 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw size={13} class={isCheckingUpdate ? 'animate-spin' : ''} />
                  <span>{isCheckingUpdate ? 'Vérification auprès de GitHub...' : 'Vérifier les mises à jour'}</span>
                </button>
              </div>

              <!-- Update result states -->
              {#if updateStatus?.available}
                <!-- UPDATE AVAILABLE -->
                <div class="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3 animate-in fade-in duration-200">
                  <div class="flex items-start gap-2.5">
                    <Sparkles size={18} class="text-emerald-400 shrink-0 mt-0.5" />
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <h4 class="font-bold text-emerald-300 text-xs">Nouvelle version disponible !</h4>
                        <span class="text-[10px] px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                          v{updateStatus.latestVersion}
                        </span>
                      </div>
                      <p class="text-[11px] text-emerald-200/80 mt-1 leading-relaxed">
                        Une version plus récente est prête à être installée sur votre téléphone.
                      </p>
                    </div>
                  </div>

                  {#if updateStatus.releaseNotes}
                    <div class="p-2.5 rounded-xl bg-black/20 text-[10px] text-emerald-200/90 font-mono whitespace-pre-wrap max-h-24 overflow-y-auto">
                      {updateStatus.releaseNotes}
                    </div>
                  {/if}

                  <button
                    type="button"
                    onclick={() => downloadAndInstallUpdate(updateStatus?.downloadUrl)}
                    class="w-full py-3 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
                  >
                    <Download size={15} />
                    <span>Télécharger et installer l'APK (v{updateStatus.latestVersion})</span>
                  </button>

                  <div class="text-[10px] text-emerald-300/80 text-center leading-normal">
                    💡 Après le téléchargement, appuyez sur « Ouvrir » ou « Mettre à jour » dans la notification Android.
                  </div>
                </div>
              {:else if updateCheckDone && !updateStatus?.available}
                <!-- ALREADY UP TO DATE -->
                <div class="p-4 rounded-2xl bg-surface border border-border text-center space-y-2 animate-in fade-in duration-200">
                  <div class="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                    <Check size={16} />
                  </div>
                  <div>
                    <p class="font-bold text-text text-xs">Votre application est à jour !</p>
                    <p class="text-[10px] text-text-muted mt-0.5">Vous utilisez la dernière version officielle (v{APP_VERSION}).</p>
                  </div>
                  <button
                    type="button"
                    onclick={() => downloadAndInstallUpdate()}
                    class="text-[11px] text-primary hover:underline font-medium pt-1 cursor-pointer"
                  >
                    Télécharger à nouveau l'APK
                  </button>
                </div>
              {:else if updateError}
                <!-- ERROR CHECKING -->
                <div class="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-2 text-xs">
                  <div class="flex items-center gap-2 text-rose-300 font-bold">
                    <AlertCircle size={15} class="text-rose-400" />
                    <span>Vérification impossible</span>
                  </div>
                  <p class="text-[11px] text-rose-200/80 leading-relaxed">{updateError}</p>
                  <button
                    type="button"
                    onclick={() => downloadAndInstallUpdate()}
                    class="underline text-[11px] text-rose-300 hover:text-white"
                  >
                    Télécharger l'APK directement depuis GitHub
                  </button>
                </div>
              {/if}

              <!-- GitHub Repo Info -->
              <div class="p-3 rounded-xl bg-surface/50 border border-border/50 text-[11px] text-text-muted flex items-center justify-between">
                <span>Dépôt officiel GitHub</span>
                <a
                  href="https://github.com/BIBIdu39/calendar"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-primary hover:underline font-mono text-[10px] flex items-center gap-1"
                >
                  <span>BIBIdu39/calendar</span>
                  <ExternalLink size={10} />
                </a>
              </div>
            </div>

          {:else if activeTab === 'shortcuts'}
            <div class="space-y-2">
              <div class="flex items-center justify-between p-2 rounded-lg bg-surface border border-border/40">
                <span class="text-text-muted">Semaine / Jour précédent ou suivant</span>
                <kbd class="px-2 py-0.5 bg-surface-elevated border border-border rounded font-mono text-[11px]">← / →</kbd>
              </div>
              <div class="flex items-center justify-between p-2 rounded-lg bg-surface border border-border/40">
                <span class="text-text-muted">Revenir à la journée actuelle</span>
                <kbd class="px-2 py-0.5 bg-surface-elevated border border-border rounded font-mono text-[11px]">T</kbd>
              </div>
              <div class="flex items-center justify-between p-2 rounded-lg bg-surface border border-border/40">
                <span class="text-text-muted">Forcer la synchronisation</span>
                <kbd class="px-2 py-0.5 bg-surface-elevated border border-border rounded font-mono text-[11px]">R</kbd>
              </div>
              <div class="flex items-center justify-between p-2 rounded-lg bg-surface border border-border/40">
                <span class="text-text-muted">Rechercher un cours / prof / salle</span>
                <kbd class="px-2 py-0.5 bg-surface-elevated border border-border rounded font-mono text-[11px]">Ctrl + F</kbd>
              </div>
              <div class="flex items-center justify-between p-2 rounded-lg bg-surface border border-border/40">
                <span class="text-text-muted">Fermer panneau ou modal</span>
                <kbd class="px-2 py-0.5 bg-surface-elevated border border-border rounded font-mono text-[11px]">Échap</kbd>
              </div>
            </div>
          {/if}
        </div>

        <!-- Footer -->
        <div class="px-5 py-3 border-t border-border flex items-center justify-end gap-2 bg-surface/30 shrink-0">
          <button
            onclick={() => showSettings = false}
            class="px-4 py-2 rounded-xl text-xs font-medium text-text-muted hover:text-text hover:bg-surface transition-all active:scale-95"
          >
            Fermer
          </button>
          {#if activeTab === 'feed'}
            <button
              onclick={() => { calendarStore.setUrl(icsUrlInput); showSettings = false; }}
              disabled={calendarStore.loading}
              class="px-4 py-2 rounded-xl text-xs font-semibold bg-primary hover:bg-primary/90 text-white shadow-md shadow-primary/20 transition-all flex items-center gap-1.5 active:scale-95"
            >
              <RefreshCw size={12} class={calendarStore.loading ? 'animate-spin' : ''} />
              <span>Enregistrer & Synchroniser</span>
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
