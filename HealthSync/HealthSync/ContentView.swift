import SwiftUI
import HealthKit

struct ContentView: View {
    @StateObject private var hk = HealthKitManager()
    @AppStorage("serverURL") private var serverURL = "http://localhost:3030"

    @State private var status: SyncStatus = .idle
    @State private var lastData: HealthPayload?
    @State private var showURLEditor = false

    private var isUsingLocalhostOnDevice: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return serverURL.contains("localhost") || serverURL.contains("127.0.0.1")
        #endif
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 32) {
                header
                if isUsingLocalhostOnDevice { deviceURLWarning }
                if let d = lastData { dataPreview(d) }
                syncButton
                serverRow
            }
            .padding(24)
            .navigationTitle("Future You Sync")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    // ── Sub-views ────────────────────────────────────────────────────────────────

    var header: some View {
        VStack(spacing: 8) {
            Image(systemName: "applewatch")
                .font(.system(size: 56))
                .foregroundStyle(.blue.gradient)
            Text("Apple Health → Future You")
                .font(.headline)
            Text("Reads your last 7 days and sends it to the web app.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
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
                row("😴 Sleep",    "\(String(format: "%.1f", d.sleep)) hrs")
                row("👟 Steps",    "\(Int(d.steps).formatted()) / day")
                row("🏃 Exercise", "\(String(format: "%.0f", d.exercise)) days/wk")
                row("💧 Water",    "\(String(format: "%.0f", d.water)) glasses")
                row("❤️ Heart",    "\(String(format: "%.0f", d.heartRate)) bpm")
                row("🧘 Stress",   "\(String(format: "%.0f", d.stress)) / 10")
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

    // ── Sync logic ───────────────────────────────────────────────────────────────

    func sync() async {
        status = .syncing
        do {
            try await hk.requestAuth()

            async let steps    = hk.avgSteps()
            async let sleep    = hk.lastSleepHours()
            async let exercise = hk.exerciseDaysPerWeek()
            async let water    = hk.avgWaterGlasses()
            async let hr       = hk.avgHeartRate()
            async let history  = hk.last7DayHistory()

            let (s, sl, ex, w, h, hist) = await (steps, sleep, exercise, water, hr, history)

            // Map avg HR to a 1-10 stress proxy (60 bpm → 3, 90 bpm → 8)
            let stressProxy = min(10, max(1, ((h - 50) / 5).rounded()))

            let payload = HealthPayload(
                sleep:    max(0, min(12, sl)),
                exercise: max(0, min(7,  ex)),
                water:    max(0, min(20, w)),
                steps:    max(0, min(30000, s)),
                diet:     5,   // no direct HealthKit equivalent
                heartRate: max(0, h),
                stress:   stressProxy,
                smoking:  0,
                alcohol:  0,
                history:  HealthHistory(days: hist)
            )

            try await post(payload)
            lastData = payload
            status   = .done
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
}

// ── Supporting types ─────────────────────────────────────────────────────────

struct HealthPayload: Codable {
    var sleep: Double
    var exercise: Double
    var water: Double
    var steps: Double
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
        case .idle:        return "Sync Apple Health"
        case .syncing:     return "Reading health data…"
        case .done:        return "Synced!"
        case .error(let e): return "Error: \(e)"
        }
    }

    var icon: String {
        switch self {
        case .idle:    return "arrow.trianglehead.2.clockwise"
        case .syncing: return "clock"
        case .done:    return "checkmark.circle.fill"
        case .error:   return "exclamationmark.triangle"
        }
    }

    var color: Color {
        switch self {
        case .idle:    return .blue
        case .syncing: return .gray
        case .done:    return .green
        case .error:   return .red
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
