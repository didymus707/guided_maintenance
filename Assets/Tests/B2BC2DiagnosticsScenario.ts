// B2BC2DiagnosticsScenario.ts — LEAF scenario for done criterion 2 (devpost/design-brief.md).
// Starts from a freshly reset Lens; replays prerequisite steps with real SIK interactions.

import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {B2BDriver, B2BLens, log} from "./B2BTestKit"
import {stepAnchor, stepDiagnostics} from "./B2BFlowSteps"

@component
export class B2BC2DiagnosticsScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const lens = new B2BLens()
    const drv = new B2BDriver(config)
    await drv.init()
    const anchor = config?.get("anchor_target") ?? "RackGhost"
    await stepAnchor(lens, drv, anchor)
    await stepDiagnostics(lens, drv)
    log("C2 PASS")
  }
}
