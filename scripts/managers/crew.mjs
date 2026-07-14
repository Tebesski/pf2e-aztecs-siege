import { MODULE_ID } from "../constants.mjs"
import { ENTERABLE_POSITIONS } from "../constants.mjs"
import {
   isSiege,
   isEnterableVehicle,
   renderHbs,
   tplPath,
   tKey,
   buildMountedSiegeRules,
   getAllActors,
   getCrewActors,
   findLeaderEffect,
} from "../utils.mjs"
import { SiegePortableManager } from "./portable.mjs"
import { SiegeSocketManager } from "./sockets.mjs"
import { crewPositionExtraMethods } from "./crew/extras.mjs"
import { relatedSiegeActors, portableBulk } from "./portable-helpers.mjs"

const SPEED_RELEVANT_ITEMS = ["effect", "condition", "equipment", "armor"]
const LEADER_SPEED_SELECTOR = "land-speed"
const VEHICLE_SAVE_TYPES = ["fortitude", "reflex", "will"]
export class SiegeCrewManager {
   static initHooks() {
      Hooks.on("renderActorSheet", (app, html, data) =>
         this._renderCrewTab(app, html, data),
      )

      Hooks.on("updateActor", (actor) => this._checkLifterSpeedUpdate(actor))

      for (const hook of ["createItem", "deleteItem"]) {
         Hooks.on(hook, (item, options) =>
            this._onCrewItemChange(item, options),
         )
      }

      Hooks.on("updateItem", (item, _changes, options) =>
         this._onCrewItemChange(item, options),
      )
   }

   static _onCrewItemChange(item, options) {
      if (!(item.parent instanceof Actor)) return
      const relevant =
         SPEED_RELEVANT_ITEMS.includes(item.type) ||
         !!item.getFlag?.(MODULE_ID, "siegeId")
      if (relevant)
         this._checkLifterSpeedUpdate(item.parent, options?.siegeSpeedSync)
   }

   static _speedRecalc = new Map()

static _scheduleSpeedUpdate(siegeId) {
      let run = this._speedRecalc.get(siegeId)
      if (!run) {
         run = foundry.utils.debounce(() => {
            const siege = this._resolveSiege(siegeId)
            if (!siege) return
            SiegePortableManager.enqueue(siegeId, () =>
               this.updateSiegeSpeed(siege),
            )
         }, 100)
         this._speedRecalc.set(siegeId, run)
      }
      run()
   }

static _resolveSiege(siegeId) {
      const tokenActor = canvas?.tokens?.placeables?.find((t) => {
         if (!isSiege(t.actor)) return false
         return (
            t.actor.id === siegeId ||
            t.document?.actorId === siegeId ||
            t.actor?.token?.baseActor?.id === siegeId
         )
      })?.actor
      return tokenActor || game.actors.get(siegeId)
   }

   static _actorIdsFor(actor) {
      return new Set(
         [
            actor?.id,
            actor?.token?.actorId,
            actor?.token?.baseActor?.id,
            actor?.prototypeToken?.actorId,
         ].filter(Boolean),
      )
   }

   static _siegeIds(siege) {
      const ids = this._actorIdsFor(siege)
      for (const token of canvas?.tokens?.placeables ?? []) {
         const actor = token.actor
         if (!actor || !isSiege(actor)) continue
         const tokenIds = new Set([
            token.document?.actorId,
            ...this._actorIdsFor(actor),
         ].filter(Boolean))
         if ([...tokenIds].some((id) => ids.has(id))) {
            for (const id of tokenIds) ids.add(id)
         }
      }
      return ids
   }

   static _effectMatchesSiege(effect, siegeIds) {
      return siegeIds.has(effect?.getFlag?.(MODULE_ID, "siegeId"))
   }

   static _findLeaderEffect(siege) {
      const siegeIds = this._siegeIds(siege)
      for (const actor of getAllActors()) {
         const eff = actor.itemTypes.effect.find(
            (e) =>
               e.getFlag(MODULE_ID, "isCrewLeader") &&
               this._effectMatchesSiege(e, siegeIds),
         )
         if (eff) return eff
      }
      return null
   }

