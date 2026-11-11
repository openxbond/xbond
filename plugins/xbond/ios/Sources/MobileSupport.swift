import Foundation
import XBondMobile

enum MobileSupport {
    static let providerID = "net.xbond.app.PacketTunnel"
    static let appGroup = "group.net.xbond.app"
    private static let sharedDirectory = Result<URL, Error> {
        #if targetEnvironment(simulator)
        let appSupport = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let directory = appSupport.appendingPathComponent("XBond", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
        #else
        guard let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
            throw MobileFailure("The XBond App Group is unavailable.")
        }
        return directory
        #endif
    }

    static func directory() throws -> URL {
        try sharedDirectory.get()
    }

    static func webEndpoint(for service: MobileTunnelService) throws -> Endpoint {
        let port = service.localAPIPort()
        let token = service.localAPIToken()
        guard port > 0, port <= 65535, !token.isEmpty else {
            throw MobileFailure("The local XBond interface could not start.")
        }
        return Endpoint(port: port, token: token)
    }

    struct Endpoint: Codable, Equatable {
        let port: Int32
        let token: String
    }
}

struct MobileFailure: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

final class MobileLog: NSObject, MobileStatusListenerProtocol {
    func onLog(_ level: String?, message: String?) {
        // Core diagnostics are available through LocalAPI. Do not forward
        // configuration or subscription errors into the OS log.
    }
}
