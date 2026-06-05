import { MODULE_ID, DEFAULT_PERSON_IMG, rankIconPath } from "../constants.mjs"
import { tKey, validImg } from "../utils.mjs"
import { VehicleEntryManager } from "../managers/entry.mjs"
import { ensureSiegeCSS } from "../macros/helpers.mjs"
import { CrewPortraitDialog } from "./crew-portrait.mjs"

const DRIVER_ROLES = ["Driver", "Operator"]






export class CrewHUD extends foundry.applications.api.ApplicationV2 {
   static DEFAULT_OPTIONS = {
      id: "siege-crew-hud",
      classes: ["siege-crew-hud-app"],
      window: { title: "Crew", frame: true, positioned: true },
      position: { width: 450, height: 270 },
   }

   constructor(vehicle, options = {}) {
      super(options)
      this.vehicle = vehicle
      this._scrollIndex = 0
      ensureSiegeCSS()
   }

   static _open = new Map()

   static open(vehicle) {
      if (!vehicle) return
      const existing = this._open.get(vehicle.id)
      if (existing) {
         existing.bringToFront?.()
         existing.render({ force: false })
         return existing
      }
      const hud = new CrewHUD(vehicle)
      this._open.set(vehicle.id, hud)
      hud.render({ force: true })
      return hud
   }

   
   
   static refreshFor(vehicleId) {
      const hud = this._open.get(vehicleId)
      if (hud) hud.render({ force: false })
   }

   
   
   _computeWidth(count) {
      const n = Math.max(1, count)
      if (n <= 3) return n * 150
      if (n <= 6) return 3 * 150 + (n - 3) * 100
      return 3 * 150 + 3 * 100
   }

   _onClose(options) {
      CrewHUD._open.delete(this.vehicle?.id)
      return super._onClose(options)
   }

   get title() {
      return tKey("CrewHUD.Title", { name: this.vehicle?.name ?? "" })
   }

   _gatherCrew() {
      const vehicleId = this.vehicle.id
      const positions = this.vehicle.getFlag(MODULE_ID, "crew") || []
      const vehicleNeedsIgnition =
         this.vehicle.getFlag(MODULE_ID, "needsIgnition") === true
      const iconFor = (title) =>
         positions.find((p) => p.title === title)?.icon || DEFAULT_PERSON_IMG

      const seen = new Set()
      const cards = []
      const actors = new Set([
         ...game.actors,
         ...(canvas?.tokens?.placeables?.map((t) => t.actor).filter(Boolean) ||
            []),
      ])
      for (const actor of actors) {
         if (seen.has(actor.id)) continue
         const eff = actor.itemTypes.effect.find(
            (e) =>
               e.getFlag(MODULE_ID, "siegeId") === vehicleId &&
               e.getFlag(MODULE_ID, "position"),
         )
         if (!eff) continue
         seen.add(actor.id)
         const position = eff.getFlag(MODULE_ID, "position")
         
         const perVeh = foundry.utils.getProperty(
            actor,
            `flags.${MODULE_ID}.crewPortraitByVehicle.${vehicleId}`,
         )
         const cp = perVeh || actor.getFlag(MODULE_ID, "crewPortrait") || null
         let portrait, portraitStyle
         const buildStyle = (src, zoom, ox, oy) => {
            const z = Math.max(1, zoom ?? 1)
            const px = 50 + (ox ?? 0)
            const py = 50 + (oy ?? 0)
            return `background-image:url('${src}'); background-size:cover; background-position:${px}% ${py}%; background-repeat:no-repeat; transform:scale(${z}); transform-origin:${px}% ${py}%;`
         }
         if (cp && typeof cp === "object") {
            portrait = validImg(cp.src || actor.img, actor.img)
            portraitStyle = buildStyle(
               portrait,
               cp.scale ?? 1,
               cp.offsetX ?? 0,
               cp.offsetY ?? 0,
            )
         } else {
            portrait = validImg(
               (typeof cp === "string" ? cp : null) || actor.img,
               actor.img,
            )
            portraitStyle = buildStyle(portrait, 1, 0, 0)
         }
         const isSelf =
            !!game.user.character && game.user.character.id === actor.id
         const owned = actor.testUserPermission(game.user, "OWNER")
         
         let rankInsignia = null
         let rankName = null
         if (this.vehicle.getFlag(MODULE_ID, "ranksEnabled")) {
            const byVeh = actor.getFlag(MODULE_ID, "rankByVehicle") || {}
            const rn = byVeh[this.vehicle.id]
            if (rn) {
               const r = (this.vehicle.getFlag(MODULE_ID, "ranks") || []).find(
                  (x) => x.name === rn,
               )
               if (r) {
                  rankInsignia = rankIconPath(r.icon)
                  rankName = r.name
               }
            }
         }
         cards.push({
            actorId: actor.id,
            actorUuid: actor.uuid,
            name: actor.name,
            portrait,
            portraitStyle,
            position,
            positionIcon: validImg(iconFor(position), DEFAULT_PERSON_IMG),
            rankInsignia,
            rankName,
            isDriver: DRIVER_ROLES.includes(position),
            isSelf,
            owned,
            vehicleNeedsIgnition,
            hasNonIgnitionAction: this._hasNonIgnitionAction(position),
            launched: !!this.vehicle.itemTypes.effect.find((e) =>
               e.getFlag(MODULE_ID, "isLaunched"),
            ),
         })
      }

      cards.sort((a, b) => {
         if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1
         if (a.isDriver !== b.isDriver) return a.isDriver ? 1 : -1
         return a.name.localeCompare(b.name)
      })
      return cards
   }

