<script lang="ts">
	import '../app.css';
	import { calendarStore } from '$lib/store.svelte';
	import { onMount } from 'svelte';
	import { Minus, Square, X } from 'lucide-svelte';
	import { isTauri, invoke } from '@tauri-apps/api/core';

	let { children } = $props();
	let isMobile = $state(false);

	function checkMobile() {
		if (typeof window !== 'undefined') {
			const ua = navigator.userAgent.toLowerCase();
			const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
			const isSmallScreen = window.innerWidth < 768;
			isMobile = isMobileUA || isSmallScreen;
		}
	}

	function applyTheme(theme: string) {
		if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('data-theme', theme);
			const themeColors: Record<string, string> = {
				dark: '#09090b',
				pitch: '#000000',
				slate: '#0a0f1d',
				light: '#f8fafc'
			};
			const meta = document.getElementById('meta-theme-color');
			if (meta) {
				meta.setAttribute('content', themeColors[theme] || '#09090b');
			}
		}
	}

	onMount(() => {
		checkMobile();
		window.addEventListener('resize', checkMobile);

		calendarStore.loadPreferences().then(() => {
			if (calendarStore.preferences.url) {
				calendarStore.syncEvents();
			}
		});
		
		applyTheme(calendarStore.preferences.theme);

		return () => {
			window.removeEventListener('resize', checkMobile);
		};
	});

	$effect(() => {
		applyTheme(calendarStore.preferences.theme);
	});

	async function minimizeWindow() {
		if (isTauri()) {
			try {
				await invoke('app_minimize');
			} catch {
				const { getCurrentWindow } = await import('@tauri-apps/api/window');
				await getCurrentWindow().minimize();
			}
		}
	}

	async function toggleMaximizeWindow() {
		if (isTauri()) {
			try {
				await invoke('app_toggle_maximize');
			} catch {
				const { getCurrentWindow } = await import('@tauri-apps/api/window');
				await getCurrentWindow().toggleMaximize();
			}
		}
	}

	async function closeWindow() {
		if (isTauri()) {
			try {
				await invoke('app_close');
			} catch {
				const { getCurrentWindow } = await import('@tauri-apps/api/window');
				await getCurrentWindow().close();
			}
		}
	}
</script>

<div class="h-dvh w-screen flex flex-col select-none overflow-hidden bg-background">
	<!-- Custom Desktop Titlebar (Hidden on Mobile/Android) -->
	{#if !isMobile}
		<div class="h-9 flex items-center justify-between px-3 shrink-0 border-b border-border/50 bg-surface/80 backdrop-blur-md z-50">
			<div data-tauri-drag-region class="flex-1 h-full flex items-center gap-2 cursor-grab active:cursor-grabbing">
				<div class="w-2.5 h-2.5 rounded-full bg-primary shadow-sm shadow-primary/50"></div>
				<div class="text-xs font-semibold tracking-wide text-text/80">
					Calendar
				</div>
			</div>
			{#if isTauri()}
			<div class="flex items-center gap-1 z-10 shrink-0">
				<button 
					type="button"
					onclick={minimizeWindow} 
					class="h-7 w-8 inline-flex items-center justify-center rounded hover:bg-surface text-text/70 hover:text-text transition-colors cursor-pointer"
					title="Minimiser"
				>
					<Minus size={13} />
				</button>
				<button 
					type="button"
					onclick={toggleMaximizeWindow} 
					class="h-7 w-8 inline-flex items-center justify-center rounded hover:bg-surface text-text/70 hover:text-text transition-colors cursor-pointer"
					title="Agrandir / Restaurer"
				>
					<Square size={11} />
				</button>
				<button 
					type="button"
					onclick={closeWindow} 
					class="h-7 w-8 inline-flex items-center justify-center rounded hover:bg-rose-600 hover:text-white text-text/70 transition-colors cursor-pointer"
					title="Fermer"
				>
					<X size={13} />
				</button>
			</div>
			{/if}
		</div>
	{/if}

	<main class="flex-1 overflow-hidden relative flex flex-col {isMobile ? 'pt-safe' : ''}">
		{@render children()}
	</main>
</div>
