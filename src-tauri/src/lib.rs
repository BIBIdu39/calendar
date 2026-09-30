use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
async fn fetch_calendar(url: String) -> Result<String, String> {
    let mut clean_url = url.trim().trim_matches('"').trim_matches('\'').to_string();
    if clean_url.starts_with("webcal://") {
        clean_url = clean_url.replacen("webcal://", "https://", 1);
    } else if clean_url.starts_with("webcals://") {
        clean_url = clean_url.replacen("webcals://", "https://", 1);
    }

    if clean_url.is_empty() {
        return Err("Aucune URL configurée".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Erreur initialisation client réseau : {}", e))?;

    let resp = client
        .get(&clean_url)
        .header("Accept", "text/calendar, text/plain, */*")
        .send()
        .await
        .map_err(|e| format!("Impossible de joindre le serveur iCal : {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Le serveur a renvoyé un statut HTTP {}", resp.status()));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Erreur lors de la lecture des données : {}", e))?;

    if !text.to_uppercase().contains("BEGIN:VCALENDAR") {
        return Err("Le contenu reçu ne correspond pas à un calendrier iCalendar valide (vérifiez que l'URL est publique sans authentification interactive CAS/SSO)".to_string());
    }

    Ok(text)
}

#[tauri::command]
fn app_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn app_toggle_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn app_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<bool, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => {
            // Install the update and relaunch
            update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
            app.restart();
        }
        Ok(None) => return Ok(false),
        Err(e) => return Err(e.to_string()),
    }
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Check for updates silently at startup (release builds only)
      #[cfg(not(debug_assertions))]
      {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(updater) = handle.updater() {
                if let Ok(Some(update)) = updater.check().await {
                    let _ = update.download_and_install(|_, _| {}, || {}).await;
                    handle.restart();
                }
            }
        });
      }
      Ok(())
    })
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .invoke_handler(tauri::generate_handler![
        fetch_calendar,
        app_minimize,
        app_toggle_maximize,
        app_close,
        check_for_updates
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