   _hasNonIgnitionAction(position) {
      return this.vehicle.items.some((item) => {
         if (item.type !== "action") return false
         const flag = item.getFlag(MODULE_ID, "siegeAction")
         if (!flag || flag.needsIgnition !== false) return false
         return (
            !flag.crewAccess ||
            flag.crewAccess.length === 0 ||
            flag.crewAccess.includes(position)
         )
      })
   }

   _cardHTML(card, index, total) {
      
      
      let shapeClass = "crew-card-parallelogram"
      if (total > 1 && index === 0) shapeClass = "crew-card-first"
      else if (total > 1 && index === total - 1) shapeClass = "crew-card-last"

      
      
      const isMine = game.user.isGM || card.owned
      const vehName = this.vehicle?.name ?? ""
      
      const canIgnite = game.user.isGM || card.isDriver
      const showActions =
         !card.vehicleNeedsIgnition ||
         card.launched ||
         card.hasNonIgnitionAction
      const actionBtn = showActions
         ? `<button class="crew-card-btn crew-actions-btn" data-actor-uuid="${card.actorUuid}" data-tooltip="${tKey("CrewHUD.Actions")}"><i class="fa-solid fa-bolt"></i></button>`
         : ""
      const startIgnitionBtn =
         card.vehicleNeedsIgnition && !card.launched && canIgnite
            ? `<button class="crew-card-btn crew-launch-btn" data-actor-uuid="${card.actorUuid}" data-tooltip="${tKey("CrewHUD.StartIgnition")}"><i class="fa-solid fa-key"></i></button>`
            : ""
      const stopIgnitionBtn =
         card.vehicleNeedsIgnition && card.launched && canIgnite
            ? `<button class="crew-card-btn crew-stopignition-btn" data-actor-uuid="${card.actorUuid}" data-tooltip="${tKey("CrewHUD.StopIgnition")}"><i class="fa-solid fa-power-off"></i></button>`
            : ""

      const actionButtons = isMine
         ? `<div class="crew-card-actions">
               <button class="crew-card-btn crew-info-btn" data-actor-uuid="${card.actorUuid}" data-tooltip="${tKey("CrewHUD.Info")}"><i class="fa-solid fa-circle-info"></i></button>
               ${actionBtn}
               ${startIgnitionBtn}
               ${stopIgnitionBtn}
               <button class="crew-card-btn crew-changepos-btn" data-actor-uuid="${card.actorUuid}" data-tooltip="${tKey("CrewHUD.ChangePosition")}"><i class="fa-solid fa-arrows-rotate"></i></button>
               <button class="crew-card-btn crew-exit-btn" data-actor-uuid="${card.actorUuid}" data-tooltip="${tKey("CrewHUD.ExitNamed", { name: vehName })}"><i class="fa-solid fa-right-from-bracket"></i></button>
            </div>`
         : `<div class="crew-card-actions">
               <button class="crew-card-btn crew-info-btn" data-actor-uuid="${card.actorUuid}" data-tooltip="${tKey("CrewHUD.Info")}"><i class="fa-solid fa-circle-info"></i></button>
            </div>`

      
      const portraitButton = isMine
         ? `<button class="crew-portrait-btn" data-actor-uuid="${card.actorUuid}" data-tooltip="${tKey("CrewHUD.CrewPortrait")}"><i class="fa-solid fa-file-arrow-up"></i></button>`
         : ""

      
      
      const expandedClass = total === 1 ? "crew-card-expanded" : ""

      return `
         <div class="crew-card ${shapeClass} ${expandedClass} ${card.isSelf ? "crew-card-self" : ""}" data-actor-id="${card.actorId}">
            <div class="crew-card-inner">
               <div class="crew-card-portrait" data-actor-uuid="${card.actorUuid}" style="${card.portraitStyle}"></div>
               <div class="crew-card-position" data-tooltip="${card.position}">
                  <img src="${card.positionIcon}" alt="${card.position}">
               </div>
               ${
                  card.rankInsignia
                     ? `<div class="crew-card-rank" data-tooltip="${card.rankName || ""}" data-actor-uuid="${card.actorUuid}"><img src="${card.rankInsignia}" alt="${card.rankName || ""}"></div>`
                     : ""
               }
            </div>
            ${portraitButton}
            ${actionButtons}
         </div>`
   }

