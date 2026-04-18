import SwiftUI
import HealthKit

struct ContentView: View {
    @StateObject private var hk = HealthKitManager()
    @AppStorage("serverURL") private var serverURL = "http://localhost:3030"

    @State private var status: SyncStatus = .idle
    @State private var lastData: HealthPayload?
    @State private var showURLEditor = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 32) {
                header
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

    func dataPreview(_ d: HealthPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Last synced")
                .font(.caption).foregroundStyle(.secondary)
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                row("😴 Sleep",    "\(d.sleep, specifier: "%.1f") hrs")
                row("👟 Steps",    "\(Int(d.steps).formatted()) / day")
                row("🏃 Exercise", "\(d.exercise, specifier: "%.0f") days/wk")
                row("💧 Water",    "\(d.water, specifier: "%.0f") glasses")
                row("🧘 Stress",   "\(d.stress, specifier: "%.0f") / 10")
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

            let (s, sl, ex, w, h) = await (steps, sleep, exercise, water, hr)

            // Map avg HR to a 1-10 stress proxy (60 bpm → 3, 90 bpm → 8)
            let stressProxy = min(10, max(1, ((h - 50) / 5).rounded()))

            let payload = HealthPayload(
                sleep:    max(0, min(12, sl)),
                exercise: max(0, min(7,  ex)),
                water:    max(0, min(20, w)),
                steps:    max(0, min(30000, s)),
                diet:     5,   // no direct HealthKit equivalent
                stress:   stressProxy,
                smoking:  0,
                alcohol:  0
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
    var stress: Double
    var smoking: Double
    var alcohol: Double
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
            Button("Done") { dismiss() }
                .buttonStyle(.borderedProminent)
        }
        .padding(24)
    }
}
