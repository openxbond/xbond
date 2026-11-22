import Foundation
import XBondMobile

enum MobileSupport {
    static let providerID = "net.xbond.app.PacketTunnel"
    static let appGroup = "group.net.xbond.app"
    static let appLanguageKey = "app_lang"
    static let disconnectNotificationID = "xbond.vpn.disconnected"

    static func disconnectNotice(revoked: Bool) -> (title: String, body: String) {
        let saved = UserDefaults(suiteName: appGroup)?.string(forKey: appLanguageKey)
        let lang = (saved ?? Locale.preferredLanguages.first ?? "en").lowercased()
        if lang == "zh_hk" || lang.hasPrefix("zh-hant") || lang.hasPrefix("zh-hk") || lang.hasPrefix("zh-tw") || lang.hasPrefix("zh-mo") {
            return revoked
                ? ("XBond VPN 已中斷", "VPN 權限或設定已變更，需要重新連線。")
                : ("XBond VPN 已中斷", "背景連線已意外斷開，請返回應用檢查。")
        }
        if lang == "zh_cn" || lang.hasPrefix("zh") {
            return revoked
                ? ("XBond VPN 已中断", "VPN 权限或配置已变更，需要重新连接。")
                : ("XBond VPN 已中断", "后台连接意外断开，请返回应用检查。")
        }
        if lang == "ko" || lang.hasPrefix("ko") {
            return revoked
                ? ("XBond VPN 연결 끊김", "VPN 권한 또는 구성이 변경되었습니다. 다시 연결해 주세요.")
                : ("XBond VPN 연결 끊김", "백그라운드에서 예기치 않게 연결이 끊어졌습니다.")
        }
        if lang == "fa" || lang.hasPrefix("fa") {
            return revoked
                ? ("‏VPN XBond قطع شد", "دسترسی یا پیکربندی VPN تغییر کرده است. دوباره متصل شوید.")
                : ("‏VPN XBond قطع شد", "اتصال در پس‌زمینه به‌طور غیرمنتظره قطع شد.")
        }
        return revoked
            ? ("XBond VPN disconnected", "VPN permission or configuration changed. Tap to reconnect.")
            : ("XBond VPN disconnected", "The background connection stopped unexpectedly.")
    }
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
