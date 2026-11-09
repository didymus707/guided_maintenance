import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {B2B_DEFAULT_PARAMS} from "./B2BTestKit"
import {B2BC1AnchorScenario} from "./B2BC1AnchorScenario"
import {B2BC2DiagnosticsScenario} from "./B2BC2DiagnosticsScenario"
import {B2BC3SwapGateScenario} from "./B2BC3SwapGateScenario"
import {B2BC4MockApiScenario} from "./B2BC4MockApiScenario"
import {B2BC5EndToEndScenario} from "./B2BC5EndToEndScenario"

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    {id: "c1-anchor-initialize", typename: B2BC1AnchorScenario.getTypeName(), parameters: {...B2B_DEFAULT_PARAMS}},
    {id: "c2-diagnostics-trigger", typename: B2BC2DiagnosticsScenario.getTypeName(), parameters: {...B2B_DEFAULT_PARAMS}},
    {id: "c3-swap-and-gate", typename: B2BC3SwapGateScenario.getTypeName(), parameters: {...B2B_DEFAULT_PARAMS}},
    {id: "c4-mock-api-verification", typename: B2BC4MockApiScenario.getTypeName(), parameters: {...B2B_DEFAULT_PARAMS}},
    {id: "c5-end-to-end-completion", typename: B2BC5EndToEndScenario.getTypeName(), parameters: {...B2B_DEFAULT_PARAMS}},
  ]
}
