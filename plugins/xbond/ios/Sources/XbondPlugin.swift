import Foundation
import NetworkExtension
import Tauri
import UIKit
import UserNotifications
import WebKit
import XBondMobile

struct SyncSystemBarsArgs: Decodable {
  let isDark: Bool
  let color: String?
}

struct HapticArgs: Decodable {
  let kind: String
}

struct AccountCallbackArgs: Decodable {
  let code: String
  let state: String
}

struct TextFileArgs: Decodable {
  let contents: String
  let fileName: String
  let mimeType: String?
}

struct PreferenceKeyArgs: Decodable {
  let key: String
}

struct PreferenceSetArgs: Decodable {
  let key: String
  let value: String
}

/**
 * The platform surface the shared web UI consumes through the Tauri `xbond`
 * plugin: the loopback LocalAPI endpoint it drives the tunnel through,
 * OAuth callback delivery, system bar theming, and the `open-browser`
 * handoff the PacketTunnel extension uses (UIApplication is unavailable to
 * a Network Extension).
 *
 * Tunnel hosting mirrors the old dashboard view controller: while the VPN
 * is down the plugin runs an in-process TunnelService purely to host the
 * LocalAPI; while it is up the PacketTunnel extension answers the
 * `endpoint` provider message with {port, token}. The UI itself is served
 * by Tauri from the bundled assets and learns the endpoint through
 * getLocalAPIConfig, so no install/extract/load dance exists anymore.
 */
class XbondPlugin: Plugin {
  private let queue = DispatchQueue(label: "net.xbond.app.xbond")
  private var tunnelManager: NETunnelProviderManager?
  /// In-process TunnelService hosting the LocalAPI while the tunnel is down.
  private var service: MobileTunnelService?
  private var browserPoller: DispatchSourceTimer?

  override func load(webview: WKWebView) {
    super.load(webview: webview)
    // wry leaves the scroll view's contentInsetAdjustmentBehavior at the
    // .automatic default, so iOS subtracts the safe areas (59 top + 34
    // bottom) from the page's layout viewport even though the page asks for
    // viewport-fit=cover: window.innerHeight loses 93pt, fixed-position UI
    // hangs above the bottom edge, and the safe-area strips paint white.
    // The page owns the insets (env() reads them correctly), so drop the
    // automatic adjustment entirely.
    webview.scrollView.contentInsetAdjustmentBehavior = .never
    // wry snapshots the parent frame once at webview creation, which can run
    // before the final layout pass. Align to the window once attached and
    // let autoresizing follow later changes (rotation, scene transitions).
    webview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    alignWebviewToWindow(webview, attempts: 10)
    NETunnelProviderManager.loadAllFromPreferences { [weak self] managers, _ in
      DispatchQueue.main.async {
        guard let self else { return }
        self.tunnelManager = managers?.first(where: {
          ($0.protocolConfiguration as? NETunnelProviderProtocol)?
            .providerBundleIdentifier == MobileSupport.providerID
        }) ?? NETunnelProviderManager()
      }
    }
    startBrowserPolling()
  }

