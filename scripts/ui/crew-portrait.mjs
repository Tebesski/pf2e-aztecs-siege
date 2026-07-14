import { MODULE_ID } from "../constants.mjs"
import {
   tKey,
   renderHbs,
   tplPath,
   portraitImgStyle,
   portraitBackgroundImgStyle,
   clampPortraitOffset,
   normalizePortraitData,
} from "../utils.mjs"

export class CrewPortraitDialog extends foundry.applications.api.ApplicationV2 {
   static DEFAULT_OPTIONS = {
      id: "siege-crew-portrait",
      classes: ["siege-crew-portrait-app"],
      tag: "div",
      window: { title: "", frame: true, positioned: true },
      position: { width: 420, height: "auto" },
   }

   constructor(actor, vehicleId, options = {}) {
      super(options)
      this.actor = actor
      this.vehicleId = vehicleId
      
      this.uploadOnly = !!options.uploadOnly

this.vehiclePortrait = !!options.vehiclePortrait

const global = actor.getFlag(MODULE_ID, "crewPortrait")
      const perVeh =
         vehicleId && !this.vehiclePortrait
            ? foundry.utils.getProperty(
                 actor,
                 `flags.${MODULE_ID}.crewPortraitByVehicle.${vehicleId}`,
              )
            : null
      
      const existing = this.vehiclePortrait ? global : perVeh || global
      this.crop = normalizePortraitData(existing, actor.img)
      this.applyToAll = !!global && !perVeh 
      this._drag = null
   }

   get title() {
      return tKey("CrewHUD.PortraitTitle", { name: this.actor?.name ?? "" })
   }

   _backgroundScale() {
      return Math.max(1, Number(this.crop.backgroundScale ?? this.crop.scale ?? 1) || 1)
   }

   _backgroundLimit() {
      return (1 - 1 / this._backgroundScale()) * 50
   }

   _portraitTemplateData() {
      const bgScale = this._backgroundScale()
      const bgLimit = this._backgroundLimit()
      const bgOffsetX = clampPortraitOffset(this.crop.backgroundOffsetX ?? this.crop.offsetX ?? 0, bgScale)
      const bgOffsetY = clampPortraitOffset(this.crop.backgroundOffsetY ?? this.crop.offsetY ?? 0, bgScale)
      return {
         foregroundSrc: this.crop.src,
         backgroundSrc: this.crop.backgroundSrc || "",
         foregroundStyle: portraitImgStyle(this.crop),
         backgroundStyle: `${portraitBackgroundImgStyle(this.crop)}${this.crop.backgroundSrc ? "" : "display:none;"}`,
         uploadPreviewStyle: `background-image:url('${this.crop.src}');`,
         backgroundZoom: Math.round(bgScale * 100),
         backgroundMin: -bgLimit,
         backgroundMax: bgLimit,
         backgroundOffsetX: bgOffsetX,
         backgroundOffsetY: bgOffsetY,
         vehiclePortrait: this.vehiclePortrait,
         applyToAll: this.applyToAll,
         showAllButton: game.user.isGM && !this.vehiclePortrait,
         labels: {
            pickImage: tKey("CrewHUD.PickImage"),
            backgroundImage: tKey("CrewHUD.BackgroundImage"),
            foregroundImage: tKey("CrewHUD.ForegroundImage"),
            backgroundZoom: tKey("CrewHUD.BackgroundZoom"),
            backgroundX: tKey("CrewHUD.BackgroundX"),
            backgroundY: tKey("CrewHUD.BackgroundY"),
            applyAllVehicles: tKey("CrewHUD.ApplyAllVehicles"),
            optimalDimensions: tKey("CrewHUD.OptimalDimensions"),
            save: tKey("CrewHUD.Save"),
            reset: tKey("CrewHUD.Reset"),
            showAll: tKey("CrewHUD.ShowAll"),
         },
      }
   }

   _renderHTML() {
      return renderHbs(
         tplPath(
            this.uploadOnly
               ? "apps/crew-portrait-upload.hbs"
               : "apps/crew-portrait.hbs",
         ),
         this._portraitTemplateData(),
      )
   }

   _replaceHTML(result, content) {
      content.innerHTML = result
   }

