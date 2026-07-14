import { DEFAULT_RANKS, MODULE_ID, rankIconPath } from "../../constants.mjs"
import { tKey } from "../../utils.mjs"
import { actionDetailHTML } from "../crew-dossier.mjs"
import { SiegeSFXManager } from "../../managers/sfx.mjs"
import { VehicleEntryManager } from "../../managers/entry.mjs"
import { escapeHTML } from "./helpers.mjs"
import { _runWeaponAmmunitionChoice } from "../../macros/action/ammunition-management.mjs"

class VehicleHUDRenderListenerMixin {
   _onRender() {
      const root = this.element

      if (!this._positioned) {
         try {
            this.setPosition({
               left: 20,
               top: Math.max(40, Math.round((window.innerHeight - 460) / 2)),
            })
         } catch (e) {
            
         }
         this._positioned = true
      }

root.querySelectorAll(".vh-tab").forEach((el) => {
         el.addEventListener("click", () => {
            const previous = this.tab
            this.tab = el.dataset.tab
            if (this.tab === "stash" && previous !== "stash")
               SiegeSFXManager.playIfConfigured(this.vehicle, "openStash")
            this.render({ force: false })
         })
      })

      this._bindModuleBoard(root)
      this._syncClippedModuleTooltips(root)

root.querySelector(".vh-edit-portrait")?.addEventListener("click", async () => {
         const { CrewPortraitDialog } = await import("../crew-portrait.mjs")
         new CrewPortraitDialog(this.vehicle, this.vehicle.id, {
            vehiclePortrait: true,
         }).render(true)
      })

root
         .querySelector('[data-action="toggle-weaponry"]')
         ?.addEventListener("click", () => {
            this._weaponOpen = !this._weaponOpen
            this.render({ force: false })
         })

root.querySelectorAll(".vh-acc-head").forEach((el) => {
         el.addEventListener("click", (e) => {
            e.preventDefault()
            e.stopPropagation()
            const acc = el.closest(".vh-acc")
            const body = acc.querySelector(".vh-acc-body")
            const caret = acc.querySelector(".vh-acc-toggle i")
            const open = body.style.display !== "none"
            body.style.display = open ? "none" : "block"
            if (caret)
               caret.className = `fa-solid fa-chevron-${open ? "right" : "down"}`
         })
      })

root.querySelectorAll('.vh-weapon-head[data-action="toggle-weapon"]').forEach((el) => {
         el.addEventListener("click", (e) => {
            if (e.target.closest(".vh-weapon-btns")) return
            e.preventDefault()
            const row = el.closest(".vh-weapon")
            const body = row?.querySelector(".vh-weapon-detail")
            const caret = row?.querySelector(".vh-weapon-toggle i")
            if (!body) return
            const open = body.style.display !== "none"
            body.style.display = open ? "none" : "block"
            row.classList.toggle("open", !open)
            if (caret)
               caret.className = `fa-solid fa-chevron-${open ? "right" : "down"}`
         })
      })

root.querySelectorAll('.vh-stash-head[data-action="toggle-stash-item"]').forEach((el) => {
         el.addEventListener("click", (e) => {
            e.preventDefault()
            const row = el.closest(".vh-stash-item")
            const body = row?.querySelector(".vh-stash-detail")
            const caret = row?.querySelector(".vh-stash-toggle i")
            if (!body) return
            const open = body.style.display !== "none"
            body.style.display = open ? "none" : "block"
            row.classList.toggle("open", !open)
            if (caret)
               caret.className = `fa-solid fa-chevron-${open ? "right" : "down"}`
         })
      })

      root.querySelectorAll(".vh-stash-cat").forEach((details) => {
         details.addEventListener("toggle", () => {
            const state = this._loadJSON("stashCategories", {})
            state[details.dataset.cat] = details.open
            this._saveJSON("stashCategories", state)
            const ch = details.querySelector(":scope > summary .chevron")
            if (ch)
               ch.className = `fa-solid fa-chevron-${details.open ? "down" : "right"} chevron`
         })
      })

      root.querySelectorAll(".vh-ammo-outer-acc, .siege-ammo-type-detail").forEach((d) => {
         d.addEventListener("toggle", () => {
            const ch = d.querySelector(":scope > summary .chevron")
            if (ch)
               ch.className = `fa-solid fa-chevron-${d.open ? "down" : "right"} chevron`
         })
      })

      root.querySelectorAll(".vh-weapon-reload").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const action = this.vehicle.items.get(el.dataset.actionId)
            if (!action) return
            await _runWeaponAmmunitionChoice(
               this.vehicle,
               this._currentCrewman(),
               action,
               "reload",
            )
            this.render({ force: false })
         })
      })

      root.querySelectorAll(".vh-weapon-switch-loaded").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (el.disabled) return
            const action = this.vehicle.items.get(el.dataset.actionId)
            if (!action) return
            await _runWeaponAmmunitionChoice(
               this.vehicle,
               this._currentCrewman(),
               action,
               "switch",
            )
            this.render({ force: false })
         })
      })

