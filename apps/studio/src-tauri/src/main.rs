#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
fn is_wsl_environment(wsl_distro_name: Option<&str>, kernel_release: Option<&str>) -> bool {
    wsl_distro_name.is_some_and(|name| !name.trim().is_empty())
        || kernel_release.is_some_and(|release| release.to_ascii_lowercase().contains("microsoft"))
}

#[cfg(target_os = "linux")]
fn configure_wsl_webview_renderer() {
    let wsl_distro_name = std::env::var("WSL_DISTRO_NAME").ok();
    let kernel_release = std::fs::read_to_string("/proc/sys/kernel/osrelease").ok();

    if !is_wsl_environment(wsl_distro_name.as_deref(), kernel_release.as_deref())
        || std::env::var_os("LIBGL_ALWAYS_SOFTWARE").is_some()
    {
        return;
    }

    // WSLg can expose Mesa's Zink path without a selectable Vulkan device. WebKitGTK then
    // fails during EGL initialization before the Studio window is usable. This is called from
    // `main` before Tauri or WebKit starts any application threads, so mutating the process
    // environment here is safe. An explicit user value is always preserved above.
    unsafe {
        std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
    }

    eprintln!("Srijika Studio: WSL detected; using the compatible Mesa software renderer.");
}

fn main() {
    #[cfg(target_os = "linux")]
    configure_wsl_webview_renderer();

    srijika_studio_lib::run();
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::is_wsl_environment;

    #[test]
    fn detects_wsl_from_the_distribution_marker() {
        assert!(is_wsl_environment(Some("Ubuntu"), Some("6.8.0-generic")));
    }

    #[test]
    fn detects_wsl_from_the_microsoft_kernel_release() {
        assert!(is_wsl_environment(
            None,
            Some("6.6.87.2-microsoft-standard-WSL2")
        ));
        assert!(!is_wsl_environment(None, Some("6.8.0-generic")));
    }
}
