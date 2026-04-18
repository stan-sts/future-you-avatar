import HealthKit
import Foundation

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

    // ── Helpers ─────────────────────────────────────────────────────────────────

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
