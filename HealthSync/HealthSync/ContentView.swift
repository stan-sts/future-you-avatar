import SwiftUI
import HealthKit
import UserNotifications

struct ContentView: View {
    private static let reminderIdentifier = "future-you-daily-reminder"

    @StateObject private var hk = HealthKitManager()
    @AppStorage("serverURL") private var serverURL = "http://localhost:3030"
    @AppStorage("manualScreenTimeHours") private var manualScreenTime = 6.0
    @AppStorage("dailyReminderEnabled") private var dailyReminderEnabled = false
    @AppStorage("dailyReminderHour") private var dailyReminderHour = 20
    @AppStorage("dailyReminderMinute") private var dailyReminderMinute = 0

    @State private var status: SyncStatus = .idle
    @State private var lastData: HealthPayload?
    @State private var showURLEditor = false
    @State private var reminderStatus = "Daily reminders are off."

    private var isUsingLocalhostOnDevice: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return serverURL.contains("localhost") || serverURL.contains("127.0.0.1")
        #endif
    }

    private var reminderTimeBinding: Binding<Date> {
        Binding(
            get: { Self.makeReminderDate(hour: dailyReminderHour, minute: dailyReminderMinute) },
            set: { newValue in
                let parts = Calendar.current.dateComponents([.hour, .minute], from: newValue)
                dailyReminderHour = parts.hour ?? dailyReminderHour
                dailyReminderMinute = parts.minute ?? dailyReminderMinute
                Task { await rescheduleReminderIfNeeded() }
            }
        )
    }

    private var formattedReminderTime: String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: Self.makeReminderDate(hour: dailyReminderHour, minute: dailyReminderMinute))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    header
                    if isUsingLocalhostOnDevice { deviceURLWarning }
                    companionControls
                    if let d = lastData { dataPreview(d) }
                    syncButton
                    serverRow
                }
                .padding(24)
            }
            .navigationTitle("Future You Sync")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            Task { await refreshReminderStatus() }
        }
        .onChange(of: dailyReminderEnabled) { enabled in
            Task { await handleReminderToggle(enabled) }
        }
    }

    var header: some View {
        VStack(spacing: 8) {
            Image(systemName: "applewatch")
                .font(.system(size: 56))
                .foregroundStyle(.blue.gradient)
            Text("Apple Health → Future You")
                .font(.headline)
            Text("Reads your last 7 days, adds screen time + reminders, and sends it to the web app.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    var companionControls: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Companion Controls")
                .font(.headline)

            VStack(alignment: .leading, spacing: 10) {
                Stepper(value: $manualScreenTime, in: 0...16, step: 0.5) {
                    HStack {
                        Text("Screen time")
                        Spacer()
                        Text("\(screenTimeLabel(manualScreenTime)) / day")
                            .foregroundStyle(.secondary)
                    }
                }

                Text("Apple’s Screen Time frameworks use the Family Controls entitlement, so this demo tracks screen time manually for now.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Divider()

            Toggle("Daily habit reminders", isOn: $dailyReminderEnabled)
                .font(.subheadline.weight(.semibold))

            if dailyReminderEnabled {
                DatePicker(
                    "Reminder time",
                    selection: reminderTimeBinding,
                    displayedComponents: .hourAndMinute
                )
                .datePickerStyle(.compact)
            }

            Text(reminderStatus)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
    }

    var syncButton: some View {
        Button {
            Task { await sync() }
        } label: {
            Label(status.label, systemImage: status.icon)
                .frame(maxWidth: .infinity)
                .padding()
                .background(status.color.gradient)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .font(.headline)
        }
        .disabled(status == .syncing)
    }

    var serverRow: some View {
        HStack {
            Image(systemName: "wifi")
                .foregroundStyle(.secondary)
            Text(serverURL)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer()
            Button("Edit") { showURLEditor = true }
                .font(.caption)
        }
        .padding(.horizontal, 4)
        .sheet(isPresented: $showURLEditor) {
            URLEditorView(url: $serverURL)
                .presentationDetents([.height(180)])
        }
    }

    var deviceURLWarning: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Use your Mac's LAN address on a real iPhone")
                .font(.headline)
            Text("`localhost` points to the phone itself. Replace it with your Mac's local IP, for example `http://192.168.1.23:3030`.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(.yellow.opacity(0.14), in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(.yellow.opacity(0.45), lineWidth: 1)
        )
    }

    func dataPreview(_ d: HealthPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Last synced")
                .font(.caption).foregroundStyle(.secondary)
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                row("😴 Sleep", "\(String(format: "%.1f", d.sleep)) hrs")
                row("👟 Steps", "\(Int(d.steps).formatted()) / day")
                row("🏃 Exercise", "\(String(format: "%.0f", d.exercise)) days/wk")
                row("💧 Water", "\(String(format: "%.0f", d.water)) glasses")
                row("📱 Screen", "\(screenTimeLabel(d.screenTime)) / day")
                row("❤️ Heart", "\(String(format: "%.0f", d.heartRate)) bpm")
                row("🧘 Stress", "\(String(format: "%.0f", d.stress)) / 10")
            }
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    func row(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).font(.caption)
            Text(value).font(.caption).bold()
        }
    }

    func sync() async {
        status = .syncing
        do {
            try await hk.requestAuth()

            async let steps = hk.avgSteps()
            async let sleep = hk.lastSleepHours()
            async let exercise = hk.exerciseDaysPerWeek()
            async let water = hk.avgWaterGlasses()
            async let hr = hk.avgHeartRate()
            async let history = hk.last7DayHistory()

            let (s, sl, ex, w, h, hist) = await (steps, sleep, exercise, water, hr, history)

            let stressProxy = min(10, max(1, ((h - 50) / 5).rounded()))

            let payload = HealthPayload(
                sleep: max(0, min(12, sl)),
                exercise: max(0, min(7, ex)),
                water: max(0, min(20, w)),
                steps: max(0, min(30000, s)),
                screenTime: max(0, min(16, manualScreenTime)),
                diet: 5,
                heartRate: max(0, h),
                stress: stressProxy,
                smoking: 0,
                alcohol: 0,
                history: HealthHistory(days: hist)
            )

            try await post(payload)
            lastData = payload
            status = .done
        } catch {
            status = .error(error.localizedDescription)
        }
    }

    func post(_ payload: HealthPayload) async throws {
        guard let url = URL(string: "\(serverURL)/api/health-sync") else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(payload)
        let (_, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
    }

    func handleReminderToggle(_ enabled: Bool) async {
        if enabled {
            await rescheduleReminderIfNeeded()
        } else {
            await removeReminder()
            reminderStatus = "Daily reminders are off."
        }
    }

    func refreshReminderStatus() async {
        if dailyReminderEnabled {
            await rescheduleReminderIfNeeded()
        } else {
            reminderStatus = "Daily reminders are off."
        }
    }

    func rescheduleReminderIfNeeded() async {
        guard dailyReminderEnabled else {
            reminderStatus = "Daily reminders are off."
            return
        }

        do {
            let granted = try await requestNotificationAuthorizationIfNeeded()
            guard granted else {
                dailyReminderEnabled = false
                reminderStatus = "Notifications were not allowed, so reminders stayed off."
                return
            }
            try await scheduleDailyReminder()
            reminderStatus = "Daily reminder scheduled for \(formattedReminderTime)."
        } catch {
            reminderStatus = "Couldn't schedule the reminder: \(error.localizedDescription)"
        }
    }

    func requestNotificationAuthorizationIfNeeded() async throws -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await notificationSettings(center)

        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied:
            return false
        case .notDetermined:
            return try await withCheckedThrowingContinuation { continuation in
                center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume(returning: granted)
                    }
                }
            }
        @unknown default:
            return false
        }
    }

    func scheduleDailyReminder() async throws {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [Self.reminderIdentifier])

        let content = UNMutableNotificationContent()
        content.title = "Future You check-in"
        content.body = "Log your habits, protect your screen-time boundary, and leave a quick reflection for tomorrow."
        content.sound = .default

        let trigger = UNCalendarNotificationTrigger(
            dateMatching: DateComponents(hour: dailyReminderHour, minute: dailyReminderMinute),
            repeats: true
        )
        let request = UNNotificationRequest(
            identifier: Self.reminderIdentifier,
            content: content,
            trigger: trigger
        )

        try await withCheckedThrowingContinuation { continuation in
            center.add(request) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    func removeReminder() async {
        UNUserNotificationCenter.current()
            .removePendingNotificationRequests(withIdentifiers: [Self.reminderIdentifier])
    }

    func notificationSettings(_ center: UNUserNotificationCenter) async -> UNNotificationSettings {
        await withCheckedContinuation { continuation in
            center.getNotificationSettings { settings in
                continuation.resume(returning: settings)
            }
        }
    }

    func screenTimeLabel(_ hours: Double) -> String {
        let rounded = (hours * 10).rounded() / 10
        return rounded == floor(rounded)
            ? String(format: "%.0f h", rounded)
            : String(format: "%.1f h", rounded)
    }

    static func makeReminderDate(hour: Int, minute: Int) -> Date {
        let now = Date()
        let current = Calendar.current.dateComponents([.year, .month, .day], from: now)
        return Calendar.current.date(
            from: DateComponents(
                year: current.year,
                month: current.month,
                day: current.day,
                hour: hour,
                minute: minute
            )
        ) ?? now
    }
}

