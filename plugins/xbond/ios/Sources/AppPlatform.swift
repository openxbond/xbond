import Foundation
import NetworkExtension
import UIKit
import XBondMobile

final class AppPlatform: NSObject, MobilePlatformBridgeProtocol {
    private let manager: NETunnelProviderManager
    private let directory: URL

    init(manager: NETunnelProviderManager, directory: URL) {
        self.manager = manager
        self.directory = directory
    }

    func dataDir() -> String { directory.path }
    // 安装信标的 osv：iOS 的版本号由 Go 的 darwin sysctl 探测拿到，桥接值
    // 留空即回退原生探测（gomobile 协议要求全部方法实现）。
    func osVersion() -> String { "" }
    func protectSocket(_ fd: Int32) throws {}
    func onStateChanged(_ state: Int32, message: String?) {}
    func onTraffic(_ uploadBytes: Int64, downloadBytes: Int64) {}

    func requestConnect() throws {
        #if targetEnvironment(simulator)
        throw MobileFailure("VPN connections require a physical iPhone or iPad.")
        #else
        // Go calls this on its HTTP worker. Apple preference calls can ask
        // for system consent and complete asynchronously on the main queue.
        let operation = ConnectOperation()
        DispatchQueue.main.async { [self] in
            confirmVPNDisclosure { [self] in
                startTunnel(operation)
            } onCancel: {
                operation.complete(MobileFailure("VPN permission was not granted."))
            }
        }
        try operation.wait()
        #endif
    }

    #if !targetEnvironment(simulator)
    private func confirmVPNDisclosure(_ onContinue: @escaping () -> Void, onCancel: @escaping () -> Void) {
        let key = "vpn-disclosure-accepted"
        if UserDefaults.standard.bool(forKey: key) {
            onContinue()
            return
        }
        let root = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .compactMap { $0.keyWindow?.rootViewController }.first
        guard var presenter = root else { onCancel(); return }
        while let presented = presenter.presentedViewController { presenter = presented }
        let dialog = UIAlertController(
            title: "XBond VPN and privacy",
            message: "XBond uses a VPN to route network traffic through the proxy you select. Your subscriptions and connection settings are stored on this device. When you sign in, XBond Cloud uses your account and subscription information to provide the service. The selected proxy receives the traffic you route through it.",
            preferredStyle: .alert
        )
        dialog.addAction(UIAlertAction(title: "Continue", style: .default) { _ in
            UserDefaults.standard.set(true, forKey: key)
            onContinue()
        })
        dialog.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in onCancel() })
        presenter.present(dialog, animated: true)
    }

    private func startTunnel(_ operation: ConnectOperation) {
        let configuration = NETunnelProviderProtocol()
        configuration.providerBundleIdentifier = MobileSupport.providerID
        configuration.serverAddress = "XBond"
        manager.protocolConfiguration = configuration
        manager.localizedDescription = "XBond"
        manager.isEnabled = true
        manager.saveToPreferences { [self] error in
            if let error { operation.complete(error); return }
            manager.loadFromPreferences { [self] error in
                if let error { operation.complete(error); return }
                do {
                    guard let session = manager.connection as? NETunnelProviderSession else {
                        throw MobileFailure("The tunnel connection is unavailable.")
                    }
                    try session.startTunnel(options: nil)
                    operation.complete(nil)
                } catch {
                    operation.complete(error)
                }
            }
        }
    }
    #endif

    func requestDisconnect() throws {
        #if !targetEnvironment(simulator)
        DispatchQueue.main.async { [manager] in manager.connection.stopVPNTunnel() }
        #endif
    }

    func openURL(_ value: String?) throws {
        guard let value, let url = URL(string: value), url.scheme == "https" else {
            throw MobileFailure("The browser URL is invalid.")
        }
        DispatchQueue.main.async { UIApplication.shared.open(url) }
    }
}

private final class ConnectOperation {
    private let finished = DispatchSemaphore(value: 0)
    private var error: Error?

    func complete(_ error: Error?) {
        self.error = error
        finished.signal()
    }

    func wait() throws {
        guard finished.wait(timeout: .now() + 60) == .success else {
            throw MobileFailure("iOS did not respond to the VPN request.")
        }
        if let error { throw error }
    }
}
