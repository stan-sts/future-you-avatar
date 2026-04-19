import HealthKit
import Foundation

struct DailyHealthSample: Codable {
    var date: String
    var sleep: Double
    var steps: Double
    var activeEnergy: Double
    var workoutMetGoal: Bool
}

class HealthKitManager: ObservableObject {
    let store = HKHealthStore()

    private let readTypes: Set<HKSampleType> = [
        HKQuantityType(.stepCount),
        HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.heartRate),
        HKQuantityType(.dietaryWater),
        HKQuantityType(.bodyMass),
        HKCategoryType(.sleepAnalysis),
    ]

    func requestAuth() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw NSError(domain: "HealthKit", code: 0,
                          userInfo: [NSLocalizedDescriptionKey: "Health data not available on this device"])
        }
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    // Returns the last 7-day average steps per day
    func avgSteps() async -> Double {
        await querySum(.stepCount, unit: .count(), days: 7) / 7
    }

    // Returns last night's sleep in hours
    func lastSleepHours() async -> Double {
        let end   = Date()
        let start = Calendar.current.date(byAdding: .day, value: -1, to: end)!
        let pred  = HKQuery.predicateForSamples(withStart: start, end: end)
        let type  = HKCategoryType(.sleepAnalysis)

        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: pred, limit: HKObjectQueryNoLimit,
                                   sortDescriptors: nil) { _, samples, _ in
                guard let samples = samples as? [HKCategorySample] else { cont.resume(returning: 0); return }
                let asleep = samples.filter {
                    $0.value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue ||
                    $0.value == HKCategoryValueSleepAnalysis.asleepCore.rawValue        ||
                    $0.value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue        ||
                    $0.value == HKCategoryValueSleepAnalysis.asleepREM.rawValue
                }
                let total = asleep.reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }
                cont.resume(returning: total / 3600)
            }
            self.store.execute(q)
        }
    }

    // Active energy last 7 days → estimate exercise days (>300 kcal = active day)
    func exerciseDaysPerWeek() async -> Double {
        var active = 0.0
        for offset in 0..<7 {
            let cal   = Calendar.current
            let day   = cal.date(byAdding: .day, value: -offset, to: Date())!
            let start = cal.startOfDay(for: day)
            let end   = cal.date(byAdding: .day, value: 1, to: start)!
            let kcal  = await querySum(.activeEnergyBurned, unit: .kilocalorie(),
                                       start: start, end: end)
            if kcal >= 300 { active += 1 }
        }
        return active
    }

    // Average resting heart rate → proxy for stress (high HR = high stress)
    func avgHeartRate() async -> Double {
        let end   = Date()
        let start = Calendar.current.date(byAdding: .day, value: -7, to: end)!
        let pred  = HKQuery.predicateForSamples(withStart: start, end: end)
        let type  = HKQuantityType(.heartRate)
        let unit  = HKUnit.count().unitDivided(by: .minute())

        return await withCheckedContinuation { cont in
            let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: pred,
                                       options: .discreteAverage) { _, stats, _ in
                let val = stats?.averageQuantity()?.doubleValue(for: unit) ?? 0
                cont.resume(returning: val)
            }
            self.store.execute(q)
        }
    }

    // Water intake average (glasses, 250 ml each)
    func avgWaterGlasses() async -> Double {
        let ml = await querySum(.dietaryWater, unit: .literUnit(with: .milli), days: 7) / 7
        return (ml / 250).rounded()
    }

    // Daily history for the web streak board
    func last7DayHistory() async -> [DailyHealthSample] {
        let cal = Calendar.current
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        let sleepMap = await sleepHistory(days: 7)

        var days: [DailyHealthSample] = []
        for offset in stride(from: 6, through: 0, by: -1) {
            let day = cal.date(byAdding: .day, value: -offset, to: Date())!
            let start = cal.startOfDay(for: day)
            let end = cal.date(byAdding: .day, value: 1, to: start)!
            let steps = await querySum(.stepCount, unit: .count(), start: start, end: end)
            let activeEnergy = await querySum(.activeEnergyBurned, unit: .kilocalorie(), start: start, end: end)

            days.append(DailyHealthSample(
                date: formatter.string(from: start),
                sleep: sleepMap[start] ?? 0,
                steps: steps,
                activeEnergy: activeEnergy,
                workoutMetGoal: activeEnergy >= 300
            ))
        }
        return days
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────

    private func sleepHistory(days: Int) async -> [Date: Double] {
        let cal = Calendar.current
        let end = Date()
        let start = cal.startOfDay(for: cal.date(byAdding: .day, value: -(days - 1), to: end)!)
        let finish = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: end))!
        let pred = HKQuery.predicateForSamples(withStart: start, end: finish)
        let type = HKCategoryType(.sleepAnalysis)

        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: pred, limit: HKObjectQueryNoLimit,
                                  sortDescriptors: nil) { _, samples, _ in
                guard let samples = samples as? [HKCategorySample] else {
                    cont.resume(returning: [:])
                    return
                }

                var buckets: [Date: Double] = [:]
                for sample in samples where
                    sample.value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue ||
                    sample.value == HKCategoryValueSleepAnalysis.asleepCore.rawValue ||
                    sample.value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue ||
                    sample.value == HKCategoryValueSleepAnalysis.asleepREM.rawValue {
                    let bucket = cal.startOfDay(for: sample.endDate)
                    guard bucket >= start, bucket < finish else { continue }
                    buckets[bucket, default: 0] += sample.endDate.timeIntervalSince(sample.startDate) / 3600
                }

                cont.resume(returning: buckets)
            }
            self.store.execute(q)
        }
    }

    private func querySum(_ id: HKQuantityTypeIdentifier, unit: HKUnit,
                          days: Int) async -> Double {
        let end   = Date()
        let start = Calendar.current.date(byAdding: .day, value: -days, to: end)!
        return await querySum(id, unit: unit, start: start, end: end)
    }

    private func querySum(_ id: HKQuantityTypeIdentifier, unit: HKUnit,
                          start: Date, end: Date) async -> Double {
        let pred = HKQuery.predicateForSamples(withStart: start, end: end)
        let type = HKQuantityType(id)

        return await withCheckedContinuation { cont in
            let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: pred,
                                       options: .cumulativeSum) { _, stats, _ in
                cont.resume(returning: stats?.sumQuantity()?.doubleValue(for: unit) ?? 0)
            }
            self.store.execute(q)
        }
    }
}