   _renderHTML() {
      const cards = this._gatherCrew()
      this._crewCount = cards.length
      const maxVisible = 6
      const maxStart = Math.max(0, cards.length - maxVisible)
      this._scrollIndex = Math.max(
         0,
         Math.min(this._scrollIndex || 0, maxStart),
      )
      const visibleCards = cards.slice(
         this._scrollIndex,
         this._scrollIndex + maxVisible,
      )
      const cardsHTML = visibleCards.length
         ? visibleCards
              .map((c, i) => this._cardHTML(c, i, visibleCards.length))
              .join("")
         : `<div class="crew-empty">${tKey("CrewHUD.Empty")}</div>`
      const leftArrow =
         this._scrollIndex > 0
            ? `<button class="crew-scroll-arrow crew-scroll-arrow-left" data-direction="-1" data-tooltip="${tKey("CrewHUD.ScrollLeft")}"><i class="fa-solid fa-chevron-left"></i></button>`
            : ""
      const rightArrow =
         this._scrollIndex + maxVisible < cards.length
            ? `<button class="crew-scroll-arrow crew-scroll-arrow-right" data-direction="1" data-tooltip="${tKey("CrewHUD.ScrollRight")}"><i class="fa-solid fa-chevron-right"></i></button>`
            : ""
      return `
         <div class="siege-crew-hud">
            <div class="crew-scroll">
               <div class="crew-cards">${cardsHTML}</div>
            </div>
            ${leftArrow}
            ${rightArrow}
         </div>`
   }

   _replaceHTML(result, content) {
      content.innerHTML = result
   }

