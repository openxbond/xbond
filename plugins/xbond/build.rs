const COMMANDS: &[&str] = &[
    "get_localapi_config",
    "startup_complete",
    "list_installed_apps",
    "get_split_tunnel_config",
    "set_split_tunnel_config",
    "check_for_updates",
    "get_preference",
    "set_preference",
    "sync_system_bars",
    "deliver_account_callback",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
    if target_os == "ios" {
        let target = std::env::var("TARGET").unwrap();
        let slice = if target == "aarch64-apple-ios" {
            "ios-arm64"
        } else {
            "ios-arm64_x86_64-simulator"
        };
        let plugin = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        println!("cargo:rerun-if-changed=ios/Frameworks/XBondMobile.xcframework");
        println!("cargo:rustc-link-search=framework={plugin}/ios/Frameworks/XBondMobile.xcframework/{slice}");
        println!("cargo:rustc-link-lib=framework=XBondMobile");
        println!("cargo:rustc-link-lib=resolv");
    }
    let mobile = target_os == "ios" || target_os == "android";
    alias("desktop", !mobile);
    alias("mobile", mobile);
}

// creates a cfg alias if `has_feature` is true.
// `alias` must be a snake case string.
fn alias(alias: &str, has_feature: bool) {
    println!("cargo:rustc-check-cfg=cfg({alias})");
    if has_feature {
        println!("cargo:rustc-cfg={alias}");
    }
}