   _onRender() {
      const root = this.element
      const portrait = root.querySelector(".scp-preview-portrait")
      const background = root.querySelector(".scp-preview-bg")
      const uploadPreview = root.querySelector(".scp-upload-preview")
      const pathInput = root.querySelector(".scp-fg-path") || root.querySelector(".scp-path")
      const bgPathInput = root.querySelector(".scp-bg-path")
      const zoomInput = root.querySelector(".scp-bg-zoom")
      const bgXInput = root.querySelector(".scp-bg-x")
      const bgYInput = root.querySelector(".scp-bg-y")

      const syncBackgroundFields = () => {
         const scale = this._backgroundScale()
         const limit = this._backgroundLimit()
         this.crop.backgroundScale = scale
         this.crop.scale = scale
         this.crop.backgroundOffsetX = clampPortraitOffset(
            this.crop.backgroundOffsetX ?? this.crop.offsetX ?? 0,
            scale,
         )
         this.crop.backgroundOffsetY = clampPortraitOffset(
            this.crop.backgroundOffsetY ?? this.crop.offsetY ?? 0,
            scale,
         )
         this.crop.offsetX = this.crop.backgroundOffsetX
         this.crop.offsetY = this.crop.backgroundOffsetY
         if (zoomInput) zoomInput.value = Math.round(scale * 100)
         for (const input of [bgXInput, bgYInput]) {
            if (!input) continue
            input.min = String(-limit)
            input.max = String(limit)
         }
         if (bgXInput) bgXInput.value = this.crop.backgroundOffsetX
         if (bgYInput) bgYInput.value = this.crop.backgroundOffsetY
      }

      const applyBg = () => {
         if (background) {
            background.src = this.crop.backgroundSrc || ""
            background.style.display = this.crop.backgroundSrc ? "" : "none"
            background.setAttribute("style", `${portraitBackgroundImgStyle(this.crop)}${this.crop.backgroundSrc ? "" : "display:none;"}`)
         }
         if (portrait)
            portrait.setAttribute(
               "style",
               portraitImgStyle(this.crop),
            )
         if (portrait && portrait.tagName === "IMG") portrait.src = this.crop.src
         if (uploadPreview)
            uploadPreview.style.backgroundImage = `url('${this.crop.src}')`
      }

root.querySelectorAll(".scp-pick").forEach((button) => button.addEventListener("click", () => {
         const target = button.dataset.target || "foreground"
         const FP =
            foundry.applications?.apps?.FilePicker?.implementation ||
            globalThis.FilePicker
         const fp = new FP({
            type: "image",
            current: target === "background" ? this.crop.backgroundSrc : this.crop.src,
            callback: (path) => {
               if (target === "background") {
                  this.crop.backgroundSrc = path
                  if (bgPathInput) bgPathInput.value = path
               } else {
                  this.crop.src = path
                  if (pathInput) pathInput.value = path
               }
               applyBg()
            },
         })
         fp.render(true)
      }))

if (this.uploadOnly) {
         root.querySelector(".scp-save")?.addEventListener("click", () =>
            this._save(),
         )
         return
      }

const setBackgroundZoom = (scale) => {
         this.crop.backgroundScale = Math.max(1, Math.min(3, scale))
         this.crop.scale = this.crop.backgroundScale
         this.crop.fit = "manual"
         syncBackgroundFields()
         applyBg()
      }
      zoomInput?.addEventListener("input", (e) => {
         setBackgroundZoom(Number(e.target.value) / 100)
      })
      bgXInput?.addEventListener("input", (e) => {
         this.crop.backgroundOffsetX = clampPortraitOffset(Number(e.target.value) || 0, this._backgroundScale())
         this.crop.offsetX = this.crop.backgroundOffsetX
         syncBackgroundFields()
         applyBg()
      })
      bgYInput?.addEventListener("input", (e) => {
         this.crop.backgroundOffsetY = clampPortraitOffset(Number(e.target.value) || 0, this._backgroundScale())
         this.crop.offsetY = this.crop.backgroundOffsetY
         syncBackgroundFields()
         applyBg()
      })

root.querySelector(".scp-all")?.addEventListener("change", (e) => {
         this.applyToAll = e.target.checked
      })

portrait.addEventListener("pointerdown", (e) => {
         this._drag = { x: e.clientX, y: e.clientY }
         portrait.setPointerCapture(e.pointerId)
      })
      portrait.addEventListener("pointermove", (e) => {
         if (!this._drag) return
         const dx = e.clientX - this._drag.x
         const dy = e.clientY - this._drag.y
         this._drag = { x: e.clientX, y: e.clientY }
         this.crop.foregroundOffsetX = (Number(this.crop.foregroundOffsetX) || 0) - dx / 3
         this.crop.foregroundOffsetY = (Number(this.crop.foregroundOffsetY) || 0) - dy / 3
         applyBg()
      })
      const endDrag = () => (this._drag = null)
      portrait.addEventListener("pointerup", endDrag)
      portrait.addEventListener("pointercancel", endDrag)
      portrait.addEventListener(
         "wheel",
         (e) => {
            e.preventDefault()
            const direction = e.deltaY > 0 ? -1 : 1
            const current = Math.max(0.05, Number(this.crop.foregroundScale ?? 1) || 1)
            const factor = direction > 0 ? 1.08 : 1 / 1.08
            this.crop.foregroundScale = Math.max(0.05, current * factor)
            applyBg()
         },
         { passive: false },
      )

root.querySelector(".scp-save")?.addEventListener("click", async () => {
         await this._save()
         this.close()
      })

root.querySelector(".scp-reset")?.addEventListener("click", async () => {
         this.crop = {
            src: this.actor.img,
            backgroundSrc: "",
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            backgroundScale: 1,
            backgroundOffsetX: 0,
            backgroundOffsetY: 0,
            foregroundScale: 1,
            foregroundOffsetX: 0,
            foregroundOffsetY: 0,
            fit: "manual",
         }
         pathInput.value = this.crop.src
         if (bgPathInput) bgPathInput.value = ""
         syncBackgroundFields()
         applyBg()
      })

root.querySelector(".scp-show")?.addEventListener("click", () => {
         const ip = new ImagePopout(this.crop.src, {
            title: this.actor.name,
            shareable: true,
         })
         ip.render(true)
         ip.shareImage()
      })
   }

