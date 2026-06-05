import { MODULE_ID } from "../constants.mjs"
import { tKey, portraitImgStyle, clampPortraitOffset } from "../utils.mjs"





export class CrewPortraitDialog extends foundry.applications.api.ApplicationV2 {
   static DEFAULT_OPTIONS = {
      id: "siege-crew-portrait",
      classes: ["siege-crew-portrait-app"],
      tag: "div",
      window: { title: "Crew Portrait", frame: true, positioned: true },
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
      const norm = (e) => {
         if (typeof e === "string")
            return { src: e, scale: 1, offsetX: 0, offsetY: 0, fit: "cover" }
         if (e && typeof e === "object")
            return {
               src: e.src || actor.img,
               scale: e.scale ?? 1,
               offsetX: e.offsetX ?? 0,
               offsetY: e.offsetY ?? 0,
               fit: e.fit || "cover",
            }
         
         return { src: actor.img, scale: 1, offsetX: 0, offsetY: 0, fit: "cover" }
      }
      this.crop = norm(existing)
      this.applyToAll = !!global && !perVeh 
      this._drag = null
   }

   get title() {
      return tKey("CrewHUD.PortraitTitle", { name: this.actor?.name ?? "" })
   }

   _bgStyle() {
      
      
      
      
      const zoom = Math.max(1, this.crop.scale ?? 1)
      const posX = 50 + this.crop.offsetX
      const posY = 50 + this.crop.offsetY
      return `background-image:url('${this.crop.src}'); background-size:cover; background-position:${posX}% ${posY}%; background-repeat:no-repeat; transform:scale(${zoom}); transform-origin:${posX}% ${posY}%;`
   }

   _renderHTML() {
      const isGM = game.user.isGM
      if (this.uploadOnly) {
         
         return `
            <div class="siege-crew-portrait scp-upload-only">
               <div class="scp-row">
                  <button class="scp-pick" data-tooltip="${tKey("CrewHUD.PickImage")}"><i class="fa-solid fa-file-image"></i></button>
                  <input type="text" class="scp-path" value="${this.crop.src}" readonly>
               </div>
               <div class="scp-upload-preview" style="background-image:url('${this.crop.src}');"></div>
               <div class="scp-buttons">
                  <button class="scp-save"><i class="fa-solid fa-check"></i> ${tKey("CrewHUD.Save")}</button>
               </div>
            </div>`
      }
      return `
         <div class="siege-crew-portrait">
            <div class="scp-row">
               <button class="scp-pick" data-tooltip="${tKey("CrewHUD.PickImage")}"><i class="fa-solid fa-file-image"></i></button>
               <input type="text" class="scp-path" value="${this.crop.src}" readonly>
            </div>
            <div class="scp-preview-wrap">
               <div class="scp-preview crew-card crew-card-parallelogram">
                  <div class="crew-card-inner">
                     <img class="scp-preview-portrait scp-preview-img" src="${this.crop.src}" style="${portraitImgStyle({ src: this.crop.src, zoom: this.crop.scale, ox: this.crop.offsetX, oy: this.crop.offsetY })}">
                  </div>
               </div>
               <div class="scp-hint">${tKey("CrewHUD.CropHint")}</div>
            </div>
            <div class="scp-controls">
               <label>${tKey("CrewHUD.Zoom")}
                  <input type="range" class="scp-zoom" min="100" max="300" value="${Math.round(Math.max(1, this.crop.scale) * 100)}">
               </label>
               ${
                  this.vehiclePortrait
                     ? ""
                     : `<label class="scp-allveh">
                  <input type="checkbox" class="scp-all" ${this.applyToAll ? "checked" : ""}> ${tKey("CrewHUD.ApplyAllVehicles")}
               </label>`
               }
            </div>
            <p class="scp-dim-hint"><i class="fa-solid fa-circle-info"></i> ${tKey("CrewHUD.OptimalDimensions")}</p>
            <div class="scp-buttons">
               <button class="scp-save"><i class="fa-solid fa-check"></i> ${tKey("CrewHUD.Save")}</button>
               <button class="scp-reset"><i class="fa-solid fa-rotate-left"></i> ${tKey("CrewHUD.Reset")}</button>
               ${isGM && !this.vehiclePortrait ? `<button class="scp-show"><i class="fa-solid fa-eye"></i> ${tKey("CrewHUD.ShowAll")}</button>` : ""}
            </div>
         </div>`
   }

   _replaceHTML(result, content) {
      content.innerHTML = result
   }

   _onRender() {
      const root = this.element
      const portrait = root.querySelector(".scp-preview-portrait")
      const uploadPreview = root.querySelector(".scp-upload-preview")
      const pathInput = root.querySelector(".scp-path")

      const applyBg = () => {
         if (portrait)
            portrait.setAttribute(
               "style",
               portraitImgStyle({
                  src: this.crop.src,
                  zoom: this.crop.scale,
                  ox: this.crop.offsetX,
                  oy: this.crop.offsetY,
               }),
            )
         if (portrait && portrait.tagName === "IMG") portrait.src = this.crop.src
         if (uploadPreview)
            uploadPreview.style.backgroundImage = `url('${this.crop.src}')`
      }

      
      root.querySelector(".scp-pick")?.addEventListener("click", () => {
         const FP =
            foundry.applications?.apps?.FilePicker?.implementation ||
            globalThis.FilePicker
         const fp = new FP({
            type: "image",
            current: this.crop.src,
            callback: (path) => {
               this.crop.src = path
               if (pathInput) pathInput.value = path
               applyBg()
            },
         })
         fp.render(true)
      })

      
      if (this.uploadOnly) {
         root.querySelector(".scp-save")?.addEventListener("click", () =>
            this._save(),
         )
         return
      }

      
      const zoomInput = root.querySelector(".scp-zoom")
      const setZoom = (scale) => {
         this.crop.scale = Math.max(1, Math.min(3, scale))
         this.crop.fit = "manual"
         
         
         this.crop.offsetX = clampPortraitOffset(this.crop.offsetX, this.crop.scale)
         this.crop.offsetY = clampPortraitOffset(this.crop.offsetY, this.crop.scale)
         if (zoomInput) zoomInput.value = Math.round(this.crop.scale * 100)
         applyBg()
      }
      zoomInput?.addEventListener("input", (e) => {
         setZoom(Number(e.target.value) / 100)
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
         
         
         this.crop.offsetX = clampPortraitOffset(
            this.crop.offsetX - dx / 3,
            this.crop.scale,
         )
         this.crop.offsetY = clampPortraitOffset(
            this.crop.offsetY - dy / 3,
            this.crop.scale,
         )
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
            setZoom(this.crop.scale + direction * 0.05)
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
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            fit: "manual",
         }
         pathInput.value = this.crop.src
         root.querySelector(".scp-zoom").value = 100
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
         src: this.crop.src,
         scale: this.crop.scale,
         offsetX: this.crop.offsetX,
         offsetY: this.crop.offsetY,
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