   static _checkLifterSpeedUpdate(actor, fromSelfSync = false) {
      if (fromSelfSync) return
      if (!(actor instanceof Actor)) return
      const siegeIds = new Set()

      for (const e of actor.itemTypes.effect) {
         const id = e.getFlag(MODULE_ID, "siegeId")
         if (id) siegeIds.add(id)
      }

      if (isSiege(actor)) siegeIds.add(actor.id)
      for (const siegeId of siegeIds) this._scheduleSpeedUpdate(siegeId)
   }

   static async dismountCrewman(crewman, siege) {
      if (!crewman || !siege) return false
      const positionEffect = crewman.items.find(
         (i) =>
            i.type === "effect" &&
            i.getFlag(MODULE_ID, "siegeId") === siege.id &&
            i.getFlag(MODULE_ID, "position"),
      )
      if (positionEffect) {
         await this.removeCrewPositionExtras(crewman, siege)
         await SiegeSocketManager.modifySiegeItem(
            crewman.uuid,
            "delete",
            [positionEffect.id],
            { siegeDropCascade: true },
         )
         await SiegePortableManager.syncPortableState(siege)
         await this.updateSiegeSpeed(siege)
         if (globalThis.siegeSocket) {
            globalThis.siegeSocket.executeForEveryone("refreshCrewHud", siege.id)
            globalThis.siegeSocket.executeForEveryone("refreshVehicleHud", siege.id)
         }
         return true
      }
      const ids = crewman.items
         .filter((i) => i.getFlag(MODULE_ID, "siegeId") === siege.id)
         .map((i) => i.id)
      if (ids.length === 0) return false
      await this.removeCrewPositionExtras(crewman, siege)
      await SiegeSocketManager.modifySiegeItem(crewman.uuid, "delete", ids, {
         siegeDropCascade: true,
      })
      await SiegePortableManager.syncPortableState(siege)
      await this.updateSiegeSpeed(siege)
      if (globalThis.siegeSocket) {
         globalThis.siegeSocket.executeForEveryone("refreshCrewHud", siege.id)
         globalThis.siegeSocket.executeForEveryone("refreshVehicleHud", siege.id)
      }
      return true
   }

   static async _renderCrewTab(app, html) {
      if (!isSiege(app.document) && !isEnterableVehicle(app.document)) return
      const crewTab = html.find('.tab.crew[data-tab="crew"]')
      if (crewTab.length === 0) return

      crewTab.empty()
      const managedTitles = [
         ENTERABLE_POSITIONS.DRIVER,
         ENTERABLE_POSITIONS.OPERATOR,
      ]
      const allowCrewTargeting =
         !!app.document.getFlag(MODULE_ID, "allowCrewTargeting")
      const crew = (app.document.getFlag(MODULE_ID, "crew") || []).map((p) => ({
         ...p,
         isManaged: managedTitles.includes(p.title),
         hasSaveSubstitution: this._hasSaveSubstitution(p),
         hasExtraSettings:
            this._hasSaveSubstitution(p) ||
            (allowCrewTargeting && p.canBeTargeted === false) ||
            this._hasPositionExtras(p),
      }))
      crewTab.append(await renderHbs(tplPath("sheet/crew-tab.hbs"), { crew }))
      this._bindCrewListeners(app, crewTab)
   }

   static async updateSiegeSpeed(siege) {
      if (!siege) return
      if (!game.user.isGM && globalThis.siegeSocket)
         return globalThis.siegeSocket.executeAsGM(
            "updateSiegeSpeed",
            siege.uuid,
         )

      const isPortable = (siege.system.traits?.value || []).includes("portable")
      const leaderEffect = this._findLeaderEffect(siege) ?? findLeaderEffect(siege)

      let newSpeed = null
      if (isPortable) {
         newSpeed = this._canMoveAsPortable(siege)
            ? this._computeLiftedSpeed(siege, leaderEffect) ?? 0
            : 0
      } else {
         newSpeed = this._computeMountedSpeed(siege, leaderEffect)
      }

      if (newSpeed !== null) {
         const moduleSpeedBonus =
            Number(siege.getFlag?.(MODULE_ID, "moduleBonuses")?.speed) || 0
         newSpeed = Math.max(0, newSpeed + moduleSpeedBonus)
      }

      if (newSpeed !== null) await this._setRelatedSiegeSpeed(siege, newSpeed)

const leaderNatural = leaderEffect?.parent
         ? this._naturalLandSpeed(leaderEffect.parent, leaderEffect)
         : 0
      if (newSpeed !== null)
         await this._applyLeaderClamp(leaderEffect, newSpeed, leaderNatural)
   }

