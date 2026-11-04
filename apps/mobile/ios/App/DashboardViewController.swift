import Foundation
import NetworkExtension
import UIKit
import WebKit
import XBondMobile

final class DashboardViewController: UIViewController, WKNavigationDelegate {
    private let web = WKWebView()
    private let placeholder = UILabel()
    private var manager: NETunnelProviderManager?
    private var service: MobileTunnelService?
    private var endpoint: MobileSupport.Endpoint?
    private var webOrigin: URL?
    private var browserTimer: Timer?

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "XBond"
        view.backgroundColor = .systemBackground
        web.navigationDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        placeholder.text = "Starting XBond…"
        placeholder.numberOfLines = 0
        placeholder.textAlignment = .center
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(placeholder)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            placeholder.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            placeholder.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            placeholder.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
        ])
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "Settings", style: .plain, target: self, action: #selector(showSettings)
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(tunnelChanged), name: .NEVPNStatusDidChange, object: nil
        )
        browserTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.openPendingBrowserRequest()
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if manager == nil { discloseAndStart() }
    }

    private func discloseAndStart() {
        if UserDefaults.standard.bool(forKey: "vpn-disclosure-accepted") {
            loadManager()
            return
        }
        let dialog = UIAlertController(
            title: "XBond VPN and privacy",
            message: """
            XBond uses a VPN to route network traffic through the proxy you select. Your subscriptions and connection settings are stored on this device. When you sign in, XBond Cloud uses your account and subscription information to provide the service. The selected proxy receives the traffic you route through it.
            """,
            preferredStyle: .alert
        )
        dialog.addAction(UIAlertAction(title: "Continue", style: .default) { [weak self] _ in
            UserDefaults.standard.set(true, forKey: "vpn-disclosure-accepted")
            self?.loadManager()
        })
        dialog.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.placeholder.text = "Open Settings to review the VPN disclosure."
        })
        present(dialog, animated: true)
    }

    private func loadManager() {
        do {
            try installWebAssets(in: MobileSupport.directory())
        } catch {
            showError(error)
            return
        }
        NETunnelProviderManager.loadAllFromPreferences { [weak self] managers, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error { self.showError(error); return }
                self.manager = managers?.first(where: {
                    ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == MobileSupport.providerID
                }) ?? NETunnelProviderManager()
                self.tunnelChanged()
            }
        }
    }

    @objc private func tunnelChanged() {
        DispatchQueue.main.async { [weak self] in self?.showCurrentDashboard() }
    }

    private func showCurrentDashboard() {
        guard let manager else { return }
        switch manager.connection.status {
        case .connected, .reasserting:
            guard let session = manager.connection as? NETunnelProviderSession else { return }
            do {
                try session.sendProviderMessage(Data("endpoint".utf8)) { [weak self] data in
                    DispatchQueue.main.async {
                        guard let self, manager.connection.status == .connected || manager.connection.status == .reasserting else { return }
                        guard let data, let endpoint = try? JSONDecoder().decode(MobileSupport.Endpoint.self, from: data) else {
                            self.showError(MobileFailure("The tunnel dashboard is unavailable."))
                            return
                        }
                        self.show(endpoint)
                        let idleService = self.service
                        self.service = nil
                        DispatchQueue.global(qos: .utility).async { try? idleService?.close() }
                    }
                }
            } catch {
                showError(error)
            }
        case .disconnected, .invalid:
            do {
                if service == nil {
                    let platform = AppPlatform(manager: manager, directory: try MobileSupport.directory())
                    service = MobileNewTunnelService(platform, MobileLog())
                }
                guard let service else { throw MobileFailure("Could not start XBond.") }
                show(try MobileSupport.webEndpoint(for: service))
            } catch {
                showError(error)
            }
        case .connecting, .disconnecting:
            placeholder.text = manager.connection.status == .connecting ? "Connecting…" : "Disconnecting…"
            placeholder.isHidden = false
            web.isHidden = true
        @unknown default:
            break
        }
    }

    private func show(_ next: MobileSupport.Endpoint) {
        if endpoint == next {
            placeholder.isHidden = true
            web.isHidden = false
            return
        }
        guard let url = URL(string: "http://127.0.0.1:\(next.port)/"), next.port > 0, !next.token.isEmpty else { return }
        endpoint = next
        webOrigin = url
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue(next.token, forHTTPHeaderField: "X-XBond-Token")
        web.load(request)
    }

    private func showError(_ error: Error) {
        placeholder.text = error.localizedDescription
        placeholder.isHidden = false
        web.isHidden = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        placeholder.isHidden = true
        web.isHidden = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled {
            endpoint = nil
            showError(error)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "http", url.host == webOrigin?.host, url.port == webOrigin?.port, action.targetFrame?.isMainFrame == true {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            if action.navigationType == .linkActivated, url.scheme == "https" { UIApplication.shared.open(url) }
        }
    }

    @objc private func showSettings() {
        let dialog = UIAlertController(title: "XBond Settings", message: nil, preferredStyle: .alert)
        if let value = Bundle.main.object(forInfoDictionaryKey: "XBondAppStoreURL") as? String,
           let url = URL(string: value), url.scheme == "https", url.host == "apps.apple.com" {
            dialog.addAction(UIAlertAction(title: "Check for updates in the App Store", style: .default) { _ in
                UIApplication.shared.open(url)
            })
        }
        dialog.addAction(UIAlertAction(title: "Reload dashboard", style: .default) { [weak self] _ in
            guard let self else { return }
            if self.manager == nil { self.discloseAndStart() }
            else { self.endpoint = nil; self.showCurrentDashboard() }
        })
        dialog.addAction(UIAlertAction(title: "Done", style: .cancel))
        present(dialog, animated: true)
    }

    private func installWebAssets(in directory: URL) throws {
        let files = FileManager.default
        let web = directory.appendingPathComponent("web", isDirectory: true)
        let marker = directory.appendingPathComponent("web-version")
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        if (try? String(contentsOf: marker, encoding: .utf8)) == build,
           files.fileExists(atPath: web.appendingPathComponent("index.html").path) { return }
        guard let source = Bundle.main.url(forResource: "dist", withExtension: nil),
              files.fileExists(atPath: source.appendingPathComponent("index.html").path) else {
            throw MobileFailure("The XBond dashboard was not packaged.")
        }
        let staging = directory.appendingPathComponent("web-\(UUID().uuidString)", isDirectory: true)
        defer { try? files.removeItem(at: staging) }
        try files.copyItem(at: source, to: staging)
        if files.fileExists(atPath: web.path) {
            _ = try files.replaceItemAt(web, withItemAt: staging)
        } else {
            try files.moveItem(at: staging, to: web)
        }
        try build.write(to: marker, atomically: true, encoding: .utf8)
    }

    private func openPendingBrowserRequest() {
        guard UIApplication.shared.applicationState == .active,
              let directory = try? MobileSupport.directory() else { return }
        let file = directory.appendingPathComponent("open-browser")
        guard let value = try? String(contentsOf: file, encoding: .utf8),
              let url = URL(string: value), url.scheme == "https" else { return }
        try? FileManager.default.removeItem(at: file)
        UIApplication.shared.open(url)
    }

    deinit {
        browserTimer?.invalidate()
        NotificationCenter.default.removeObserver(self)
        try? service?.close()
    }
}
