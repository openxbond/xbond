import Darwin
import Foundation
import NetworkExtension
import UIKit
import XBondMobile

final class AppPlatform: NSObject, MobilePlatformBridgeProtocol {
    private let manager: NETunnelProviderManager
    private let directory: URL
    private let serviceProvider: (() -> MobileTunnelService?)?
    #if targetEnvironment(simulator)
    private var simulatorBridge: SimulatorBridge?
    #endif

    init(manager: NETunnelProviderManager, directory: URL, serviceProvider: (() -> MobileTunnelService?)? = nil) {
        self.manager = manager
        self.directory = directory
        self.serviceProvider = serviceProvider
    }

    func dataDir() -> String { directory.path }
    func protectSocket(_ fd: Int32) throws {}
    func onStateChanged(_ state: Int32, message: String?) {}
    func onTraffic(_ uploadBytes: Int64, downloadBytes: Int64) {}

    func requestConnect() throws {
        #if targetEnvironment(simulator)
        guard let service = serviceProvider?() else {
            throw MobileFailure("Simulator tunnel service unavailable.")
        }
        let bridge = try SimulatorBridge()
        do {
            try service.startActive(bridge.coreFd)
            self.simulatorBridge = bridge
        } catch {
            bridge.stop()
            throw error
        }
        #else
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
        #endif
    }

    func requestDisconnect() throws {
        #if targetEnvironment(simulator)
        guard let service = serviceProvider?() else { return }
        try? service.stop()
        simulatorBridge?.stop()
        simulatorBridge = nil
        #else
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

#if targetEnvironment(simulator)
private final class SimulatorBridge {
    let coreFd: Int32
    private let peerFd: Int32
    private var source: DispatchSourceRead?

    init() throws {
        var sockets: [Int32] = [-1, -1]
        let result = sockets.withUnsafeMutableBufferPointer {
            socketpair(AF_UNIX, SOCK_DGRAM, 0, $0.baseAddress!)
        }
        guard result == 0 else { throw MobileFailure("Could not create simulator packet adapter.") }
        _ = fcntl(sockets[1], F_SETFL, O_NONBLOCK)
        coreFd = sockets[0]
        peerFd = sockets[1]

        let readSource = DispatchSource.makeReadSource(fileDescriptor: peerFd, queue: DispatchQueue.global(qos: .utility))
        readSource.setEventHandler { [weak self] in
            guard let self else { return }
            var buf = [UInt8](repeating: 0, count: 2048)
            _ = Darwin.read(self.peerFd, &buf, buf.count)
        }
        readSource.resume()
        source = readSource
    }

    func stop() {
        source?.cancel()
        source = nil
        Darwin.close(peerFd)
    }

    deinit {
        stop()
    }
}
#endif

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