root.querySelectorAll(".vh-weapon-unload").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (el.disabled) return
            const action = this.vehicle.items.get(el.dataset.actionId)
            if (!action) return
            await _runWeaponAmmunitionChoice(
               this.vehicle,
               this._currentCrewman(),
               action,
               "unload",
            )
            this.render({ force: false })
         })
      })

root.querySelectorAll(".vh-stash-retrieve").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const item = this.vehicle.items.get(el.dataset.itemId)
            if (!item) return
            const crewman = this._currentCrewman?.()
            if (!crewman?.uuid) {
               ui.notifications.warn(tKey("Stash.NoCrewmember"))
               return
            }
            const { SiegeSocketManager } = await import("../../managers/sockets.mjs")
            await SiegeSocketManager.moveStashItem(
               this.vehicle.id,
               item.id,
               crewman.uuid,
               game.user.id,
            )
            this.render({ force: false })
         })
      })

root.querySelectorAll(".vh-stash-remove").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const item = this.vehicle.items.get(el.dataset.itemId)
            if (!item) return
            const quantity = Math.max(1, Number(item.system?.quantity) || 1)
            const amountField =
               quantity > 1
                  ? `<div class="form-group stacked">
                     <label>${tKey("Load.Amount")}</label>
                     <input type="number" class="vh-stash-remove-amount" value="1" min="1" max="${quantity}">
                  </div>`
                  : ""
            const result = await foundry.applications.api.DialogV2.wait({
               classes: ["siege-v2-dialog"],
               window: { title: tKey("Stash.RemoveFromStash") },
               content: `<p>${escapeHTML(tKey("Stash.RemoveConfirm", { name: item.name }))}</p>${amountField}`,
               buttons: [
                  {
                     action: "confirm",
                     label: tKey("Buttons.Confirm"),
                     default: true,
                     callback: (event, button, dialog) => {
                        const root = dialog?.element ?? button?.form ?? document
                        const raw = root.querySelector(".vh-stash-remove-amount")?.value
                        return {
                           confirmed: true,
                           amount: Math.max(
                              1,
                              Math.min(quantity, parseInt(raw) || 1),
                           ),
                        }
                     },
                  },
                  {
                     action: "cancel",
                     label: tKey("Buttons.Cancel"),
                     callback: () => null,
                  },
               ],
            }).catch(() => null)
            if (!result?.confirmed) return
            const { SiegeSocketManager } = await import("../../managers/sockets.mjs")
            await SiegeSocketManager.removeStashItem(
               this.vehicle.id,
               item.id,
               game.user.id,
               result.amount,
            )
            this.render({ force: false })
         })
      })

      root.querySelectorAll(".vh-module-target-badge").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const action = this.vehicle.items.get(el.dataset.actionId)
            if (!action) return
            await foundry.applications.api.DialogV2.wait({
               classes: ["siege-v2-dialog", "siege-action-detail-dialog"],
               window: { title: action.name },
               position: { width: 520 },
               content: actionDetailHTML(action, { weaponry: true }),
               buttons: [
                  {
                     action: "close",
                     label: tKey("Buttons.Close"),
                     default: true,
                  },
               ],
            }).catch(() => null)
         })
      })