  /// Retries briefly on the main queue: plugin load can run before the
  /// webview joins a window, and a zero-sized window bound is worthless.
  private func alignWebviewToWindow(_ webview: WKWebView, attempts: Int) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if let window = webview.window, window.bounds.size.width > 0 {
        webview.frame = window.bounds
      } else if attempts > 0 {
        self.alignWebviewToWindow(webview, attempts: attempts - 1)
      }
    }
  }

  // MARK: - Commands

  /// Startup hand-off from the web UI: iOS has no holdable splash (the
  /// launch storyboard dismisses at first frame), so there is nothing to
  /// release — kept for a complete command face across both platforms.
  @objc public func startupComplete(_ invoke: Invoke) throws {
    invoke.resolve()
  }

  /// Loopback endpoint and token of the in-process LocalAPI; the UI boot
  /// retries while the freshly started service writes its address file.
  @objc public func getLocalAPIConfig(_ invoke: Invoke) throws {
    resolveEndpoint { endpoint in
      guard let endpoint else {
        invoke.reject("localapi endpoint not ready")
        return
      }
      invoke.resolve(["addr": "127.0.0.1:\(endpoint.port)", "token": endpoint.token])
    }
  }

  /// Delivers an OAuth code/state pair to the LocalAPI (worker queue, short
  /// retries through the cold-start race). Answers true once the daemon
  /// accepted the delivery; the frontend dispatches its
  /// `xbond-account-updated` event from that result.
  @objc public func deliverAccountCallback(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AccountCallbackArgs.self)
    Task { [weak self] in
      let delivered = await self?.deliverWithRetry(code: args.code, state: args.state) ?? false
      invoke.resolve(delivered)
    }
  }

  /// Theme sync: the UI reports its resolved scheme and surface color so
  /// the status bar and window background never render as a detached strip.
  @objc public func syncSystemBars(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SyncSystemBarsArgs.self)
    DispatchQueue.main.async {
      let style: UIUserInterfaceStyle = args.isDark ? .dark : .light
      let windows = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
      for window in windows where window.isKeyWindow {
        window.rootViewController?.overrideUserInterfaceStyle = style
        if let hex = args.color {
          window.backgroundColor = Self.parseColor(hex)
        }
      }
    }
    invoke.resolve()
  }

  /// Tactile feedback for key state changes (connection up/down,
  /// failures): tap→light impact, confirm→success notification,
  /// error→error notification. Resolves once queued; the web side
  /// fire-and-forgets and never awaits.
  @objc public func performHaptic(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(HapticArgs.self)
    DispatchQueue.main.async {
      switch args.kind {
      case "confirm":
        UINotificationFeedbackGenerator().notificationOccurred(.success)
      case "error":
        UINotificationFeedbackGenerator().notificationOccurred(.error)
      default:
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
      }
    }
    invoke.resolve()
  }

  /// Shares text content via the system share sheet.
  @objc public func shareTextFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(TextFileArgs.self)
    let safe = Self.safeFileName(args.fileName)
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
    try args.contents.write(to: url, atomically: true, encoding: .utf8)
    DispatchQueue.main.async {
      guard let presenter = Self.topViewController() else {
        invoke.reject("no presenter")
        return
      }
      let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
      vc.completionWithItemsHandler = { _, completed, _, _ in
        try? FileManager.default.removeItem(at: url)
        invoke.resolve(completed)
      }
      if let pop = vc.popoverPresentationController {
        pop.sourceView = presenter.view
        pop.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
        pop.permittedArrowDirections = []
      }
      presenter.present(vc, animated: true)
    }
  }

  /// Saves text content by presenting the document picker export flow.
  @objc public func saveTextFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(TextFileArgs.self)
    let safe = Self.safeFileName(args.fileName)
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
    try args.contents.write(to: url, atomically: true, encoding: .utf8)
    DispatchQueue.main.async {
      guard let presenter = Self.topViewController() else {
        invoke.reject("no presenter")
        return
      }
      let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
      let delegate = ExportPickerDelegate(url: url) { saved in
        invoke.resolve(saved)
      }
      picker.delegate = delegate
      // Keep delegate alive for the duration of the picker interaction.
      objc_setAssociatedObject(picker, &ExportPickerDelegate.associatedKey, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
      presenter.present(picker, animated: true)
    }
  }

  @objc public func getPreference(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PreferenceKeyArgs.self)
    if let value = UserDefaults.standard.string(forKey: args.key) {
      invoke.resolve(value)
    } else {
      invoke.resolve()
    }
  }

  @objc public func setPreference(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PreferenceSetArgs.self)
    UserDefaults.standard.set(args.value, forKey: args.key)
    if args.key == MobileSupport.appLanguageKey {
      UserDefaults(suiteName: MobileSupport.appGroup)?.set(args.value, forKey: MobileSupport.appLanguageKey)
    }
    invoke.resolve(true)
  }

  @objc public func getNotificationPermissionState(_ invoke: Invoke) throws {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      let state: String
      switch settings.authorizationStatus {
      case .authorized, .provisional, .ephemeral:
        state = "granted"
      case .denied:
        state = "denied"
      case .notDetermined:
        state = "prompt"
      @unknown default:
        state = "prompt"
      }
      invoke.resolve(state)
    }
  }

  @objc public func requestNotificationPermission(_ invoke: Invoke) throws {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
      invoke.resolve(granted)
    }
  }

  @objc public func openNotificationSettings(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      let target = UIApplication.openNotificationSettingsURLString
      guard let url = URL(string: target) else {
        invoke.resolve(false)
        return
      }
      UIApplication.shared.open(url) { opened in
        invoke.resolve(opened)
      }
    }
  }

  // MARK: - Endpoint resolution

  private func resolveEndpoint(_ completion: @escaping (MobileSupport.Endpoint?) -> Void) {
    DispatchQueue.main.async { [weak self] in
      guard let self, let manager = self.tunnelManager else {
        completion(nil)
        return
      }
      switch manager.connection.status {
      case .connected, .reasserting:
        guard let session = manager.connection as? NETunnelProviderSession else {
          completion(nil)
          return
        }
        var pending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
          guard pending else { return }
          pending = false
          completion(nil)
        }
        do {
          try session.sendProviderMessage(Data("endpoint".utf8)) { data in
            DispatchQueue.main.async {
              guard pending else { return }
              pending = false
              guard manager.connection.status == .connected || manager.connection.status == .reasserting,
                let data, let endpoint = try? JSONDecoder().decode(MobileSupport.Endpoint.self, from: data)
              else {
                completion(nil)
                return
              }
              if let idle = self.service {
                self.service = nil
                DispatchQueue.global(qos: .utility).async { try? idle.close() }
              }
              completion(endpoint)
            }
          }
        } catch {
          pending = false
          completion(nil)
        }
      case .connecting, .disconnecting:
        completion(nil)
      case .disconnected, .invalid:
        do {
          if self.service == nil {
            let platform = AppPlatform(manager: manager, directory: try MobileSupport.directory())
            self.service = MobileNewTunnelService(platform, MobileLog())
          }
          guard let service = self.service else {
            throw MobileFailure("Could not start XBond.")
          }
          completion(try MobileSupport.webEndpoint(for: service))
        } catch {
          completion(nil)
        }
      @unknown default:
        completion(nil)
      }
    }
  }

  // MARK: - Account callback delivery

  private func deliverWithRetry(code: String, state: String) async -> Bool {
    let payload: [String: String] = ["code": code, "state": state]
    guard let body = try? JSONSerialization.data(withJSONObject: payload) else {
      return false
    }
    for _ in 0..<8 {
      let directory = (try? MobileSupport.directory())?.path ?? ""
      let addrPath = URL(fileURLWithPath: directory).appendingPathComponent("localapi.addr")
      let tokenPath = URL(fileURLWithPath: directory).appendingPathComponent("localapi.token")
      if let addr = try? String(contentsOf: addrPath, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
        let token = try? String(contentsOf: tokenPath, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
        !addr.isEmpty, !token.isEmpty, let url = URL(string: "http://\(addr)/localapi/v0/account/callback")
      {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 5
        request.setValue(token, forHTTPHeaderField: "X-XBond-Token")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        if let (_, response) = try? await URLSession.shared.data(for: request),
          let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
        {
          return true
        }
      }
      try? await Task.sleep(nanoseconds: 500_000_000)
    }
    return false
  }

  // MARK: - open-browser handoff

  /// The PacketTunnel extension writes an https URL into the shared
  /// container (UIApplication is unavailable there); the host opens it in
  /// Safari when active. One-second poll, exactly like the old dashboard.
  private func startBrowserPolling() {
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 1, repeating: 1)
    timer.setEventHandler {
      DispatchQueue.main.async {
        guard UIApplication.shared.applicationState == .active,
          let directory = try? MobileSupport.directory()
        else { return }
        let pending = directory.appendingPathComponent("open-browser")
        guard let value = try? String(contentsOf: pending, encoding: .utf8) else { return }
        try? FileManager.default.removeItem(at: pending)
        guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
          url.scheme == "https"
        else { return }
        UIApplication.shared.open(url)
      }
    }
    timer.resume()
    browserPoller = timer
  }

  private static func parseColor(_ hex: String) -> UIColor? {
    var value = hex
    if value.hasPrefix("#") { value.removeFirst() }
    guard value.count == 6, let rgb = UInt64(value, radix: 16) else { return nil }
    return UIColor(
      red: CGFloat((rgb >> 16) & 0xff) / 255,
      green: CGFloat((rgb >> 8) & 0xff) / 255,
      blue: CGFloat(rgb & 0xff) / 255,
      alpha: 1
    )
  }

  private static func safeFileName(_ name: String) -> String {
    let invalid = CharacterSet(charactersIn: "/\\\\:*?\\\"<>|")
    let cleaned = name.components(separatedBy: invalid.union(.controlCharacters)).joined(separator: "_").trimmingCharacters(in: .whitespaces)
    return cleaned.isEmpty ? "export.txt" : cleaned
  }

  private static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let window = scenes.flatMap { $0.windows }.first(where: { $0.isKeyWindow }) ?? scenes.first?.windows.first
    var top = window?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
  }
}

private final class ExportPickerDelegate: NSObject, UIDocumentPickerDelegate {
  static var associatedKey: UInt8 = 0
  private let url: URL
  private let completion: (Bool) -> Void
  private var settled = false

  init(url: URL, completion: @escaping (Bool) -> Void) {
    self.url = url
    self.completion = completion
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish(false)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finish(!urls.isEmpty)
  }

  private func finish(_ saved: Bool) {
    guard !settled else { return }
    settled = true
    try? FileManager.default.removeItem(at: url)
    completion(saved)
  }
}

@_cdecl("init_plugin_xbond")
public func initPlugin() -> Plugin {
  return XbondPlugin()
}
