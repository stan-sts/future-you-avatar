# Future You Product Logic

## One-line Product Summary
`Future You` is a 3-step demo that takes a user's selfie, current health baseline, and goal, then generates two future avatar projections:

- `Current Path`: how the user may look in 6 months if current habits continue
- `Ideal Path`: a healthier, evidence-based improved version of the same person in 6 months

The results page also shows daily progress and a 7-day evidence board using Apple Health data when available, with manual fallback for today's missing values.

## Core User Flow
### Step 1: Portrait Input
- User uploads a clear selfie.
- The image is resized in-browser and stored in frontend state.
- This selfie is the visual reference for both generated future avatars.

### Step 2: Current Baseline and Goal
- User enters their real current baseline.
- Inputs can be manual sliders or partially overwritten by Apple Health sync.
- This page is not for designing an "ideal" lifestyle manually.
- The user also enters:
  - current weight
  - target weight
  - timeframe: 3 months, 6 months, or 1 year

### Step 2.5: Today's Progress
- User can connect Apple Health through the iPhone companion app.
- If Apple Health is missing or incomplete, the user can manually enter today's:
  - sleep
  - active energy
  - steps
  - heart rate

This is important because the app should still be usable even when Apple Watch sync is unavailable.

### Step 3: Future Projection
- The app calculates two future outcomes from the same person:
  - `Current Self In 6 Months`
  - `Ideal Self In 6 Months`
- Each side gets:
  - a generated 2D face variation
  - a generated 3D avatar model
  - a coach message
- The page also shows:
  - a science/plan card
  - a daily "Today vs Ideal Path" match board
  - a 7-day recovery/workout evidence ledger from Apple Health history

## Product Logic
### 1. Baseline vs Ideal
The app compares two futures built from the same starting face:

- `Current Path` uses the user's actual current habits
- `Ideal Path` uses an evidence-based target habit profile, not a custom user-designed second profile

This is the key product idea:

- one future = if nothing changes
- one future = healthier/improved you if you follow ideal targets

## 2. What counts as the user's current baseline
The current baseline currently includes:

- sleep
- exercise days per week
- water
- steps
- diet quality
- stress
- smoking
- alcohol

These come from:

- manual sliders in the web app
- Apple Health sync where available

Apple Health currently fills or influences:

- sleep
- exercise estimate from active energy
- water
- steps
- heart rate
- stress proxy derived from average heart rate

The frontend applies synced data into the sliders when the user connects.

## 3. What the ideal version means
The ideal future is not a fantasy character and not a separate custom persona.
It is meant to be:

- the same person
- recognizable from the original selfie
- healthier and more recovered
- based on evidence-backed target habits

The current ideal targets in code are:

- sleep: 8 hours
- exercise: 5 days/week
- water: 8 glasses/day
- steps: 10,000/day
- diet: 8/10
- stress: 3/10
- smoking: 0
- alcohol: 3/week

## 4. Prediction model
The prediction engine is currently rule-based, not ML-personalized.

It does three things:

1. Calculates a health score from current habits
2. Projects a `current path` score from the user's actual habits
3. Projects an `ideal path` score from the fixed ideal habit targets

It then derives metrics like:

- energy
- skin health
- sleep quality
- age shift
- weight drift

These values also help shape the text and avatar prompt.

## 5. Avatar generation logic
Each avatar is generated in two stages:

1. `2D image generation`
   - The uploaded selfie plus a scenario-specific prompt is sent to the image model.
   - This creates a modified realistic portrait for either current-path or ideal-path future.

2. `3D avatar generation`
   - That generated 2D image is then sent to Tencent's 3D generation endpoint.
   - The returned model is displayed with `model-viewer`.

So the final 3D avatar is not created directly from the selfie.
It is created from the scenario-specific 2D future image first.

## 6. Apple Health logic
There is a separate iPhone app called `HealthSync`.

Its job is:

- request HealthKit permission
- read recent Apple Health data
- send it to the Node server

The iPhone app currently sends:

- avg steps
- last sleep hours
- exercise days/week estimate
- avg water intake
- avg heart rate
- stress proxy
- 7-day history of:
  - date
  - sleep
  - steps
  - active energy
  - heart rate
  - workoutMetGoal

The web app does not read Apple Health directly.
It only reads synced data from the local server endpoint.

## 7. Daily progress logic on page 3
The results page has a `Today's Progress` section.

This mixes two data sources:

- Apple Health for today, if available
- manual frontend entry for missing fields

The priority is:

1. Apple Health synced value
2. manual value entered in Step 2
3. missing/awaiting state

Current daily signals shown:

- sleep
- active energy
- steps
- heart rate

## 8. Daily goal-match bar
The new daily bar system answers:

`How similar is today's real behavior to the ideal path?`

It computes a match percentage for:

- sleep vs 8h target
- active energy vs 300 kcal target
- steps vs 10,000 target
- heart rate vs recovery band target

Then it averages available signals into an overall `% match`.

This means page 3 is not just static future output anymore.
It is also a daily tracking screen that can update over time.

## 9. 7-day evidence ledger
The recovery/workout ledger is intentionally stricter now.

Important rule:

- if real Apple Health history is missing, the app does not invent streaks from sliders

When sync exists, the ledger shows real 7-day evidence:

- sleep streak
- workout streak
- daily sleep
- daily active energy
- daily steps

The purpose is to make the app feel grounded in real observed behavior, not fake progress.

## 10. Weight goal logic
The user sets:

- current weight
- target weight
- timeframe

The app calculates:

- kilograms to lose
- daily calorie deficit needed
- diet portion of the deficit
- exercise portion of the deficit
- approximate extra steps/day
- feasibility warning if the plan exceeds safe limits

This appears in the science card on the results page.

## 11. Current backend responsibilities
The Node/Express server currently does four main jobs:

- serves the frontend
- stores the latest Apple Health sync in memory
- calls Google image generation for the future face image
- calls Tencent 3D generation and proxies the model file

Important limitation:

- Apple Health sync is currently in-memory only, not stored in a database
- this is demo-grade, single-user-ish behavior right now

## 12. Current product framing
The cleanest way to explain the experience is:

`Upload your face, define your real baseline, sync today's health data, and compare two futures: the version of you that continues current habits and the improved version of you that follows ideal health targets. Then use the daily progress board to see how close today's behavior is to that ideal path.`

## Good next features someone else could add
- Persist users and Apple Health history in a real database
- Add more signals like resting heart rate trends, weight history, or HRV
- Make the ideal plan more personalized instead of fully fixed
- Add daily/weekly coaching based on gap to the ideal path
- Show trend lines over time instead of only today's match and 7-day ledger
- Add reminders, streak rewards, or goal nudges

## Important implementation files
- [index.html](/Users/sandytan/Downloads/Hackathon/index.html)
- [app.js](/Users/sandytan/Downloads/Hackathon/app.js)
- [predict.js](/Users/sandytan/Downloads/Hackathon/predict.js)
- [server.js](/Users/sandytan/Downloads/Hackathon/server.js)
- [HealthKitManager.swift](/Users/sandytan/Downloads/Hackathon/HealthSync/HealthSync/HealthKitManager.swift)
- [ContentView.swift](/Users/sandytan/Downloads/Hackathon/HealthSync/HealthSync/ContentView.swift)
