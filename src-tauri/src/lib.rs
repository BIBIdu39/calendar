#[tauri::command]
async fn fetch_calendar(url: String) -> Result<String, String> {
    let mut clean_url = url.trim().trim_matches('"').trim_matches('\'').to_string();
    if clean_url.starts_with("webcal://") {
        clean_url = clean_url.replacen("webcal://", "https://", 1);
    } else if clean_url.starts_with("webcals://") {
        clean_url = clean_url.replacen("webcals://", "https://", 1);
    }

    // Auto-resolve Lyon 1 portal URLs to direct working export feed
    if clean_url.contains("edt.univ-lyon1.fr") && (clean_url.contains("portal") || clean_url.contains("encryptedUrl") || !clean_url.contains("anonymous_cal.jsp")) {
        clean_url = "https://edt.univ-lyon1.fr/jsp/custom/modules/plannings/anonymous_cal.jsp?resources=47168,12102&projectId=1&calType=ical&firstDate=2026-08-18&lastDate=2027-08-01".to_string();
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
      Ok(())
    })
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .invoke_handler(tauri::generate_handler![
        fetch_calendar,
        app_minimize,
        app_toggle_maximize,
        app_close
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
