import Foundation
import NetworkExtension
import UIKit
import WebKit
import XBondMobile

final class DashboardViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private let web = WKWebView()
    private let loadingContainer = UIStackView()
    private let activityIndicator = UIActivityIndicatorView(style: .large)
    private let statusLabel = UILabel()
    private let retryButton = UIButton(type: .system)

    private var isDarkMode: Bool? = nil {
        didSet {
            if let isDark = isDarkMode {
                overrideUserInterfaceStyle = isDark ? .dark : .light
            } else {
                overrideUserInterfaceStyle = .unspecified
            }
            setNeedsStatusBarAppearanceUpdate()
        }
    }

    private var manager: NETunnelProviderManager?
    private var service: MobileTunnelService?
    private var endpoint: MobileSupport.Endpoint?
    private var webOrigin: URL?
    private var browserTimer: Timer?
    private var pendingDeepLink: URL?

    override var preferredStatusBarStyle: UIStatusBarStyle {
        let isDark = isDarkMode ?? (traitCollection.userInterfaceStyle == .dark)
        return isDark ? .lightContent : .darkContent
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) {
            setNeedsStatusBarAppearanceUpdate()
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = .systemBackground
        web.scrollView.backgroundColor = .systemBackground
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.alwaysBounceVertical = true
        if #available(iOS 16.4, *) {
            web.isInspectable = true
        }
        web.alpha = 0
        web.translatesAutoresizingMaskIntoConstraints = false

        let bridgeScript = """
        window.XBondIOS = {
            openURL: function(url) {
                if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.xbond) {
                    window.webkit.messageHandlers.xbond.postMessage({ action: 'openURL', url: url });
                    return true;
                }
                return false;
            },
            syncSystemBars: function(isDark, colorHex) {
                if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.xbond) {
                    window.webkit.messageHandlers.xbond.postMessage({ action: 'syncSystemBars', isDark: isDark, colorHex: colorHex });
                }
            }
        };
        """
        web.configuration.userContentController.addUserScript(
            WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        web.configuration.userContentController.add(self, name: "xbond")

        loadingContainer.axis = .vertical
        loadingContainer.alignment = .center
        loadingContainer.spacing = 16
        loadingContainer.translatesAutoresizingMaskIntoConstraints = false

        activityIndicator.hidesWhenStopped = true
        activityIndicator.startAnimating()

        statusLabel.text = "Starting XBond…"
        statusLabel.font = .systemFont(ofSize: 15, weight: .medium)
        statusLabel.textColor = .secondaryLabel
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0

        retryButton.setTitle("Retry", for: .normal)
        retryButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        retryButton.isHidden = true
        retryButton.addTarget(self, action: #selector(retryLoad), for: .touchUpInside)

        loadingContainer.addArrangedSubview(activityIndicator)
        loadingContainer.addArrangedSubview(statusLabel)
        loadingContainer.addArrangedSubview(retryButton)

        view.addSubview(web)
        view.addSubview(loadingContainer)

        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            loadingContainer.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            loadingContainer.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            loadingContainer.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
        ])

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

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "xbond", let dict = message.body as? [String: Any] else { return }
        let action = dict["action"] as? String
        if action == "openURL", let urlString = dict["url"] as? String, let url = URL(string: urlString) {
            UIApplication.shared.open(url)
        } else if action == "syncSystemBars" {
            let isDark = dict["isDark"] as? Bool ?? false
            DispatchQueue.main.async { [weak self] in
                self?.isDarkMode = isDark
            }
        }
    }

    @objc private func retryLoad() {
        retryButton.isHidden = true
        activityIndicator.startAnimating()
        statusLabel.text = "Starting XBond…"
        if manager == nil {
            discloseAndStart()
        } else {
            endpoint = nil
            showCurrentDashboard()
        }
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
            self?.activityIndicator.stopAnimating()
            self?.statusLabel.text = "Open Settings to review the VPN disclosure."
            self?.retryButton.isHidden = false
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
        NETunnelProviderManager.loadAllFromPreferences { [weak self] managers, _ in
            DispatchQueue.main.async {
                guard let self else { return }
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
                    let platform = AppPlatform(manager: manager, directory: try MobileSupport.directory()) { [weak self] in
                        self?.service
                    }
                    service = MobileNewTunnelService(platform, MobileLog())
                }
                guard let service else { throw MobileFailure("Could not start XBond.") }
                show(try MobileSupport.webEndpoint(for: service))
            } catch {
                showError(error)
            }
        case .connecting, .disconnecting:
            activityIndicator.startAnimating()
            retryButton.isHidden = true
            statusLabel.text = manager.connection.status == .connecting ? "Connecting…" : "Disconnecting…"
            loadingContainer.isHidden = false
            UIView.animate(withDuration: 0.2) {
                self.loadingContainer.alpha = 1
                self.web.alpha = 0
            }
        @unknown default:
            break
        }
    }

    private func show(_ next: MobileSupport.Endpoint) {
        if endpoint == next {
            if web.alpha == 0 {
                UIView.animate(withDuration: 0.25) {
                    self.loadingContainer.alpha = 0
                    self.web.alpha = 1
                } completion: { _ in
                    self.loadingContainer.isHidden = true
                    self.activityIndicator.stopAnimating()
                }
            }
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
        activityIndicator.stopAnimating()
        statusLabel.text = error.localizedDescription
        retryButton.isHidden = false
        loadingContainer.isHidden = false
        UIView.animate(withDuration: 0.2) {
            self.loadingContainer.alpha = 1
            self.web.alpha = 0
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("""
        JSON.stringify({
            navPaddingBottom: window.getComputedStyle(document.querySelector('nav') || document.body).paddingBottom,
            navHeight: (document.querySelector('nav') || document.body).getBoundingClientRect().height,
            innerHeight: window.innerHeight,
            screenHeight: screen.height,
            safeAreaInsetsTop: window.visualViewport?.offsetTop
        })
        """) { res, _ in
            NSLog("[XBondUI] Web metrics: %@", String(describing: res))
        }
        UIView.animate(withDuration: 0.25) {
            self.loadingContainer.alpha = 0
            self.web.alpha = 1
        } completion: { _ in
            self.loadingContainer.isHidden = true
            self.activityIndicator.stopAnimating()
        }
        if let pending = pendingDeepLink {
            pendingDeepLink = nil
            _ = handleDeepLink(pending)
        }
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
            if action.targetFrame?.isMainFrame == true {
                if let scheme = url.scheme?.lowercased(),
                   scheme == "https" || scheme == "http" || scheme == "mailto" {
                    UIApplication.shared.open(url)
                }
            }
        }
    }

    func handleDeepLink(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(),
              scheme == "xbond" || scheme == "clash" || scheme == "sing-box"
        else { return false }

        if web.isLoading || endpoint == nil {
            pendingDeepLink = url
        }

        if scheme == "xbond", url.host == "callback",
           let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            let code = components.queryItems?.first(where: { $0.name == "code" })?.value
            let state = components.queryItems?.first(where: { $0.name == "state" })?.value
            if let code, !code.isEmpty, let state, !state.isEmpty {
                deliverAccountCallback(code: code, state: state)
            }
        }

        if let jsonString = try? String(data: JSONEncoder().encode(url.absoluteString), encoding: .utf8) {
            DispatchQueue.main.async { [weak self] in
                self?.web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('xbond-deep-link', { detail: \(jsonString) }));")
            }
        }
        return true
    }

    private func deliverAccountCallback(code: String, state: String) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let body: [String: String] = ["code": code, "state": state]
            guard let payload = try? JSONSerialization.data(withJSONObject: body) else { return }

            for _ in 1...8 {
                guard let self, let endpoint = self.endpoint else {
                    Thread.sleep(forTimeInterval: 0.5)
                    continue
                }
                guard let url = URL(string: "http://127.0.0.1:\(endpoint.port)/localapi/v0/account/callback") else { break }
                var request = URLRequest(url: url, timeoutInterval: 5)
                request.httpMethod = "POST"
                request.setValue(endpoint.token, forHTTPHeaderField: "X-XBond-Token")
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = payload

                let semaphore = DispatchSemaphore(value: 0)
                var success = false
                let task = URLSession.shared.dataTask(with: request) { _, response, _ in
                    if let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) {
                        success = true
                    }
                    semaphore.signal()
                }
                task.resume()
                _ = semaphore.wait(timeout: .now() + 5)

                if success {
                    DispatchQueue.main.async {
                        self.web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('xbond-account-updated'));")
                    }
                    return
                }
                Thread.sleep(forTimeInterval: 0.5)
            }
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }

    private func installWebAssets(in directory: URL) throws {
        let files = FileManager.default
        let web = directory.appendingPathComponent("web", isDirectory: true)
        let marker = directory.appendingPathComponent("web-version")
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""

        guard let source = Bundle.main.url(forResource: "dist", withExtension: nil),
              files.fileExists(atPath: source.appendingPathComponent("index.html").path) else {
            throw MobileFailure("The XBond dashboard was not packaged.")
        }

        let sourceIndex = source.appendingPathComponent("index.html")
        let targetIndex = web.appendingPathComponent("index.html")
        if (try? String(contentsOf: marker, encoding: .utf8)) == build,
           files.fileExists(atPath: targetIndex.path),
           let sourceAttrs = try? files.attributesOfItem(atPath: sourceIndex.path),
           let targetAttrs = try? files.attributesOfItem(atPath: targetIndex.path),
           let sourceDate = sourceAttrs[.modificationDate] as? Date,
           let targetDate = targetAttrs[.modificationDate] as? Date,
           targetDate >= sourceDate {
            return
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
        web.configuration.userContentController.removeScriptMessageHandler(forName: "xbond")
        try? service?.close()
    }
}
