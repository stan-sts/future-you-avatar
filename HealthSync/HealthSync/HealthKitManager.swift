import HealthKit
import Foundation

private extension Int {
    func toDouble() -> Double { Double(self) }
}

struct DailyHealthSample: Codable {
    var date: String
    var sleep: Double
    var steps: Double
    var activeEnergy: Double
    var heartRate: Double?
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
        let cal = Calendar.current
        let results: [Double] = await withTaskGroup(of: Double.self) { group in
            for offset in 0..<7 {
                let day   = cal.date(byAdding: .day, value: -offset, to: Date())!
                let start = cal.startOfDay(for: day)
                let end   = cal.date(byAdding: .day, value: 1, to: start)!
                group.addTask { await self.querySum(.activeEnergyBurned, unit: .kilocalorie(), start: start, end: end) }
            }
            var all: [Double] = []
            for await v in group { all.append(v) }
            return all
        }
        return results.filter { $0 >= 300 }.count.toDouble()
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
        let heartRateMap = await heartRateHistory(days: 7)

        let samples: [(Date, Double, Double)] = await withTaskGroup(of: (Date, Double, Double).self) { group in
            for offset in stride(from: 6, through: 0, by: -1) {
                let day   = cal.date(byAdding: .day, value: -offset, to: Date())!
                let start = cal.startOfDay(for: day)
                let end   = cal.date(byAdding: .day, value: 1, to: start)!
                group.addTask {
                    async let steps  = self.querySum(.stepCount, unit: .count(), start: start, end: end)
                    async let energy = self.querySum(.activeEnergyBurned, unit: .kilocalorie(), start: start, end: end)
                    return (start, await steps, await energy)
                }
            }
            var all: [(Date, Double, Double)] = []
            for await v in group { all.append(v) }
            return all.sorted { $0.0 < $1.0 }
        }

        return samples.map { (start, steps, activeEnergy) in
            DailyHealthSample(
                date: formatter.string(from: start),
                sleep: sleepMap[start] ?? 0,
                steps: steps,
                activeEnergy: activeEnergy,
                heartRate: heartRateMap[start],
                workoutMetGoal: activeEnergy >= 300
            )
        }
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

    private func heartRateHistory(days: Int) async -> [Date: Double] {
        let cal = Calendar.current
        let unit = HKUnit.count().unitDivided(by: .minute())
        return await withTaskGroup(of: (Date, Double).self) { group in
            for offset in stride(from: days - 1, through: 0, by: -1) {
                let day   = cal.date(byAdding: .day, value: -offset, to: Date())!
                let start = cal.startOfDay(for: day)
                let end   = cal.date(byAdding: .day, value: 1, to: start)!
                group.addTask { (start, await self.queryAverage(.heartRate, unit: unit, start: start, end: end)) }
            }
            var buckets: [Date: Double] = [:]
            for await (date, avg) in group where avg > 0 { buckets[date] = avg }
            return buckets
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

    private func queryAverage(_ id: HKQuantityTypeIdentifier, unit: HKUnit,
                              start: Date, end: Date) async -> Double {
        let pred = HKQuery.predicateForSamples(withStart: start, end: end)
        let type = HKQuantityType(id)

        return await withCheckedContinuation { cont in
            let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: pred,
                                      options: .discreteAverage) { _, stats, _ in
                cont.resume(returning: stats?.averageQuantity()?.doubleValue(for: unit) ?? 0)
            }
            self.store.execute(q)
        }
    }
}
