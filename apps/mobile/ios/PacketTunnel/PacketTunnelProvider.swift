import Foundation
import NetworkExtension
import XBondMobile

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let queue = DispatchQueue(label: "net.xbond.app.packets")
    private var service: MobileTunnelService?
    private var packets: PacketBridge?

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "127.0.0.1")
        let ipv4 = NEIPv4Settings(addresses: ["172.19.0.1"], subnetMasks: ["255.255.255.252"])
        ipv4.includedRoutes = [.default()]
        settings.ipv4Settings = ipv4
        let ipv6 = NEIPv6Settings(addresses: ["fd7a:7862:6f6e::1"], networkPrefixLengths: [64])
        ipv6.includedRoutes = [.default()]
        settings.ipv6Settings = ipv6
        settings.dnsSettings = NEDNSSettings(servers: ["172.19.0.2"])
        settings.dnsSettings?.matchDomains = [""]
        settings.mtu = 1500

        setTunnelNetworkSettings(settings) { [self] error in
            if let error {
                completionHandler(error)
                return
            }
            queue.async { [self] in
                do {
                    let platform = ExtensionPlatform(provider: self, directory: try MobileSupport.directory())
                    let bridge = try PacketBridge(flow: packetFlow, queue: queue)
                    guard let tunnel = MobileNewTunnelService(platform, MobileLog()) else {
                        throw MobileFailure("Could not create the XBond tunnel.")
                    }
                    do {
                        try tunnel.startActive(bridge.coreDescriptor)
                        _ = try MobileSupport.webEndpoint(for: tunnel)
                    } catch {
                        try? tunnel.close()
                        throw error
                    }
                    service = tunnel
                    packets = bridge
                    bridge.start()
                    completionHandler(nil)
                } catch {
                    completionHandler(error)
                }
            }
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        queue.async { [self] in
            packets?.stop()
            try? service?.close()
            service = nil
            packets = nil
            completionHandler()
        }
    }

    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        queue.async { [self] in
            guard messageData == Data("endpoint".utf8), let service else {
                completionHandler?(nil)
                return
            }
            let endpoint = try? MobileSupport.webEndpoint(for: service)
            completionHandler?(endpoint.flatMap { try? JSONEncoder().encode($0) })
        }
    }
}

private final class ExtensionPlatform: NSObject, MobilePlatformBridgeProtocol {
    private weak var provider: PacketTunnelProvider?
    private let directory: URL

    init(provider: PacketTunnelProvider, directory: URL) {
        self.provider = provider
        self.directory = directory
    }

    func dataDir() -> String { directory.path }
    // The network extension's own sockets are outside its VPN routes.
    func protectSocket(_ fd: Int32) throws {}
    func onStateChanged(_ state: Int32, message: String?) {}
    func onTraffic(_ uploadBytes: Int64, downloadBytes: Int64) {}
    func requestConnect() throws { throw MobileFailure("The tunnel is already running.") }
    func requestDisconnect() throws {
        guard let provider else { throw MobileFailure("The tunnel is unavailable.") }
        provider.cancelTunnelWithError(nil)
    }
    func openURL(_ value: String?) throws {
        guard let value, URL(string: value)?.scheme == "https" else {
            throw MobileFailure("The browser URL is invalid.")
        }
        // UIApplication is unavailable to a Network Extension. The host
        // consumes the request from the shared container when active.
        try Data(value.utf8).write(to: directory.appendingPathComponent("open-browser"), options: .atomic)
    }
}