root.querySelectorAll(".vh-stash-item[draggable='true']").forEach((el) => {
         el.addEventListener("dragstart", (e) => {
            const item = this.vehicle.items.get(el.dataset.itemId)
            if (!item) return
            const payload = {
               type: "Item",
               uuid: item.uuid,
               
               siegeStashMove: {
                  vehicleId: this.vehicle.id,
                  itemId: item.id,
               },
            }
            e.dataTransfer.setData("text/plain", JSON.stringify(payload))
            e.dataTransfer.setData("application/json", JSON.stringify(payload))
            e.dataTransfer.effectAllowed = "all"
            if (item.img) {
               const img = new Image()
               img.src = item.img
               try {
                  e.dataTransfer.setDragImage(img, 16, 16)
               } catch {
                  
               }
            }
         })
      })

const dropZone = root.querySelector(".vh-stash-drop")
      if (dropZone) {
         const readDropData = (event) => {
            const helper =
               foundry.applications?.ux?.TextEditor?.implementation
                  ?.getDragEventData
            try {
               const data = helper?.(event)
               if (data) return data
            } catch {
               
            }
            const tryParse = (raw) => {
               if (!raw) return null
               try {
                  return JSON.parse(raw)
               } catch {
                  return null
               }
            }
            return (
               tryParse(event.dataTransfer.getData("application/json")) ||
               tryParse(event.dataTransfer.getData("text/json")) ||
               tryParse(event.dataTransfer.getData("text/plain"))
            )
         }

         const resolveDroppedItem = async (data) => {
            if (!data || data.type !== "Item") return null
            if (data.uuid || data.documentUuid)
               return fromUuid(data.uuid || data.documentUuid)
            if (data.id) {
               const worldItem = game.items.get(data.id)
               if (worldItem) return worldItem
               const actor = data.actorId ? game.actors.get(data.actorId) : null
               if (actor) return actor.items.get(data.id) || null
            }
            return null
         }

         dropZone.addEventListener("dragover", (e) => {
            e.preventDefault()
            e.stopPropagation()
            dropZone.classList.add("vh-stash-dragover")
         })
         dropZone.addEventListener("dragleave", () =>
            dropZone.classList.remove("vh-stash-dragover"),
         )
         dropZone.addEventListener("drop", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation?.()
            dropZone.classList.remove("vh-stash-dragover")
            const data = readDropData(e)
            if (data?.type === "siegeInstalledModule") {
               if (data.vehicleId === this.vehicle.id && data.slotId) {
                  await this._deinstallModule(data.slotId)
                  this.render({ force: false })
               }
               return
            }
            const item = await resolveDroppedItem(data)
            if (!item) return
            const { SiegeSocketManager } = await import("../../managers/sockets.mjs")
            await SiegeSocketManager.putStashItem(
               this.vehicle.id,
               item.uuid,
               game.user.id,
            )
            this.render({ force: false })
         })
      }

root.querySelectorAll(".vh-crew-member").forEach((el) => {
         el.addEventListener("click", async () => {
            const actor = await fromUuid(el.dataset.actorUuid)
            if (!actor) return
            const { CrewDossier } = await import("../crew-dossier.mjs")
            new CrewDossier(actor, this.vehicle).render(true)
         })
      })

root.querySelectorAll(".vh-crew-select").forEach((el) => {
         el.addEventListener("click", (e) => {
            e.stopPropagation()
         })
         el.addEventListener("change", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!el.checked) {
               el.checked = true
               return
            }
            const actor = await fromUuid(el.dataset.actorUuid)
            await VehicleEntryManager.setSelectedCrewForVehicle(
               this.vehicle,
               actor,
            )
            root
               .querySelectorAll(".vh-crew-select")
               .forEach((input) => (input.checked = input === el))
            const { ActionsHotkeyPanel } = await import("../actions-hotkey-panel.mjs")
            ActionsHotkeyPanel.refreshFor(this.vehicle.id)
            this.render({ force: false })
         })
      })

