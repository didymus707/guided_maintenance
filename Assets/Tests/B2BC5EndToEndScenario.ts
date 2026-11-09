// B2BC5EndToEndScenario.ts — LEAF scenario for done criterion 5 (devpost/design-brief.md).
// Starts from a freshly reset Lens; replays prerequisite steps with real SIK interactions.

import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {B2BDriver, B2BLens, log} from "./B2BTestKit"
import {stepAnchor, stepDiagnostics, stepSwap, stepConfirm, stepComplete} from "./B2BFlowSteps"

@component
export class B2BC5EndToEndScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const lens = new B2BLens()
    const drv = new B2BDriver(config)
    await drv.init()
    const anchor = config?.get("anchor_target") ?? "RackGhost"
    await stepAnchor(lens, drv, anchor)
    await stepDiagnostics(lens, drv)
    await stepSwap(lens, drv)
    await stepConfirm(lens, drv)
    await stepComplete(lens, drv)
    log("C5 PASS")
  }
}
