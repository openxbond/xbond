import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        let dashboard = DashboardViewController()
        if let url = options?[.url] as? URL {
            _ = dashboard.handleDeepLink(url)
        }
        window.rootViewController = dashboard
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        guard let controller = window?.rootViewController as? DashboardViewController else {
            return false
        }
        return controller.handleDeepLink(url)
    }
}
