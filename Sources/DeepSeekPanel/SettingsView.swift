import ServiceManagement
import SwiftUI

struct SettingsView: View {
    @State private var token = Keychain.load() ?? ""
    @State private var interval = Double(AppSettings.refreshIntervalMinutes)
    @State private var periodRaw = AppSettings.period.rawValue
    @State private var currency = AppSettings.displayCurrency
    @State private var useMock = AppSettings.useMockData
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var saveMessage: String?
    @State private var loginErrorMessage: String?

    private let intervals: [Double] = [1, 5, 15, 30, 60]

    var body: some View {
        Form {
            Section("凭据") {
                SecureField("Bearer Token", text: $token)
                Text("这是 DeepSeek 平台网页会话的 Bearer Token，失效后请在 platform.deepseek.com 重新登录并抓取新的 Token 粘贴到这里。")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Section("显示") {
                Picker("刷新间隔", selection: $interval) {
                    ForEach(intervals, id: \.self) { minutes in
                        Text("\(Int(minutes)) 分钟").tag(minutes)
                    }
                }
                Text("平台用量统计本身有约 5 分钟延迟，建议刷新间隔设为 5 分钟或更长，避免频繁请求被限流。")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Picker("统计周期", selection: $periodRaw) {
                    ForEach(StatsPeriod.allCases) { period in
                        Text(period.title).tag(period.rawValue)
                    }
                }
                Picker("显示币种", selection: $currency) {
                    Text("CNY（¥）").tag("CNY")
                    Text("USD（$）").tag("USD")
                }
            }

            Section("通用") {
                Toggle("使用本地模拟数据（离线测试，不联网）", isOn: $useMock)
                Toggle("登录时自动启动", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, newValue in
                        updateLaunchAtLogin(newValue)
                    }
                if let loginErrorMessage {
                    Text(loginErrorMessage)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }

            HStack {
                if let saveMessage {
                    Text(saveMessage)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Button("保存并刷新") {
                    save()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .formStyle(.grouped)
        .frame(width: 460, height: 420)
    }

    private func save() {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try Keychain.save(trimmed)
        } catch {
            saveMessage = "保存失败：\(error.localizedDescription)"
            return
        }
        AppSettings.refreshIntervalMinutes = Int(interval)
        AppSettings.period = StatsPeriod(rawValue: periodRaw) ?? .today
        AppSettings.displayCurrency = currency
        AppSettings.useMockData = useMock
        saveMessage = "已保存"
        NotificationCenter.default.post(name: .refreshRequested, object: nil)
    }

    private func updateLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            loginErrorMessage = nil
        } catch {
            loginErrorMessage = "设置失败：\(error.localizedDescription)。请确认应用已复制到“应用程序”文件夹。"
            launchAtLogin = SMAppService.mainApp.status == .enabled
        }
    }
}