   static async _setRelatedSiegeSpeed(siege, speed) {
      const seen = new Set()
      for (const actor of relatedSiegeActors(siege)) {
         if (!isSiege(actor) || !actor.uuid || seen.has(actor.uuid)) continue
         seen.add(actor.uuid)

         const loadPreviousSpeed = actor.getFlag?.(
            MODULE_ID,
            "loadPreviousSpeed",
         )
         if (loadPreviousSpeed !== undefined) {
            if (Number(loadPreviousSpeed) !== speed)
               await actor.setFlag(MODULE_ID, "loadPreviousSpeed", speed)
            continue
         }

         const currentSpeed = Number(actor.system.details?.speed) || 0
         if (currentSpeed !== speed)
            await actor.update(
               { "system.details.speed": speed },
               { siegeSpeedSync: true },
            )
      }
   }

   static _isLifted(siege) {
      return relatedSiegeActors(siege).some((actor) =>
         actor.itemTypes.effect.some(
            (e) =>
               e.name === tKey("Markers.Lifted") &&
               e.getFlag(MODULE_ID, "isPortableMarker"),
         ),
      )
   }

   static _liftedBulk(siege) {
      const siegeIds = this._siegeIds(siege)
      let bulk = 0
      for (const actor of getAllActors()) {
         const liftEffects = actor.itemTypes.effect.filter(
            (e) =>
               e.id &&
               e.getFlag(MODULE_ID, "isLiftingEffect") &&
               this._effectMatchesSiege(e, siegeIds),
         )
         for (const effect of liftEffects)
            bulk += Number(effect.system.badge?.value) || 0
      }
      return bulk
   }

   static _portableTotalBulk(siege) {
      return portableBulk(siege)
   }

   static _isFullyLifted(siege) {
      const totalBulk = this._portableTotalBulk(siege)
      return totalBulk > 0 && this._liftedBulk(siege) >= totalBulk
   }

   static _canMoveAsPortable(siege) {
      return this._isLifted(siege) || this._isFullyLifted(siege)
   }

   static _numericSpeed(value) {
      if (typeof value === "number" && Number.isFinite(value)) return value
      if (typeof value === "string") {
         const parsed = parseFloat(value)
         return Number.isFinite(parsed) ? parsed : null
      }
      if (value && typeof value === "object") {
         for (const key of ["total", "value", "base"]) {
            const result = this._numericSpeed(value[key])
            if (result !== null) return result
         }
      }
      return null
   }

static _readLandSpeed(actor) {
      const s = actor?.system ?? {}
      const sp = s.attributes?.speed
      const attrSpeed = this._numericSpeed(sp)
      if (attrSpeed !== null) return attrSpeed

      const landSpeed = this._numericSpeed(s.movement?.speeds?.land)
      if (landSpeed !== null) return landSpeed

      const detailSpeed = this._numericSpeed(s.details?.speed)
      if (detailSpeed !== null) return detailSpeed

      return 0
   }

static _ruleHasLandSpeed(rule) {
      const s = rule.selector
      return Array.isArray(s)
         ? s.includes(LEADER_SPEED_SELECTOR)
         : s === LEADER_SPEED_SELECTOR
   }

   static _clampInRules(leaderEffect) {
      return (leaderEffect.system.rules || [])
         .filter((r) => r.key === "FlatModifier" && this._ruleHasLandSpeed(r))
         .reduce((sum, r) => sum + (Number(r.value) || 0), 0)
   }

