// B2BMaintenanceDiagnosticsUI.ts
// Owns: the floating "Run Hardware Diagnostics" panel shown next to the rack after
//       anchoring (same spot as the checklist). Passive view.
// Public API: show(), hide(), isVisible; event onRunDiagnostics.
// Must not: run the scan or change flow state (Main does).

import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {PanelKit, PanelVisibility, UIColors} from "./B2BMaintenanceSharedUI"
import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"

const ICON_DIAGNOSTICS = requireAsset("../Icons/troubleshoot.png") as Texture

@component
export class B2BMaintenanceDiagnosticsUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">B2BMaintenanceDiagnosticsUI – Run Hardware Diagnostics panel</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Panel width (cm)")
  @widget(new SliderWidget(20, 40, 0.5))
  panelWidthCm: number = 30

  @input
  @hint("Caption above the button")
  caption: string = "Rack anchored · Ready to scan"

  @input
  @hint("Diagnostics button label")
  buttonLabel: string = "Run Hardware Diagnostics"
  @ui.group_end

  private kit = new PanelKit()
  private vis!: PanelVisibility
  private armed = false
  private _onRunDiagnostics = new Event<void>()

  get onRunDiagnostics(): PublicApi<void> {
    return this._onRunDiagnostics.publicApi()
  }

  get isVisible(): boolean {
    return this.vis ? this.vis.visible : false
  }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    const root = this.kit.obj(this.sceneObject, "PanelRoot")
    const w = this.panelWidthCm
    const h = 12
    this.kit.glassPanel(root, w, h)
    const content = this.kit.content(root)
    const col = this.kit.column(content, w, h, {gap: 1.0, padY: 1.4, padX: 1.5, justify: FlexJustify.Center, align: FlexAlign.Center})
    this.kit.text(col, "Caption", this.caption, "Caption", w - 3, 2.2, UIColors.cyan, HorizontalAlignment.Center)
    const btn = this.kit.button(col, "RunDiagnosticsButton", this.buttonLabel, w - 4, 4.6, ICON_DIAGNOSTICS)
    btn.button.onTriggerUp.add(() => {
      if (!this.armed) return
      this.armed = false
      this._onRunDiagnostics.invoke()
    })
    this.vis = new PanelVisibility(this, root, false)
  }

  show(): void {
    this.armed = true
    this.vis.show()
  }

  hide(): void {
    this.armed = false
    this.vis.hide()
  }
}
