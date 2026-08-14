import AppKit
import Darwin

if ProcessInfo.processInfo.environment["DEEPSEEK_PANEL_DEBUG"] == "1" {
    setbuf(stdout, nil)
}

if CommandLine.arguments.contains("--dump") {
    let semaphore = DispatchSemaphore(value: 0)
    Task {
        await Dump.run()
        semaphore.signal()
    }
    semaphore.wait()
    exit(0)
}

// 防止重复启动导致出现两个状态栏面板。
let bundleID = Bundle.main.bundleIdentifier ?? "com.local.deepseek-panel"
let existingInstances = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
    .filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
if !existingInstances.isEmpty {
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