   static _naturalLandSpeed(actor, leaderEffect) {
      const current = this._readLandSpeed(actor)
      const isLeader = leaderEffect && actor.id === leaderEffect.parent?.id
      if (!isLeader) return current

const clampInRules = this._clampInRules(leaderEffect)
      const reading = current - clampInRules

const stored = leaderEffect.getFlag(MODULE_ID, "leaderNaturalSpeed")
      if (clampInRules === 0 || stored == null || reading > stored)
         return reading
      return stored
   }

   static _computeLiftedSpeed(siege, leaderEffect) {
      const siegeIds = this._siegeIds(siege)
      const speeds = []
      for (const actor of getAllActors()) {
         const liftEff = actor.itemTypes.effect.find(
            (e) =>
               e.getFlag(MODULE_ID, "isLiftingEffect") &&
               this._effectMatchesSiege(e, siegeIds),
         )
         if (!liftEff || (liftEff.system.badge?.value || 0) <= 0) continue
         speeds.push(this._naturalLandSpeed(actor, leaderEffect))
      }
      return speeds.length > 0 ? Math.min(...speeds) : null
   }

   static _computeMountedSpeed(siege, leaderEffect) {
      const siegeIds = this._siegeIds(siege)
      const moveAction = siege.items.find(
         (i) =>
            i.type === "action" &&
            i.name === tKey("ActionTemplates.Move.Name"),
      )
      if (!moveAction) return null

      const allowed = moveAction.getFlag(MODULE_ID, "siegeAction")?.crewAccess || []
      const speeds = []
      for (const actor of getAllActors()) {
         const eff = actor.itemTypes.effect.find(
            (e) => this._effectMatchesSiege(e, siegeIds),
         )
         if (!eff) continue
         const pos = eff.getFlag(MODULE_ID, "position")
         if (allowed.length > 0 && !allowed.includes(pos)) continue
         const spd = this._naturalLandSpeed(actor, leaderEffect)
         if (spd > 0) speeds.push(spd)
      }
      return speeds.length > 0 ? Math.min(...speeds) : null
   }

   static async _applyLeaderClamp(leaderEffect, newSpeed, leaderNatural) {
      if (!leaderEffect) return
      const shouldClamp = newSpeed > 0 && leaderNatural > newSpeed
      const rules = shouldClamp
         ? [
              {
                 key: "FlatModifier",
                 selector: LEADER_SPEED_SELECTOR,
                 value: newSpeed - leaderNatural,
                 type: "untyped",
                 label: tKey("Modifiers.SiegeSpeedPenalty"),
              },
           ]
         : []

const wantClamp = shouldClamp ? newSpeed - leaderNatural : 0
      const haveClamp = this._clampInRules(leaderEffect)
      const storedNatural = leaderEffect.getFlag(MODULE_ID, "leaderNaturalSpeed")
      const wantStored = shouldClamp ? leaderNatural : null

      if (wantClamp === haveClamp && storedNatural === wantStored) return

const update = { "system.rules": rules }
      if (wantStored == null) {
         if (storedNatural !== undefined)
            await leaderEffect.unsetFlag(MODULE_ID, "leaderNaturalSpeed")
      } else {
         update[`flags.${MODULE_ID}.leaderNaturalSpeed`] = wantStored
      }
      await leaderEffect.update(update, { siegeSpeedSync: true })
   }