   _onRender() {
      const root = this.element

      
      
      const width = this._computeWidth(this._crewCount || 1)
      const height = 270
      try {
         if (!this._positioned) {
            const top = Math.max(
               60,
               Math.round((window.innerHeight - height) / 2),
            )
            const left = 20
            this.setPosition({ width, height, left, top })
            this._positioned = true
         } else {
            
            this.setPosition({ width, height })
         }
      } catch (e) {
         
      }

      root.querySelectorAll(".crew-scroll-arrow").forEach((btn) => {
         btn.addEventListener("click", () => {
            const dir = parseInt(btn.dataset.direction) || 0
            this._scrollIndex = Math.max(0, (this._scrollIndex || 0) + dir)
            this.render({ force: false })
         })
      })

      
      this._injectBookmarks()

      root.querySelectorAll(".crew-card-portrait").forEach((el) => {
         el.addEventListener("click", async () => {
            const actor = await fromUuid(el.dataset.actorUuid)
            if (actor?.testUserPermission(game.user, "LIMITED"))
               actor.sheet.render(true)
         })
      })

      
      root.querySelectorAll(".crew-card-rank").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const { VehicleHUD } = await import("./vehicle-hud.mjs")
            const hud = VehicleHUD.open(this.vehicle)
            if (hud) {
               hud.tab = "ranks"
               hud.render({ force: false })
            }
         })
      })

      root.querySelectorAll(".crew-exit-btn").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const actor = await fromUuid(el.dataset.actorUuid)
            if (!actor) return
            await VehicleEntryManager.exitVehicle(actor, this.vehicle)
            this.render({ force: false })
         })
      })

      root.querySelectorAll(".crew-portrait-btn").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const actor = await fromUuid(el.dataset.actorUuid)
            if (!actor) return
            new CrewPortraitDialog(actor, this.vehicle?.id).render(true)
         })
      })

      
      root.querySelectorAll(".crew-info-btn").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const actor = await fromUuid(el.dataset.actorUuid)
            if (!actor) return
            const { CrewDossier } = await import("./crew-dossier.mjs")
            new CrewDossier(actor, this.vehicle).render(true)
         })
      })

      
      root.querySelectorAll(".crew-launch-btn").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const { VehicleLaunchManager } = await import(
               "../managers/launch.mjs"
            )
            const actor = await fromUuid(el.dataset.actorUuid)
            await VehicleLaunchManager.toggleLaunched(this.vehicle, actor)
            this.render({ force: false })
         })
      })

      
      root.querySelectorAll(".crew-stopignition-btn").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const { VehicleLaunchManager } = await import(
               "../managers/launch.mjs"
            )
            const actor = await fromUuid(el.dataset.actorUuid)
            await VehicleLaunchManager.toggleLaunched(this.vehicle, actor)
            this.render({ force: false })
         })
      })

      
      
      root.querySelectorAll(".crew-actions-btn").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const actor = await fromUuid(el.dataset.actorUuid)
            if (!actor) return
            const { actionMacro } = await import("../macros/action.mjs")
            await actionMacro(actor)
         })
      })

      
      root.querySelectorAll(".crew-changepos-btn").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const actor = await fromUuid(el.dataset.actorUuid)
            if (!actor) return
            await this._changePositionDialog(actor)
         })
      })
   }

   
   
   _injectBookmarks() {
      const frame = this.element
      if (!frame) return
      frame.querySelector(".crew-bookmarks")?.remove()
      const wrap = document.createElement("div")
      wrap.className = "crew-bookmarks"
      wrap.innerHTML = `
         <button class="crew-bookmark crew-bookmark-active" data-tab="crew" data-tooltip="${tKey("CrewHUD.TabCrew")}"><i class="fa-solid fa-users"></i></button>
         <button class="crew-bookmark" data-tab="vehicle" data-tooltip="${tKey("CrewHUD.TabVehicle")}"><i class="fa-solid fa-gears"></i></button>`
      frame.appendChild(wrap)
      wrap
         .querySelector('[data-tab="vehicle"]')
         ?.addEventListener("click", async () => {
            const { VehicleHUD } = await import("./vehicle-hud.mjs")
            this.close()
            VehicleHUD.open(this.vehicle)
         })
   }

   
   
   async _changePositionDialog(actor) {
      const positions = this.vehicle.getFlag(MODULE_ID, "crew") || []
      const eff = actor.itemTypes.effect.find(
         (e) =>
            e.getFlag(MODULE_ID, "siegeId") === this.vehicle.id &&
            e.getFlag(MODULE_ID, "position"),
      )
      const current = eff?.getFlag(MODULE_ID, "position")
      const allCrew = () => {
         const set = new Set([
            ...game.actors,
            ...(canvas?.tokens?.placeables?.map((t) => t.actor).filter(Boolean) ||
               []),
         ])
         return [...set].filter((a) =>
            a.itemTypes.effect.some(
               (x) => x.getFlag(MODULE_ID, "siegeId") === this.vehicle.id,
            ),
         )
      }
      const occupantsAt = (title) =>
         allCrew().filter((a) =>
            a.itemTypes.effect.some(
               (x) =>
                  x.getFlag(MODULE_ID, "siegeId") === this.vehicle.id &&
                  x.getFlag(MODULE_ID, "position") === title,
            ),
         )

      const options = positions
         .map((p) => {
            const max = parseInt(p.max) || 1
            const count = occupantsAt(p.title).length
            const full = count >= max && p.title !== current
            const isCurrent = p.title === current
            const suffix = isCurrent
               ? ` (${tKey("CrewHUD.Current")})`
               : full
                 ? ` (${tKey("CrewHUD.Full")} — ${tKey("CrewHUD.Switch")})`
                 : ""
            return `<option value="${p.title}" ${isCurrent ? "disabled" : ""}>${p.title}${suffix}</option>`
         })
         .join("")

      const content = `<div style="padding:6px;">
         <p>${tKey("CrewHUD.ChangePositionPrompt", { name: actor.name })}</p>
         <select class="cp-new-pos" style="width:100%;">${options}</select>
      </div>`

      const chosen = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("CrewHUD.ChangePosition") },
         content,
         buttons: [
            {
               action: "ok",
               label: tKey("CrewHUD.Confirm"),
               default: true,
               callback: (event, button, dialog) => {
                  const root = dialog?.element ?? button?.form ?? null
                  const sel =
                     root?.querySelector?.(".cp-new-pos") ||
                     document.querySelector(".cp-new-pos")
                  return sel?.value ?? null
               },
            },
            { action: "cancel", label: tKey("CrewHUD.Cancel") },
         ],
      }).catch(() => null)

      const newPos = chosen && chosen !== "cancel" ? chosen : null
      if (!newPos || !eff) return

      const { VehicleEntryManager } = await import("../managers/entry.mjs")
      const posData = positions.find((p) => p.title === newPos)
      const max = parseInt(posData?.max) || 1
      const occupants = occupantsAt(newPos)

      if (occupants.length < max) {
         
         await VehicleEntryManager.changePosition(actor, this.vehicle, newPos)
         this.render({ force: false })
         return
      }

      
      let swapWith = occupants[0]
      if (occupants.length > 1) {
         const occOptions = occupants
            .map((o) => `<option value="${o.id}">${o.name}</option>`)
            .join("")
         const pickedId = await foundry.applications.api.DialogV2.wait({
            classes: ["siege-v2-dialog"],
            window: { title: tKey("CrewHUD.Switch") },
            content: `<div style="padding:6px;">
               <p>${tKey("CrewHUD.SwitchPickPrompt", { pos: newPos })}</p>
               <select class="cp-swap-with" style="width:100%;">${occOptions}</select>
            </div>`,
            buttons: [
               {
                  action: "ok",
                  label: tKey("CrewHUD.Confirm"),
                  default: true,
                  callback: (event, button, dialog) => {
                     const r = dialog?.element ?? button?.form ?? null
                     return (
                        r?.querySelector?.(".cp-swap-with")?.value ??
                        document.querySelector(".cp-swap-with")?.value ??
                        null
                     )
                  },
               },
               { action: "cancel", label: tKey("CrewHUD.Cancel") },
            ],
         }).catch(() => null)
         if (!pickedId || pickedId === "cancel") return
         swapWith = occupants.find((o) => o.id === pickedId) || occupants[0]
      }

      
      const { SiegeSocketManager } = await import("../managers/sockets.mjs")
      const agreed = await SiegeSocketManager.requestSwapConsent(
         swapWith,
         actor,
         this.vehicle,
         newPos,
         current,
      )
      if (!agreed) {
         ui.notifications.info(
            tKey("CrewHUD.SwitchDeclined", { name: swapWith.name }),
         )
         return
      }
      await VehicleEntryManager.changePosition(swapWith, this.vehicle, current)
      await VehicleEntryManager.changePosition(actor, this.vehicle, newPos)
      this.render({ force: false })
   }
}