root.querySelectorAll(".vh-pos-info").forEach((el) => {
         el.addEventListener("click", async () => {
            const title = el.dataset.position
            const pos = (this.vehicle.getFlag(MODULE_ID, "crew") || []).find(
               (p) => p.title === title,
            )
            if (!pos) return
            const { buildPositionsData } = await import("../../macros/mount.mjs")
            const { renderHbs, tplPath } = await import("../../utils.mjs")
            const positions = await buildPositionsData(this.vehicle, [pos])
            const content = await renderHbs(
               tplPath("macros/position-info.hbs"),
               { positions },
            )
            const { ensureSiegeCSS } = await import("../../macros/helpers.mjs")
            ensureSiegeCSS()
            class PositionInfoApp extends foundry.applications.api
               .ApplicationV2 {
               static DEFAULT_OPTIONS = {
                  window: { title, frame: true, positioned: true },
                  position: { width: 440, height: "auto" },
                  classes: ["siege-v2-app", "siege-mount-app"],
               }
               _renderHTML() {
                  return content
               }
               _replaceHTML(result, c) {
                  c.innerHTML = result
               }
               _onRender() {
                  
                  this.element
                     .querySelectorAll("details")
                     .forEach((d) =>
                        d.addEventListener("toggle", () => {
                           const ch = d.querySelector(":scope > summary .chevron")
                           if (ch)
                              ch.className = `fa-solid fa-chevron-${d.open ? "down" : "right"} chevron`
                        }),
                     )
               }
            }
            new PositionInfoApp().render(true)
         })
      })

      if (game.user.isGM) {
         root.querySelector(".vh-ranks-enabled")?.addEventListener("change", async (e) => {
            const on = e.target.checked
            await this.vehicle.setFlag(MODULE_ID, "ranksEnabled", on)
            if (on && (this.vehicle.getFlag(MODULE_ID, "ranks") || []).length === 0)
               await this._saveRanks(foundry.utils.deepClone(DEFAULT_RANKS))
            this.render({ force: false })
         })
         root.querySelector(".vh-add-rank")?.addEventListener("click", async () => {
            const ranks = foundry.utils.deepClone(
               this.vehicle.getFlag(MODULE_ID, "ranks") || [],
            )
            ranks.push({ name: tKey("VehicleHUD.NewRank"), abbr: "", icon: "assets/1.png" })
            await this._saveRanks(ranks)
            this.render({ force: false })
         })
         root.querySelectorAll(".vh-rank-row").forEach((row) => {
            const index = Number(row.dataset.index)
            const commit = async (patch) => {
               const ranks = foundry.utils.deepClone(
                  this.vehicle.getFlag(MODULE_ID, "ranks") || [],
               )
               if (!ranks[index]) return
               Object.assign(ranks[index], patch)
               await this._saveRanks(ranks)
            }
            row
               .querySelector(".vh-rank-name")
               ?.addEventListener("change", (e) => commit({ name: e.target.value }))
            row
               .querySelector(".vh-rank-abbr")
               ?.addEventListener("change", (e) => commit({ abbr: e.target.value }))
            row.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
               const ranks = foundry.utils.deepClone(
                  this.vehicle.getFlag(MODULE_ID, "ranks") || [],
               )
               ranks.splice(index, 1)
               await this._saveRanks(ranks)
               this.render({ force: false })
            })
            row.querySelector('[data-action="icon"]')?.addEventListener("click", () => {
               const FP =
                  foundry.applications?.apps?.FilePicker?.implementation ||
                  globalThis.FilePicker
               const ranks = this.vehicle.getFlag(MODULE_ID, "ranks") || []
               const fp = new FP({
                  type: "image",
                  current: rankIconPath(ranks[index]?.icon),
                  callback: async (path) => {
                     await commit({ icon: path })
                     this.render({ force: false })
                  },
               })
               fp.render(true)
            })
         })
      }

const frame = this.element
      if (frame) {
         frame.querySelector(".crew-bookmarks")?.remove()
         const wrap = document.createElement("div")
         wrap.className = "crew-bookmarks"
         wrap.innerHTML = `
            <button class="crew-bookmark" data-tab="crew" data-tooltip="${tKey("CrewHUD.TabCrew")}"><i class="fa-solid fa-users"></i></button>
            <button class="crew-bookmark crew-bookmark-active" data-tab="vehicle" data-tooltip="${tKey("CrewHUD.TabVehicle")}"><i class="fa-solid fa-gears"></i></button>`
         frame.appendChild(wrap)
         wrap.querySelector('[data-tab="crew"]')?.addEventListener("click", async () => {
            const { CrewHUD } = await import("../crew-hud.mjs")
            this.close()
            CrewHUD.open(this.vehicle)
         })
      }
   }}

export const vehicleHudRenderListenerMethods = Object.fromEntries(
   Object.getOwnPropertyNames(VehicleHUDRenderListenerMixin.prototype)
      .filter((name) => name !== "constructor")
      .map((name) => [name, VehicleHUDRenderListenerMixin.prototype[name]]),
)