   static _bindCrewListeners(app, crewTab) {
      const getCrew = () => app.document.getFlag(MODULE_ID, "crew") || []
      const saveCrew = (data) => app.document.setFlag(MODULE_ID, "crew", data)

      crewTab.find(".add-crew").on("click", async (e) => {
         e.preventDefault()
         const current = getCrew()
         current.push({ title: tKey("Crew.NewPosition"), min: 1, max: 1 })
         await saveCrew(current)
      })

      crewTab.find(".remove-crew").on("click", async (e) => {
         e.preventDefault()
         const confirmed = await foundry.applications.api.DialogV2.confirm({
            classes: ["siege-v2-dialog"],
            window: { title: tKey("Crew.RemoveTitle") },
            content: `<p>${tKey("Crew.RemoveConfirm")}</p>`,
            rejectClose: false,
         })
         if (!confirmed) return
         const idx = $(e.currentTarget).closest(".crew-row").data("index")
         const current = getCrew()
         current.splice(idx, 1)
         await saveCrew(current)
      })

      crewTab.find(".crew-reflex-settings").on("click", async (e) => {
         e.preventDefault()
         const idx = $(e.currentTarget).closest(".crew-row").data("index")
         const current = getCrew()
         const position = current[idx]
         if (!position) return
         const checked = this._positionSaveSubstitutions(position)
         const extraApplications = this._positionExtras(position)
         const allowCrewTargeting =
            !!app.document.getFlag(MODULE_ID, "allowCrewTargeting")
         const saveRows = VEHICLE_SAVE_TYPES.map((save) => {
            const label = this._saveLabel(save)
            return `<label class="siege-crew-reflex-check">
               <input type="checkbox" class="siege-crew-save-substitute" data-save="${save}" ${checked[save] ? "checked" : ""}>
               <span>${tKey("Crew.UseCrewSave", { save: label })}</span>
               <i class="fa-solid fa-circle-info siege-info-icon" data-tooltip="${tKey("Crew.UseCrewSaveInfo", { save: label })}" data-tooltip-direction="UP"></i>
            </label>`
         }).join("")
         const targetingRow = allowCrewTargeting
            ? `<hr class="siege-crew-extra-separator">
               <label class="siege-crew-reflex-check">
                  <input type="checkbox" id="siege-crew-can-be-targeted" ${position.canBeTargeted === false ? "" : "checked"}>
                  <span>${tKey("Crew.CanBeTargeted")}</span>
               </label>`
            : ""
         const result = await foundry.applications.api.DialogV2.wait({
            classes: ["siege-v2-dialog", "siege-crew-reflex-dialog"],
            window: { title: tKey("Crew.Extra") },
            position: { width: 560 },
            content: `<div class="siege-crew-reflex-config">
               ${saveRows}
               ${targetingRow}
               ${this._renderPositionExtras(extraApplications)}
            </div>`,
            buttons: [
               {
                  action: "save",
                  label: tKey("Buttons.Confirm"),
                  default: true,
                  callback: (_event, button, dialog) => {
                     const root = this._dialogRoot(dialog, button)
                     const saves = {}
                     root
                        .querySelectorAll(".siege-crew-save-substitute")
                        .forEach((input) => {
                           saves[input.dataset.save] = !!input.checked
                        })
                     return {
                        saves,
                        canBeTargeted: allowCrewTargeting
                           ? !!root.querySelector("#siege-crew-can-be-targeted")?.checked
                           : position.canBeTargeted !== false,
                        positionEffects: this._collectPositionExtras(root),
                     }
                  },
               },
               { action: "cancel", label: tKey("Buttons.Cancel"), callback: () => null },
            ],
            render: (_event, dialog) => {
               const root = this._dialogRoot(dialog)
               const rerenderExtras = () => {
                  const list = root.querySelector(".siege-crew-extra-list")
                  if (!list) return
                  const extras = this._collectPositionExtras(root)
                  list.innerHTML = this._renderPositionExtraRows(extras)
                  bindExtras()
                  this._refreshPositionExtraValidation(root)
               }
               const persistAndReapply = async () => {
                  const updated = getCrew()
                  const currentPosition = updated[idx]
                  if (!currentPosition) return
                  updated[idx] = {
                     ...currentPosition,
                     substituteVehicleSaves: this._collectSaveSubstitutions(root),
                     substituteVehicleReflex:
                        !!this._collectSaveSubstitutions(root)?.reflex,
                     canBeTargeted: allowCrewTargeting
                        ? !!root.querySelector("#siege-crew-can-be-targeted")?.checked
                        : currentPosition.canBeTargeted !== false,
                     positionEffects: this._collectPositionExtras(root),
                  }
                  await saveCrew(updated)
                  await this.reapplyPositionExtras(app.document, currentPosition.title)
                  ui.notifications.info(tKey("Crew.ExtraReapplied"))
               }
               const bindExtras = () => {
                  root.querySelectorAll(".siege-crew-extra-add").forEach((btn) => {
                     btn.onclick = (event) => {
                        event.preventDefault()
                        const extras = this._collectPositionExtras(root)
                        extras.push(this._defaultPositionExtra(btn.dataset.type))
                        const list = root.querySelector(".siege-crew-extra-list")
                        if (list) list.innerHTML = this._renderPositionExtraRows(extras)
                        bindExtras()
                        this._refreshPositionExtraValidation(root)
                     }
                  })
                  root.querySelectorAll(".siege-crew-extra-remove").forEach((btn) => {
                     btn.onclick = (event) => {
                        event.preventDefault()
                        const row = btn.closest(".siege-crew-extra-row")
                        row?.remove()
                        rerenderExtras()
                     }
                  })
                  root.querySelectorAll(".siege-crew-extra-reapply").forEach((btn) => {
                     btn.onclick = async (event) => {
                        event.preventDefault()
                        await persistAndReapply()
                     }
                  })
                  root.querySelectorAll(".siege-crew-extra-condition").forEach((select) => {
                     const syncConditionRow = () => {
                        const row = select.closest(".siege-crew-extra-row")
                        const icon = row?.querySelector(".siege-crew-extra-condition-icon")
                        const value = row?.querySelector(".siege-crew-extra-condition-value")
                        const hasValue = this._conditionHasValue(select.value)
                        if (icon) icon.src = this._conditionIcon(select.value)
                        if (value) value.style.display = hasValue ? "" : "none"
                     }
                     select.onchange = syncConditionRow
                     syncConditionRow()
                  })
                  root
                     .querySelectorAll(".siege-crew-extra-effect-row, .siege-crew-extra-effect-uuid")
                     .forEach((el) => {
                        el.ondragover = (event) => {
                           event.preventDefault()
                           if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
                           el.closest(".siege-crew-extra-effect-row")?.classList.add("dragover")
                        }
                        el.ondragleave = () =>
                           el.closest(".siege-crew-extra-effect-row")?.classList.remove("dragover")
                        el.ondrop = async (event) => {
                           event.preventDefault()
                           event.stopPropagation()
                           const effect = await this._effectFromDrop(event)
                           if (!effect) {
                              ui.notifications.warn(tKey("ActionTab.InvalidUUID"))
                              return
                           }
                           const row = el.closest(".siege-crew-extra-row")
                           const input = row?.querySelector(".siege-crew-extra-effect-uuid")
                           if (input) input.value = effect.uuid
                           row?.querySelector(".siege-crew-extra-effect-row")?.classList.remove("dragover")
                           await this._refreshPositionExtraValidation(root)
                        }
                     })
                  root.querySelectorAll(".siege-crew-extra-effect-uuid").forEach((input) => {
                     input.oninput = foundry.utils.debounce(
                        () => this._refreshPositionExtraValidation(root),
                        120,
                     )
                     input.onchange = () => this._refreshPositionExtraValidation(root)
                  })
                  root.querySelectorAll(".siege-crew-extra-effect-link").forEach((link) => {
                     link.onclick = async (event) => {
                        event.preventDefault()
                        const uuid = link.dataset.uuid
                        if (!uuid) return
                        const doc = await fromUuid(uuid).catch(() => null)
                        doc?.sheet?.render(true)
                     }
                  })
                  root.querySelectorAll(".siege-crew-extra-rule-json").forEach((input) => {
                     input.oninput = foundry.utils.debounce(
                        () => this._refreshPositionExtraValidation(root),
                        100,
                     )
                     input.onchange = () => {
                        this._formatPositionRuleJson(input)
                        this._refreshPositionExtraValidation(root)
                     }
                     input.onblur = () => {
                        this._formatPositionRuleJson(input)
                        this._refreshPositionExtraValidation(root)
                     }
                  })
               }
               bindExtras()
               this._refreshPositionExtraValidation(root)
            },
         }).catch(() => null)
         if (!result || typeof result !== "object" || !result.saves) return
         current[idx] = {
            ...position,
            substituteVehicleSaves: result.saves,
            substituteVehicleReflex: !!result.saves?.reflex,
            canBeTargeted: result.canBeTargeted,
            positionEffects: this._normalizePositionExtras(result.positionEffects),
         }
         await saveCrew(current)
         await this.reapplyPositionExtras(app.document, position.title)
      })

      crewTab.find(".crew-icon-img").on("click", async (e) => {
         e.preventDefault()
         const idx = $(e.currentTarget).closest(".crew-row").data("index")
         const current = getCrew()
         new foundry.applications.apps.FilePicker.implementation({
            type: "image",
            current: current[idx].icon || "icons/svg/mystery-man.svg",
            callback: async (path) => {
               current[idx].icon = path
               await saveCrew(current)
            },
         }).browse()
      })

      crewTab
         .find(".crew-title, .crew-min, .crew-max")
         .on("change", async (e) => {
            e.preventDefault()
            const row = $(e.currentTarget).closest(".crew-row")
            const idx = row.data("index")
            const current = getCrew()
            const isManaged = row.data("managed") === true

            let minVal = parseInt(row.find(".crew-min").val()) || 1
            let maxVal = parseInt(row.find(".crew-max").val()) || 1

            if (isManaged && minVal < 1) minVal = 1
            if ($(e.currentTarget).hasClass("crew-min") && minVal > maxVal)
               maxVal = minVal
            if ($(e.currentTarget).hasClass("crew-max") && maxVal < minVal)
               minVal = maxVal
            if (isManaged && minVal < 1) minVal = 1

if (!isManaged) current[idx].title = row.find(".crew-title").val()
            current[idx].min = minVal
            current[idx].max = maxVal
            await saveCrew(current)
         })
   }

