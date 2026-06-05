import { MODULE_ID } from "../constants.mjs"
import { ENTERABLE_POSITIONS } from "../constants.mjs"
import {
   isSiege,
   isEnterableVehicle,
   renderHbs,
   tplPath,
   tKey,
   buildStrikeRules,
   getAllActors,
   getCrewActors,
   findLeaderEffect,
} from "../utils.mjs"
import { SiegePortableManager } from "./portable.mjs"
import { SiegeSocketManager } from "./sockets.mjs"

const SPEED_RELEVANT_ITEMS = ["effect", "condition", "equipment", "armor"]
const LEADER_SPEED_SELECTOR = "land-speed"

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
      const tokenActor = canvas?.tokens?.placeables?.find(
         (t) => t.actor?.id === siegeId && isSiege(t.actor),
      )?.actor
      return tokenActor || game.actors.get(siegeId)
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
         await SiegeSocketManager.modifySiegeItem(
            crewman.uuid,
            "delete",
            [positionEffect.id],
            { siegeDropCascade: true },
         )
         return true
      }
      const ids = crewman.items
         .filter((i) => i.getFlag(MODULE_ID, "siegeId") === siege.id)
         .map((i) => i.id)
      if (ids.length === 0) return false
      await SiegeSocketManager.modifySiegeItem(crewman.uuid, "delete", ids, {
         siegeDropCascade: true,
      })
      await SiegePortableManager.syncPortableState(siege)
      await this.updateSiegeSpeed(siege)
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
      const crew = (app.document.getFlag(MODULE_ID, "crew") || []).map((p) => ({
         ...p,
         isManaged: managedTitles.includes(p.title),
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
      const leaderEffect = findLeaderEffect(siege)

      let newSpeed = null
      if (isPortable) {
         if (this._isLifted(siege))
            newSpeed = this._computeLiftedSpeed(siege, leaderEffect)
      } else {
         newSpeed = this._computeMountedSpeed(siege, leaderEffect)
      }

      
      
      const currentSpeed = Number(siege.system.details?.speed) || 0
      if (newSpeed !== null && currentSpeed !== newSpeed)
         await siege.update({ "system.details.speed": newSpeed })

      
      
      
      
      
      const leaderNatural = leaderEffect?.parent
         ? this._naturalLandSpeed(leaderEffect.parent, leaderEffect)
         : 0
      if (newSpeed !== null)
         await this._applyLeaderClamp(leaderEffect, newSpeed, leaderNatural)
   }

   static _isLifted(siege) {
      return siege.itemTypes.effect.some(
         (e) =>
            e.name === tKey("Markers.Lifted") &&
            e.getFlag(MODULE_ID, "isPortableMarker"),
      )
   }

   
   
   
   
   
   static _readLandSpeed(actor) {
      const s = actor?.system ?? {}
      const sp = s.attributes?.speed
      if (sp) {
         if (typeof sp.total === "number") return sp.total
         if (typeof sp.value === "number") return sp.value
         if (typeof sp.value === "string") {
            const n = parseInt(sp.value, 10)
            if (!Number.isNaN(n)) return n
         }
      }
      const land = s.movement?.speeds?.land
      if (land) {
         if (typeof land.total === "number") return land.total
         if (typeof land.value === "number") return land.value
      }
      if (typeof s.details?.speed === "number") return s.details.speed
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
      const speeds = []
      for (const actor of getAllActors()) {
         const liftEff = actor.itemTypes.effect.find(
            (e) =>
               e.getFlag(MODULE_ID, "isLiftingEffect") &&
               e.getFlag(MODULE_ID, "siegeId") === siege.id,
         )
         if (!liftEff || (liftEff.system.badge?.value || 0) <= 0) continue
         speeds.push(this._naturalLandSpeed(actor, leaderEffect))
      }
      return speeds.length > 0 ? Math.min(...speeds) : null
   }

   static _computeMountedSpeed(siege, leaderEffect) {
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
            (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
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

   static async syncCrewEffects(siege) {
      if (!siege) return
      const actions = siege.items.filter((a) => a.type === "action")

      for (const actor of getCrewActors(siege)) {
         const effects = actor.itemTypes.effect.filter(
            (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
         )
         for (const effect of effects) {
            const chosenPosition = effect.getFlag(MODULE_ID, "position")
            if (!chosenPosition) continue

            const rules = []
            for (const a of actions) {
               const flag = a.getFlag(MODULE_ID, "siegeAction")
               if (!flag || !flag.isStrike) continue
               if (
                  flag.crewAccess?.length > 0 &&
                  !flag.crewAccess.includes(chosenPosition)
               )
                  continue
               rules.push(
                  ...buildStrikeRules(
                     siege,
                     { ...flag, strikeLabel: a.name },
                     actor,
                  ),
               )
            }
            await effect.update({ "system.rules": rules })
         }
      }
   }
}