struct HealthPayload: Codable {
    var sleep: Double
    var exercise: Double
    var water: Double
    var steps: Double
    var screenTime: Double
    var diet: Double
    var heartRate: Double
    var stress: Double
    var smoking: Double
    var alcohol: Double
    var history: HealthHistory?
}

struct HealthHistory: Codable {
    var days: [DailyHealthSample]
}

enum SyncStatus: Equatable {
    case idle, syncing, done, error(String)

    var label: String {
        switch self {
        case .idle: return "Sync Apple Health"
        case .syncing: return "Reading health data…"
        case .done: return "Synced!"
        case .error(let e): return "Error: \(e)"
        }
    }

    var icon: String {
        switch self {
        case .idle: return "arrow.trianglehead.2.clockwise"
        case .syncing: return "clock"
        case .done: return "checkmark.circle.fill"
        case .error: return "exclamationmark.triangle"
        }
    }

    var color: Color {
        switch self {
        case .idle: return .blue
        case .syncing: return .gray
        case .done: return .green
        case .error: return .red
        }
    }
}

struct URLEditorView: View {
    @Binding var url: String
    @Environment(\.dismiss) var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Text("Server URL").font(.headline)
            TextField("http://...", text: $url)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
            Text("On a real iPhone, use your Mac's local network IP and keep the Node server running on port 3030.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("Done") { dismiss() }
                .buttonStyle(.borderedProminent)
        }
        .padding(24)
    }
}