   static _statModifier(stat) {
      const values = [
         stat?.mod,
         stat?.modifier,
         stat?.totalModifier,
         stat?.value,
         stat?.check?.mod,
      ]
      for (const value of values) {
         const number = Number(value)
         if (Number.isFinite(number)) return number
      }
      return Number.NEGATIVE_INFINITY
   }

   static _saveLabel(save) {
      if (save === "fortitude") return tKey("Attributes.Fortitude")
      if (save === "will") return tKey("Attributes.Will")
      return tKey("Attributes.Reflex")
   }

   static _positionSaveSubstitutions(position = {}) {
      const saves = position.substituteVehicleSaves || {}
      return {
         fortitude: !!saves.fortitude,
         reflex: saves.reflex !== undefined
            ? !!saves.reflex
            : !!position.substituteVehicleReflex,
         will: !!saves.will,
      }
   }

   static _hasSaveSubstitution(position = {}) {
      const saves = this._positionSaveSubstitutions(position)
      return VEHICLE_SAVE_TYPES.some((save) => saves[save])
   }

   static _collectSaveSubstitutions(root) {
      const saves = {}
      root
         .querySelectorAll(".siege-crew-save-substitute")
         .forEach((input) => {
            saves[input.dataset.save] = !!input.checked
         })
      return saves
   }


