---
status: approved
---

# Design brief: B2B Guided Maintenance & Procurement Demo

<!-- Filled in by plan-lens from the learner's interview. Use the learner's words. Mark any value they didn't choose as (default). -->

## The one spatial moment
A Field Service Engineer stands at an open blade server rack in a data center. A red bounding box highlights a failed hot-swappable power supply unit (PSU) in Slot 2, and a minimalist 3-step repair checklist floats just to the right of the rack. They pull the failed PSU out, slide the replacement in, and pinch "Step 1: Swap Complete". The UI flashes green, a System Audit Log shows the BlocTi event log and the stoQr inventory/procurement update, and a 3D arrow points to the server's power button for Step 2.

## Why it belongs on glasses
- Uses: draws in the world, leaves your body free.
- Why it's better than the phone or laptop version: the engineer's hands are in the rack and their eyes stay on the hardware. The fault highlight sits on the actual slot, the checklist is a minor head turn away, and confirming a step automatically logs the work and reorders the part. Nobody has to put down a tool to type into a laptop.

## Product or overlay
- Type: overlay: it responds to a real server rack.
- What the real version would sense: the physical rack position and the failed PSU (automated fault detection), and machine state (boot status).
- Stand-in for the preview:
  - **The rack:** a 1:1 virtual server rack that the engineer places on the floor.
  - **Fault detection:** a "Run Hardware Diagnostics" button. Pinching it hides the button, sweeps a 1-second blue scan line down the rack, then lights a red bounding box around PSU Slot 2. The fault is always PSU Slot 2 (hard-coded).
  - **The physical swap:** virtual PSUs the engineer grabs and drags.
  - **Reading machine state:** pinching the virtual power button starts the LED boot sequence. Step 2 then ticks off automatically when the LEDs turn solid green.
  - **Backend calls:** `USE_MOCK_API = true` by default (see Build notes).

## Where things live
- Where the user is looking during the main task: the target blade server chassis at chest height. Their hands are on the PSU, and the checklist sits in their immediate peripheral vision.
- Engineer's standing spot: about 1 m in front of the rack.
- Virtual server rack: on the floor where the engineer pinches to anchor it, facing the engineer. Real size, about 60 cm wide × 200 cm tall × 100 cm deep (default). Before anchoring, a transparent "ghost" outline of the rack follows the user's gaze on the floor.
- Target blade server chassis: in the rack at chest height, about 1.3 m off the floor.
- PSU Slot 2: on the right side of that chassis. Each PSU is about 5 × 8 × 20 cm (default).
- Power button: on the same chassis, a few inches (about 8 cm) to the left of the PSUs.
- LED indicators: on the same chassis front, next to the power button (default).
- "Run Hardware Diagnostics" button: in a floating UI panel next to the rack. It appears after anchoring, in the same spot as the checklist (default).
- Checklist panel: chest height (about 1.3 m), 30 cm to the right of the rack's outer edge, about 15 cm in front of the rack's front plane, angled about 15° inward toward the engineer. About 30 × 25 cm (default).
- Replacement PSU: spawns floating next to the checklist panel, glowing slightly to mark it as the replacement part.
- Failed PSU drop zone: anywhere to the side, away from the slot. Once released there, it fades out.
- System Audit Log panel: slides out from the right side of the checklist, at the same height and angle, about 30 × 20 cm (default).
- Step 2 arrow: a pulsing 3D arrow pointing at the power button, just above or beside it (default).
- Telemetry graph: a small floating holographic graph next to the rack. It sits at chest height on the left side of the chassis (default), so it stays in the same view window as the work zone.
- "Maintenance Complete" badge: hovers over the rack, just above the target chassis (default).
- Styling: no dark backgrounds anywhere. Panels use a glowing white wireframe border with high-contrast cyan and bright white text.

## Hands and input
- Anchor the rack: pinch on the floor while the ghost outline is shown.
- Run diagnostics: pinch the "Run Hardware Diagnostics" button.
- Remove the failed PSU: grab and drag the failed PSU out of Slot 2 and drop it to the side.
- Insert the replacement: grab and drag the glowing replacement PSU toward Slot 2. When it gets close (within about 5 cm, default), it snaps into place.
- Confirm the swap: pinch "Step 1: Swap Complete". It is grayed out and disabled until the replacement PSU has snapped in.
- Boot: pinch the virtual power button. This is a pinch, not a poke, so the interaction model stays consistent: pinch to place, pinch to confirm, pinch to boot.
- Close the ticket: pinch "Close Ticket".
- Targets are big and highlight when aimed at.
- Voice: none.

