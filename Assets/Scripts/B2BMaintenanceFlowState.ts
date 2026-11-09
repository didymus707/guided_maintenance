// B2BMaintenanceFlowState.ts
// Owns: the canonical flow-state names for the guided-maintenance Lens and the
//       hard-coded mock payload strings shown in the System Audit Log.
// Must not: touch the scene. Pure data so tests and scripts share one vocabulary.

/** Public flow states, in order. `B2BMaintenanceMain.state` is always one of these. */
export const FlowState = {
  Placing: "placing", // ghost rack follows gaze on the floor; pinch to anchor
  Anchored: "anchored", // rack placed, "Run Hardware Diagnostics" visible
  Scanning: "scanning", // blue scan line sweeping down the rack (~1 s)
  FaultDetected: "fault_detected", // red box on PSU Slot 2, checklist visible, failed PSU grabbable
  FailedPsuRemoved: "failed_psu_removed", // failed PSU dropped + faded, replacement spawned
  ReplacementSeated: "replacement_seated", // replacement snapped into Slot 2, Step 1 button active
  Step1Confirmed: "step1_confirmed", // Step 1 green, audit log shown, arrow on power button
  Booting: "booting", // LED boot sequence amber -> green
  Step2Complete: "step2_complete", // LEDs solid green, telemetry shown, Close Ticket visible
  ClosingTicket: "closing_ticket", // final audit log flash, UI folding away
  Complete: "complete" // "Maintenance Complete" badge over the rack, then reset to placing
} as const

export type FlowStateName = (typeof FlowState)[keyof typeof FlowState]

/** Mock payloads (USE_MOCK_API = true). Mirrors DualBackendManager.js. */
export const MOCK_STEP1_LINES: string[] = [
  "[BlocTi API]: Event Logged. Task: PSU_Swap. Time: 45s. Fidelity: 100%.",
  "[stoQr API]: Stock Alert: PSU dropped to 'Low'. Reorder queued at £145.00."
]

export const MOCK_CLOSE_LINES: string[] = [
  "[BlocTi API]: Task Complete. Total Duration: 2m 14s. Fidelity: 100%. Ticket Closed."
]
