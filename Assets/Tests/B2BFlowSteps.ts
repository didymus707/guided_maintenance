// B2BFlowSteps.ts — the guided-maintenance flow, one function per done criterion.
// Each step drives the Lens through real SIK interactions (B2BDriver) and asserts
// the criterion's observable outcome. Later scenarios reuse earlier steps to reach
// their starting state (every run_leaf_scenario resets the Lens).

import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {nextFrame, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {B2BDriver, B2BLens, log} from "./B2BTestKit"

/** Criterion 1 — pinch the floor/ghost: rack anchored + diagnostics button shown. */
export async function stepAnchor(lens: B2BLens, drv: B2BDriver, anchorTarget: string): Promise<void> {
  await lens.waitForPlacing()
  lens.snapshot("before anchor")
  expect(lens.obj("RackFrame").isEnabledInHierarchy, "rack hidden while placing").toBe(false)
  expect(lens.diagnostics.isVisible, "diagnostics hidden while placing").toBe(false)

  await drv.pinch(anchorTarget)
  await lens.waitFor(() => lens.state === "anchored", 3000, "state anchored")
  await sleep(300)
  lens.snapshot("after anchor")

  expect(lens.placement.isPlacing, "placement ended").toBe(false)
  expect(lens.obj("ServerRack").isEnabledInHierarchy, "ServerRack enabled").toBe(true)
  expect(lens.obj("RackFrame").isEnabledInHierarchy, "RackFrame visible").toBe(true)
  expect(lens.obj("TargetChassis").isEnabledInHierarchy, "TargetChassis visible").toBe(true)
  expect(lens.diagnostics.isVisible, "DiagnosticsPanel.isVisible").toBe(true)
  expect(lens.panelRootShown("DiagnosticsPanel"), "DiagnosticsPanel PanelRoot enabled").toBe(true)
  expect(lens.obj("RunDiagnosticsButton").isEnabledInHierarchy, "RunDiagnosticsButton enabled").toBe(true)
  drv.find("RunDiagnosticsButton") // must be an enabled SIK Interactable
}

/** Criterion 2 — pinch Run Hardware Diagnostics: button hides, scan sweeps, fault box, checklist. */
export async function stepDiagnostics(lens: B2BLens, drv: B2BDriver): Promise<void> {
  const scanLine = lens.obj("ScanLine")
  const ys: number[] = []
  let scanFrames = 0
  let monitoring = true
  const monitor = (async () => {
    while (monitoring) {
      if (scanLine.enabled) {
        scanFrames++
        ys.push(scanLine.getTransform().getLocalPosition().y)
      }
      await nextFrame()
    }
  })()

  await drv.pinch("RunDiagnosticsButton")
  expect(lens.diagnostics.isVisible, "diagnostics panel hidden right after pinch").toBe(false)
  await lens.waitFor(() => lens.state === "fault_detected", 4000, "state fault_detected")
  monitoring = false
  await monitor
  await sleep(500) // checklist pop-in
  lens.snapshot("after diagnostics")

  const hist: string[] = lens.main.stateHistory
  log(`scan line: visible frames=${scanFrames}, y first=${ys.length ? ys[0].toFixed(1) : "-"} last=${ys.length ? ys[ys.length - 1].toFixed(1) : "-"}`)
  expect(hist.indexOf("scanning") >= 0, "passed through scanning").toBe(true)
  expect(lens.panelRootShown("DiagnosticsPanel"), "Diagnostics PanelRoot disabled").toBe(false)
  expect(scanFrames, "scan line was visible for several frames").toBeGreaterThan(5)
  expect(ys[0] > ys[ys.length - 1], "scan line moved downward").toBe(true)
  expect(scanLine.enabled, "scan line hidden after sweep").toBe(false)
  expect(lens.rack.isFaultVisible, "rack.isFaultVisible").toBe(true)
  expect(lens.obj("FaultBox_PSU2").isEnabledInHierarchy, "FaultBox_PSU2 visible").toBe(true)
  expect(lens.checklist.isVisible, "checklist visible").toBe(true)
  expect(lens.panelRootShown("ChecklistPanel"), "Checklist PanelRoot enabled").toBe(true)
  expect(lens.checklist.activeStep, "checklist on step 1").toBe(1)
}

/** Criterion 3 — gate: Step 1 disabled until the replacement PSU snaps into Slot 2. */
export async function stepSwap(lens: B2BLens, drv: B2BDriver): Promise<void> {
  expect(lens.checklist.step1ButtonState, "Step 1 disabled before swap").toBe("disabled")
  expect(lens.obj("ReplacementPSU").enabled, "replacement hidden before failed PSU removed").toBe(false)

  // Pull the failed PSU >15 cm away from the slot (sideways + toward the user).
  const slot = lens.psus.getSlotWorldPosition() as vec3
  const cam = lens.obj("Camera Object").getTransform()
  const toUser = cam.getWorldPosition().sub(slot)
  const sideways = new vec3(toUser.z, 0, -toUser.x).normalize() // horizontal, perpendicular to view
  const pullGoal = slot.add(sideways.uniformScale(-25)).add(new vec3(0, -10, 0))
  const pulls = await drv.dragToward(
    "FailedPSU",
    () => pullGoal,
    () => lens.psus.isFailedRemoved || lens.obj("FailedPSU").getTransform().getWorldPosition().distance(slot) > 20,
    4,
  )
  log(`failed PSU drag attempts=${pulls}`)
  await lens.waitFor(() => lens.state === "failed_psu_removed", 3000, "state failed_psu_removed")
  lens.snapshot("after failed PSU removed")
  expect(lens.psus.isFailedRemoved, "psus.isFailedRemoved").toBe(true)
  expect(lens.checklist.step1ButtonState, "Step 1 still disabled after removal (gate)").toBe("disabled")
  expect(lens.obj("ReplacementPSU").isEnabledInHierarchy, "replacement spawned").toBe(true)

  // Slide the replacement into Slot 2: aim a point 8 cm in front of the slot face.
  const slotT = lens.obj("PSUSlot2Target").getTransform()
  const slotOut = slotT.getWorldRotation().multiplyVec3(new vec3(0, 0, 1))
  const insertGoal = () => (lens.psus.getSlotWorldPosition() as vec3).add(slotOut.uniformScale(8))
  let wasActiveEarly = false
  const unsub = (async () => {
    while (!lens.psus.isReplacementSeated && lens.state !== "replacement_seated") {
      if (lens.checklist.step1ButtonState === "active") wasActiveEarly = true
      await nextFrame()
      if (lens.state !== "failed_psu_removed") break
    }
  })()
  const inserts = await drv.dragToward("ReplacementPSU", insertGoal, () => lens.psus.isReplacementSeated, 6)
  log(`replacement PSU drag attempts=${inserts}`)
  await lens.waitFor(() => lens.psus.isReplacementSeated, 2000, "replacement seated")
  await unsub
  await lens.waitFor(() => lens.state === "replacement_seated", 2000, "state replacement_seated")
  lens.snapshot("after replacement seated")

  const seatedPos = lens.obj("ReplacementPSU").getTransform().getWorldPosition()
  const slotPos = lens.psus.getSlotWorldPosition() as vec3
  log(`seated replacement at distance ${seatedPos.distance(slotPos).toFixed(2)} cm from slot`)
  expect(wasActiveEarly, "Step 1 never active before the snap").toBe(false)
  expect(seatedPos.distance(slotPos), "replacement snapped onto slot pose").toBeLessThan(0.5)
  expect(lens.checklist.step1ButtonState, "Step 1 active after snap").toBe("active")
  expect(lens.rack.isFaultVisible, "fault box cleared after snap").toBe(false)
}

/** Criterion 4 — pinch active Step 1: green, checklist step 2, audit log with BlocTi + stoQr. */
export async function stepConfirm(lens: B2BLens, drv: B2BDriver): Promise<void> {
  await drv.pinch("Step1Button")
  await lens.waitFor(() => lens.state === "step1_confirmed", 2000, "state step1_confirmed")
  await sleep(200)
  expect(lens.checklist.step1ButtonState, "Step 1 confirmed").toBe("confirmed")
  expect(lens.obj("Step1ConfirmedGlow").isEnabledInHierarchy, "green confirmation glow visible").toBe(true)
  expect(lens.checklist.activeStep, "checklist on step 2").toBe(2)

  await lens.waitFor(() => lens.auditLog.isVisible, 2500, "audit log visible")
  await lens.waitFor(
    () => !lens.auditLog.isTyping && (lens.auditLog.displayedText as string).indexOf("Reorder queued") >= 0,
    6000,
    "audit log finished typing both lines",
  )
  const full: string = lens.auditLog.fullText
  const shown: string = lens.auditLog.displayedText
  log(`audit fullText=${JSON.stringify(full)}`)
  log(`audit displayedText=${JSON.stringify(shown)}`)
  lens.snapshot("after step 1 confirm")
  expect(lens.panelRootShown("AuditLogPanel"), "AuditLog PanelRoot enabled").toBe(true)
  expect(lens.auditLog.isOffline, "audit log not offline").toBe(false)
  expect(full.indexOf("[BlocTi API]: Event Logged. Task: PSU_Swap") >= 0, "BlocTi payload in audit log").toBe(true)
  expect(full.indexOf("[stoQr API]: Stock Alert: PSU dropped to 'Low'") >= 0, "stoQr payload in audit log").toBe(true)
  expect(shown.indexOf("[BlocTi API]") >= 0, "BlocTi line displayed").toBe(true)
  expect(shown.indexOf("[stoQr API]: Stock Alert: PSU dropped to 'Low'. Reorder queued") >= 0, "stoQr line displayed").toBe(true)
  expect(shown.indexOf("[BlocTi API]: Event Logged. Task: PSU_Swap") >= 0, "BlocTi line displayed in full").toBe(true)
}

/** Criterion 5 — power button boot, Close Ticket, badge, reset. */
export async function stepComplete(lens: B2BLens, drv: B2BDriver): Promise<void> {
  expect(lens.rack.isArrowVisible, "arrow points at power button").toBe(true)
  await drv.pinch("PowerButton")
  await lens.waitFor(() => lens.state === "booting", 1500, "state booting")
  const bootMs = await lens.waitFor(() => lens.state === "step2_complete", 8000, "state step2_complete")
  await sleep(500)
  lens.snapshot("after boot")
  const leds: string[] = lens.rack.ledStates
  log(`boot took ~${bootMs} ms, leds=${leds.join(",")}`)
  expect(leds.length, "LED count").toBeGreaterThan(0)
  expect(leds.every((s) => s === "green"), "all LEDs green").toBe(true)
  expect(lens.checklist.activeStep, "checklist on step 3").toBe(3)
  expect(lens.checklist.closeTicketVisible, "Close Ticket visible").toBe(true)
  expect(lens.telemetry.isVisible, "telemetry visible").toBe(true)

  await sleep(400)
  await drv.pinch("CloseTicketButton")
  await lens.waitFor(() => lens.state === "closing_ticket", 1500, "state closing_ticket")
  const badgeMs = await lens.waitFor(() => lens.state === "complete", 8000, "state complete")
  await sleep(300)
  lens.snapshot("at complete")
  log(`Close Ticket -> badge took ~${badgeMs} ms`)
  expect(lens.badge.isVisible, "badge visible").toBe(true)
  expect(lens.panelRootShown("MaintenanceCompleteBadge"), "badge PanelRoot enabled").toBe(true)
  expect(lens.checklist.isVisible, "checklist hidden").toBe(false)
  expect(lens.panelRootShown("ChecklistPanel"), "checklist PanelRoot disabled").toBe(false)
  expect(lens.telemetry.isVisible, "telemetry hidden").toBe(false)
  expect(lens.auditLog.isVisible, "audit log hidden").toBe(false)
  expect(lens.diagnostics.isVisible, "diagnostics hidden").toBe(false)

  const resetMs = await lens.waitFor(() => lens.state === "placing", 8000, "reset to placing")
  await sleep(300)
  lens.snapshot("after reset")
  log(`badge -> reset took ~${resetMs} ms`)
  expect(lens.placement.isPlacing, "placement active again").toBe(true)
  expect(lens.badge.isVisible, "badge hidden after reset").toBe(false)
  expect(lens.obj("RackFrame").isEnabledInHierarchy, "rack hidden after reset").toBe(false)
  const hist: string[] = lens.main.stateHistory
  const expected = ["placing", "anchored", "scanning", "fault_detected", "failed_psu_removed", "replacement_seated",
    "step1_confirmed", "booting", "step2_complete", "closing_ticket", "complete", "placing"]
  log(`stateHistory=${hist.join(",")}`)
  expect(hist.slice(hist.length - expected.length).join(","), "full state sequence").toBe(expected.join(","))
}
