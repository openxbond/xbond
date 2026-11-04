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
    func protectSocket(_ fd: Int32) throws {}
    func onStateChanged(_ state: Int32, message: String?) {}
    func onTraffic(_ uploadBytes: Int64, downloadBytes: Int64) {}

    func requestConnect() throws {
        // Go calls this on its HTTP worker. Apple preference calls can ask
        // for system consent and complete asynchronously on the main queue.
        let operation = ConnectOperation()
        DispatchQueue.main.async { [self] in
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
        try operation.wait()
    }

    func requestDisconnect() throws {
        DispatchQueue.main.async { [manager] in manager.connection.stopVPNTunnel() }
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