   static bestVehicleSaveSubstitute(siege, save = "reflex") {
      if (!siege || (!isSiege(siege) && !isEnterableVehicle(siege))) return null
      const saveKey = VEHICLE_SAVE_TYPES.includes(save) ? save : "reflex"
      const enabledPositions = new Set(
         (siege.getFlag(MODULE_ID, "crew") || [])
            .filter((position) => this._positionSaveSubstitutions(position)[saveKey])
            .map((position) => position.title)
            .filter(Boolean),
      )
      if (enabledPositions.size === 0) return null

      const candidates = []
      for (const actor of getCrewActors(siege)) {
         const effects = actor.itemTypes?.effect || []
         const positionEffect = effects.find(
            (effect) =>
               effect.getFlag(MODULE_ID, "siegeId") === siege.id &&
               enabledPositions.has(effect.getFlag(MODULE_ID, "position")),
         )
         if (!positionEffect) continue
         const stat = actor.saves?.[saveKey]
         if (!stat?.roll) continue
         candidates.push({
            actor,
            position: positionEffect.getFlag(MODULE_ID, "position"),
            save: saveKey,
            stat,
            modifier: this._statModifier(stat),
         })
      }

      candidates.sort((a, b) => {
         if (b.modifier !== a.modifier) return b.modifier - a.modifier
         return String(a.actor?.name || "").localeCompare(String(b.actor?.name || ""))
      })
      return candidates[0] || null
   }

