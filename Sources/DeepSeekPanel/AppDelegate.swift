import AppKit

extension Notification.Name {
    static let openSettings = Notification.Name("DeepSeekPanel.openSettings")
    static let refreshRequested = Notification.Name("DeepSeekPanel.refreshRequested")
    static let periodChanged = Notification.Name("DeepSeekPanel.periodChanged")
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusController: StatusBarController?
    private var settingsController: SettingsWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let environment = ProcessInfo.processInfo.environment
        let testToken = environment["DEEPSEEK_PANEL_TEST_TOKEN"]
        if testToken == nil && environment["DEEPSEEK_PANEL_MOCK"] != "1" {
            if Keychain.load() == nil, !AppDefaults.initialToken.isEmpty {
                try? Keychain.save(AppDefaults.initialToken)
            }
        }

        let controller = StatusBarController()
        statusController = controller
        controller.start()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(openSettings),
            name: .openSettings,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(refreshNow),
            name: .refreshRequested,
            object: nil
        )
    }

    @objc private func openSettings() {
        NSApp.activate(ignoringOtherApps: true)
        let controller = SettingsWindowController()
        settingsController = controller
        controller.showWindow(nil)
    }

    @objc private func refreshNow() {
        Task { @MainActor in
            statusController?.refreshNow()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        statusController?.stop()
    }
}