## When things show
- Ghost rack outline: shows at Lens start (surface placement on the floor) and hides once the rack is anchored.
- Virtual rack: shows when anchored and fades out at the very end, resetting the Lens to the empty room state.
- "Run Hardware Diagnostics" button: shows once the rack is anchored and disappears when pinched.
- Blue scan line: about 1 second, sweeping down the rack right after diagnostics is pinched.
- Red bounding box on PSU Slot 2: lights up when the scan ends and hides when the replacement PSU snaps in (default).
- Checklist panel: fades in to the right of the rack when the red box lights up, and stays through Step 3.
- Failed PSU: interactable once the red box appears. It fades out when dropped away from the rack.
- Replacement PSU: spawns next to the checklist once the failed PSU has been removed.
- "Step 1: Swap Complete": grayed out until the replacement snaps in, then active. Pinching it turns it green.
- System Audit Log (Step 1): slides out right after Step 1 is confirmed. Two terminal-style text blocks type out:
  - `[BlocTi API]: Event Logged. Task: PSU_Swap. Time: 45s. Fidelity: 100%.`
  - `[stoQr API]: Stock Alert: PSU dropped to 'Low'. Reorder queued at £145.00.`
  It stays visible for 5 seconds, then fades out smoothly.
- Checklist "Step 2: Boot Diagnostics" and pulsing arrow: show after Step 1 is confirmed. The arrow hides when the power button is pinched (default).
- LED boot sequence: runs from amber to green after the power button is pinched. When the LEDs are solid green, Step 2 ticks off automatically, with no pinch needed.
- Telemetry graph: appears when Step 2 ticks off, showing simulated live telemetry (for example "Power Draw: Normal"). The checklist updates to "Step 3: Close Ticket" at the same time.
- System Audit Log (Step 3): flashes one final time when "Close Ticket" is pinched, showing `[BlocTi API]: Task Complete. Total Duration: 2m 14s. Fidelity: 100%. Ticket Closed.` (stoQr already ran in Step 1.)
- Ending: the telemetry graph, Audit Log and checklist fold inward and shrink away to nothing. A bright glowing "Maintenance Complete" badge hovers over the rack for 3 seconds, then the whole virtual rack fades out and the Lens resets to the empty room.
- If something needs attention out of view: everything is grouped in one chest-height work zone, and the Step 2 arrow points to the power button. No other cues.

## Backend behavior
- All network logic lives in `DualBackendManager.js`, with `const USE_MOCK_API = true;` as the default.
- `USE_MOCK_API = true`: skip the real HTTP/Supabase calls, wait 500 ms to simulate network latency, then trigger the Audit Log animation with hard-coded success data (the payloads above).
- `USE_MOCK_API = false`: attempt the real calls. The BlocTi call logs the timestamp, task ID and time-to-completion for the step. The stoQr call (Supabase) deducts one PSU from local inventory, sets its state to "Low", and pushes it to the automated procurement list. The Audit Log animation runs only after a 200 OK. If a real call fails, fall back to the mock data and change the Audit Log text color to yellow to show an offline sync state.
- The real endpoints and keys are placeholders. The Lens must compile and run immediately in mock mode without any API keys.

## Done criteria
Each one can be checked in Lens Studio's preview.
1. **Anchor & Initialize:** Pinching the floor anchors the virtual server rack in the scene and spawns the floating "Run Hardware Diagnostics" button.
2. **Diagnostics Trigger:** Pinching "Run Hardware Diagnostics" hides the button, plays a blue scan line animation down the rack, highlights PSU Slot 2 with a red box, and reveals the checklist panel.
3. **The Swap & Gate:** Dragging the glowing virtual replacement PSU into Slot 2 makes it snap into place. Only after it snaps does the grayed-out "Step 1: Swap Complete" button become active and clickable.
4. **Mock API Verification:** Pinching the active Step 1 button turns it green, updates the checklist to Step 2, and slides out the System Audit Log panel showing the mock BlocTi and stoQr success payloads.
5. **End-to-End Completion:** Pinching the rack's power button triggers the green LED boot sequence and updates the checklist to Step 3. Pinching "Close Ticket" hides the UI and spawns the "Maintenance Complete" badge before the scene resets.

## Out of scope
- Real recognition of a physical rack, PSU or fault. Fault detection is the diagnostics button, and the fault is always PSU Slot 2.
- Reading real machine state. The boot is simulated by the power button pinch.
- Live calls to BlocTi and stoQr in the default build. They stay behind `USE_MOCK_API = false`, with no keys in the project.
- Voice, poke and custom gestures.
- Multiple faults, multiple racks, or remembering anything between sessions.

## Risks and open questions
- Real API calls (`USE_MOCK_API = false`) are untested in this build. Network requests may not get through in the preview, which is why mock mode is the default for the demo.
- The red box over a real failed slot and the automatic Step 2 tick depend on real fault detection and machine telemetry. These only exist as stand-ins here.
- Feel unproven: comfort of reaching into a chest-height chassis over a full repair, real hand-tracking for grabbing small PSUs, and how readable the wireframe panels are on real glasses.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources
