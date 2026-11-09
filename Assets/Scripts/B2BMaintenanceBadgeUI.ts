// B2BMaintenanceBadgeUI.ts
// Owns: the bright glowing "Maintenance Complete" badge that hovers over the rack
//       just above the target chassis at the end of the flow. Passive view.
// Public API: show(), hide(); readable: isVisible.
// Must not: time the reset (Main does).

import {FlexAlign, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {PanelKit, PanelVisibility, UIColors} from "./B2BMaintenanceSharedUI"

const ICON_VERIFIED = requireAsset("../Icons/verified.png") as Texture

@component
export class B2BMaintenanceBadgeUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">B2BMaintenanceBadgeUI – Maintenance Complete badge</span>')
  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Badge headline")
  headline: string = "Maintenance Complete"

  @input
  @hint("Badge subtitle")
  subtitle: string = "Ticket #4471 closed · 2m 14s · Fidelity 100%"

  @input("vec4", "{0.35, 1.0, 0.5, 1.0}")
  @hint("Badge glow color")
  @widget(new ColorWidget())
  glowColor!: vec4
  @ui.group_end

  private kit = new PanelKit()
  private vis!: PanelVisibility
  private pulseRoot!: SceneObject

  get isVisible(): boolean {
    return this.vis ? this.vis.visible : false
  }

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    const root = this.kit.obj(this.sceneObject, "PanelRoot")
    this.pulseRoot = this.kit.obj(root, "Pulse")
    const w = 34
    const h = 10
    this.kit.glassPanel(this.pulseRoot, w, h, this.glowColor, new vec4(this.glowColor.x, this.glowColor.y, this.glowColor.z, 0.18))
    const content = this.kit.content(this.pulseRoot)
    const row = this.kit.row(content, w, h, {gap: 1.0, padX: 1.6, justify: FlexJustify.Center, align: FlexAlign.Center})
    this.kit.icon(row, "BadgeIcon", ICON_VERIFIED, 6.0, this.glowColor)
    const col = this.kit.column(row, w - 10, h - 2, {gap: 0.3, justify: FlexJustify.Center, align: FlexAlign.Start})
    this.kit.text(col, "Headline", this.headline, "HeadlineXL", w - 10, 4.0, UIColors.white)
    this.kit.text(col, "Subtitle", this.subtitle, "Caption", w - 10, 2.2, UIColors.cyan)
    this.vis = new PanelVisibility(this, root, false)
    this.createEvent("UpdateEvent").bind(() => {
      if (!this.isVisible) return
      const s = 1 + 0.03 * Math.sin(getTime() * 4)
      this.pulseRoot.getTransform().setLocalScale(new vec3(s, s, 1))
    })
  }

  show(): void {
    this.vis.show(0.45)
  }

  hide(): void {
    this.vis.hide()
  }
}