   static bestVehicleReflexSubstitute(siege) {
      return this.bestVehicleSaveSubstitute(siege, "reflex")
   }

   static crewPositions(siege) {
      if (!siege || (!isSiege(siege) && !isEnterableVehicle(siege))) return []
      return (siege.getFlag(MODULE_ID, "crew") || [])
         .map((position) => {
            const title = String(position?.title || "").trim()
            if (!title) return null
            return {
               title,
               name: title,
               icon: position.icon || "",
               min: Number(position.min) || 1,
               max: Number(position.max) || 1,
            }
         })
         .filter(Boolean)
   }

   static crewActorsForPosition(siege, positionTitle) {
      if (!siege || !positionTitle) return []
      const wanted = String(positionTitle).trim()
      if (!wanted) return []

      return getCrewActors(siege).filter((actor) =>
         (actor.itemTypes?.effect || []).some(
            (effect) =>
               effect.getFlag(MODULE_ID, "siegeId") === siege.id &&
               effect.getFlag(MODULE_ID, "position") === wanted,
         ),
      )
   }

   static vehicleSaveDisplaySubstitute(siege, save = "reflex") {
      const substitute = this.bestVehicleSaveSubstitute(siege, save)
      if (!substitute) return null
      const value = Number(substitute.modifier)
      if (!Number.isFinite(value)) return null
      return {
         ...substitute,
         value,
      }
   }

   static vehicleReflexDisplaySubstitute(siege) {
      return this.vehicleSaveDisplaySubstitute(siege, "reflex")
   }

   static async rollVehicleSaveSubstitute(siege, save = "reflex", event = null, rollOptions = {}) {
      const saveKey = VEHICLE_SAVE_TYPES.includes(save) ? save : "reflex"
      const substitute = rollOptions.substitute || this.bestVehicleSaveSubstitute(siege, saveKey)
      if (!substitute?.stat?.roll) return false
      const hookData = {
         vehicleId: siege.id,
         vehicleUuid: siege.uuid,
         actorUuid: substitute.actor.uuid,
         actorName: substitute.actor.name,
         position: substitute.position,
         save: saveKey,
      }
      let rolling = true
      const hookId = Hooks.on("preCreateChatMessage", (message) => {
         if (!rolling) return
         const type = message.flags?.pf2e?.context?.type
         if (type && type !== "saving-throw") return
         message.updateSource({
            "speaker.alias": substitute.actor.name,
            [`flags.${MODULE_ID}.vehicleReflexSubstitute`]: hookData,
         })
      })
      try {
         const args = { ...rollOptions }
         delete args.substitute
         if (event) args.event = event
         await substitute.stat.roll(args)
      } finally {
         rolling = false
         Hooks.off("preCreateChatMessage", hookId)
      }
      return true
   }

   static async rollVehicleReflexSubstitute(siege, event = null, rollOptions = {}) {
      return this.rollVehicleSaveSubstitute(siege, "reflex", event, rollOptions)
   }

   static async syncCrewEffects(siege) {
      if (!siege) return
      for (const actor of getCrewActors(siege)) {
         const effects = actor.itemTypes.effect.filter(
            (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
         )
         for (const effect of effects) {
            const chosenPosition = effect.getFlag(MODULE_ID, "position")
            if (!chosenPosition) continue

            const rules = buildMountedSiegeRules(siege, chosenPosition, actor)
            await effect.update({ "system.rules": rules })
            await this.syncCrewPositionExtras(actor, siege, chosenPosition)
         }
      }
   }
}

Object.assign(
   SiegeCrewManager,
   crewPositionExtraMethods,
)