   async _save() {
      const data = {
         portraitLayersVersion: 2,
         src: this.crop.src,
         backgroundSrc: this.crop.backgroundSrc || "",
         scale: this._backgroundScale(),
         offsetX: clampPortraitOffset(this.crop.backgroundOffsetX ?? this.crop.offsetX ?? 0, this._backgroundScale()),
         offsetY: clampPortraitOffset(this.crop.backgroundOffsetY ?? this.crop.offsetY ?? 0, this._backgroundScale()),
         backgroundScale: this._backgroundScale(),
         backgroundOffsetX: clampPortraitOffset(this.crop.backgroundOffsetX ?? this.crop.offsetX ?? 0, this._backgroundScale()),
         backgroundOffsetY: clampPortraitOffset(this.crop.backgroundOffsetY ?? this.crop.offsetY ?? 0, this._backgroundScale()),
         foregroundScale: Math.max(0.05, Number(this.crop.foregroundScale ?? 1) || 1),
         foregroundOffsetX: Number(this.crop.foregroundOffsetX) || 0,
         foregroundOffsetY: Number(this.crop.foregroundOffsetY) || 0,
         fit: this.crop.fit || "cover",
      }

if (this.vehiclePortrait) {
         if (this.actor.testUserPermission(game.user, "OWNER")) {
            await this.actor.setFlag(MODULE_ID, "crewPortrait", data)
         } else if (globalThis.siegeSocket) {
            await globalThis.siegeSocket.executeAsGM(
               "setCrewPortrait",
               this.actor.uuid,
               data,
               "all",
               null,
            )
         }
         const { VehicleHUD } = await import("./vehicle-hud.mjs")
         VehicleHUD.refreshFor?.(this.vehicleId)
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
               this.vehicleId ?? null,
            )
         this.close()
         return
      }

const scope = this.applyToAll ? "all" : "vehicle"
      if (this.actor.testUserPermission(game.user, "OWNER")) {
         if (scope === "all") {
            await this.actor.setFlag(MODULE_ID, "crewPortrait", data)
         } else if (this.vehicleId) {
            await this.actor.setFlag(
               MODULE_ID,
               `crewPortraitByVehicle.${this.vehicleId}`,
               data,
            )
         }
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "setCrewPortrait",
            this.actor.uuid,
            data,
            scope,
            this.vehicleId ?? null,
         )
      }
      
      if (globalThis.siegeSocket)
         globalThis.siegeSocket.executeForEveryone(
            "refreshCrewHud",
            this.vehicleId ?? null,
         )
      const { CrewHUD } = await import("./crew-hud.mjs")
      CrewHUD.refreshFor(this.vehicleId)
      this.close()
   }
}
