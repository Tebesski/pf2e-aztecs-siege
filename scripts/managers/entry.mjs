import { MODULE_ID, DEFAULT_PERSON_IMG } from "../constants.mjs"
import {
   isSiege,
   isEnterableVehicle,
   validImg,
   countOccupants,
   buildStrikeRules,
   tKey,
} from "../utils.mjs"
import { SiegeSFXManager } from "./sfx.mjs"

export class VehicleEntryManager {
   static initHooks() {
      Hooks.on("deleteItem", (item, options, userId) =>
         this._onDeleteItem(item, options, userId),
      )

      
      
      
      Hooks.on("preCreateChatMessage", (message, data) => {
         const speaker = message.speaker
         if (!speaker?.actor) return
         const actor = game.actors.get(speaker.actor)
         if (!actor) return
         const eff = this.enteredEffect(actor)
         if (!eff) return
         const vehicleId = eff.getFlag(MODULE_ID, "siegeId")
         const vehicle = game.actors.get(vehicleId)
         const vehicleToken = vehicle?.getActiveTokens?.()[0]
         if (!vehicleToken) return
         message.updateSource({
            "speaker.token": vehicleToken.document.id,
            "speaker.scene": vehicleToken.scene?.id ?? speaker.scene,
         })
      })
   }

   static isEnterable(actor) {
      return (
         actor?.type === "vehicle" && !!actor.getFlag(MODULE_ID, "enterable")
      )
   }

   
   
   static enteredEffect(actor) {
      return actor?.itemTypes?.effect?.find((e) =>
         e.getFlag(MODULE_ID, "isEntered"),
      )
   }

   static isEntered(actor) {
      return !!this.enteredEffect(actor)
   }

   
   
   
   
   static userVehicleRole(user, vehicle, debug = false) {
      if (!user || !vehicle) return null
      
      
      const ownsActor = (actor) => {
         if (!actor) return false
         if (actor.testUserPermission?.(user, "OWNER")) return true
         const own = actor.ownership || {}
         const lvl = own[user.id] ?? own.default ?? 0
         return lvl >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
      }
      const roleEffectFor = (actor) => {
         const eff = actor?.itemTypes?.effect?.find(
            (e) =>
               e.getFlag(MODULE_ID, "siegeId") === vehicle.id &&
               e.getFlag(MODULE_ID, "position"),
         )
         return eff?.getFlag(MODULE_ID, "position") || null
      }
      const candidates = []
      for (const actor of game.actors) {
         const owns = ownsActor(actor)
         const role = owns ? roleEffectFor(actor) : null
         if (owns) candidates.push({ name: actor.name, src: "world", role })
         if (owns && (role === "Driver" || role === "Operator")) {
            if (debug)
               console.log(
                  "%c[Role]",
                  "color:#08a",
                  `${user.name} -> ${role} via world actor ${actor.name}`,
               )
            return role
         }
      }
      for (const t of canvas?.tokens?.placeables ?? []) {
         const actor = t.actor
         if (!actor) continue
         const owns = ownsActor(actor)
         const role = owns ? roleEffectFor(actor) : null
         if (owns) candidates.push({ name: actor.name, src: "token", role })
         if (owns && (role === "Driver" || role === "Operator")) {
            if (debug)
               console.log(
                  "%c[Role]",
                  "color:#08a",
                  `${user.name} -> ${role} via token actor ${actor.name}`,
               )
            return role
         }
      }
      if (debug)
         console.log(
            "%c[Role]",
            "color:#08a",
            `${user.name} has NO Driver/Operator role for ${vehicle.name}. Owned actors checked:`,
            candidates,
         )
      return null
   }

   
   
   
   static _vehFlag(vehicle, key, debug = false) {
      if (!vehicle) return undefined
      let v = vehicle.getFlag?.(MODULE_ID, key)
      const direct = v
      let baseV
      if (v === undefined || v === null) {
         const base =
            vehicle.token?.baseActor ||
            (vehicle.id ? game.actors.get(vehicle.id) : null)
         baseV = base?.getFlag?.(MODULE_ID, key)
         v = baseV
      }
      if (debug)
         console.log(
            "%c[Role]",
            "color:#08a",
            `_vehFlag ${key}: direct=${direct} base=${baseV} -> ${v} (actor id=${vehicle.id}, isToken=${!!vehicle.isToken}, hasGetFlag=${typeof vehicle.getFlag})`,
         )
      return v
   }

   static canUserDrive(user, vehicle, debug = false) {
      const drivable = !!this._vehFlag(vehicle, "drivable", debug)
      if (!drivable) {
         if (debug)
            console.log(
               "%c[Role]",
               "color:#08a",
               `${vehicle?.name} is not drivable`,
            )
         return false
      }
      return this.userVehicleRole(user, vehicle, debug) === "Driver"
   }

   
   
   static canUserRotate(user, vehicle, debug = false) {
      const drivable = !!this._vehFlag(vehicle, "drivable", debug)
      const rotatable = !!this._vehFlag(vehicle, "rotatable", debug)
      const role = this.userVehicleRole(user, vehicle, debug)
      if (drivable && role === "Driver") return true
      if (rotatable && (role === "Driver" || role === "Operator")) return true
      if (debug)
         console.log(
            "%c[Role]",
            "color:#08a",
            `${vehicle?.name} rotate denied: role=${role} drivable=${drivable} rotatable=${rotatable}`,
         )
      return false
   }

   
   
   static async changePosition(crewman, vehicle, newPosition) {
      if (!crewman || !vehicle || !newPosition) return
      if (game.user.isGM) {
         await this._doChangePosition(crewman.uuid, vehicle.id, newPosition)
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "changePosition",
            crewman.uuid,
            vehicle.id,
            newPosition,
         )
      }
   }

   static async _doChangePosition(crewmanUuid, vehicleId, newPosition) {
      const crewman = await fromUuid(crewmanUuid)
      const vehicle = game.actors.get(vehicleId)
      if (!crewman || !vehicle) return
      const eff = crewman.itemTypes.effect.find(
         (e) =>
            e.getFlag(MODULE_ID, "siegeId") === vehicleId &&
            e.getFlag(MODULE_ID, "position"),
      )
      if (!eff) return
      const positions = vehicle.getFlag(MODULE_ID, "crew") || []
      const posData = positions.find((p) => p.title === newPosition)
      await eff.update({
         img: posData?.icon || eff.img,
         [`flags.${MODULE_ID}.position`]: newPosition,
      })
      const { SiegeCrewManager } = await import("./crew.mjs")
      await SiegeCrewManager.updateSiegeSpeed(vehicle)
   }

   
   static capacity(vehicle) {
      const positions = vehicle.getFlag(MODULE_ID, "crew") || []
      return positions.reduce((sum, p) => sum + (parseInt(p.max) || 1), 0)
   }

   
   static occupantsInside(vehicle) {
      const actors = new Set([
         ...game.actors,
         ...(canvas?.tokens?.placeables?.map((t) => t.actor).filter(Boolean) ||
            []),
      ])
      let count = 0
      for (const a of actors) {
         if (
            a.itemTypes.effect.some(
               (e) =>
                  e.getFlag(MODULE_ID, "isEntered") &&
                  e.getFlag(MODULE_ID, "siegeId") === vehicle.id,
            )
         )
            count++
      }
      return count
   }

   static _buildStrikeRules(vehicle, position) {
      
      if (!isSiege(vehicle)) return []
      const rules = []
      for (const a of vehicle.items.filter((i) => i.type === "action")) {
         const flag = a.getFlag(MODULE_ID, "siegeAction")
         if (!flag || !flag.isStrike) continue
         if (flag.crewAccess?.length > 0 && !flag.crewAccess.includes(position))
            continue
         rules.push(...buildStrikeRules(vehicle, { ...flag, strikeLabel: a.name }))
      }
      return rules
   }

   
   
   
   static async enterVehicle(crewman, vehicle, position) {
      if (!crewman || !vehicle) return
      
      if (crewman.id === vehicle.id || crewman.uuid === vehicle.uuid) {
         ui.notifications.warn(tKey("Enter.Notifications.CannotEnterSelf"))
         return
      }
      if (crewman.type === "vehicle") {
         ui.notifications.warn(tKey("Enter.Notifications.VehicleCannotCrew"))
         return
      }
      if (!this.isEnterable(vehicle)) {
         ui.notifications.warn(tKey("Enter.Notifications.NotEnterable"))
         return
      }

      
      if (!game.user.isGM && vehicle.getFlag(MODULE_ID, "mountableByPCs") === false) {
         ui.notifications.warn(tKey("Notifications.CannotBeMountedByPCs"))
         return
      }

      
      const otherVehicleEff = crewman.itemTypes.effect.find(
         (e) =>
            e.getFlag(MODULE_ID, "isEntered") &&
            e.getFlag(MODULE_ID, "siegeId") &&
            e.getFlag(MODULE_ID, "siegeId") !== vehicle.id,
      )
      if (otherVehicleEff) {
         console.debug(
            `[siege] enter blocked: ${crewman.name} already in another vehicle (${otherVehicleEff.getFlag(MODULE_ID, "siegeId")})`,
         )
         ui.notifications.warn(tKey("Enter.Notifications.AlreadyInVehicle"))
         return
      }

      
      if (
         crewman.itemTypes.effect.some(
            (e) =>
               e.getFlag(MODULE_ID, "isEntered") &&
               e.getFlag(MODULE_ID, "siegeId") === vehicle.id,
         )
      ) {
         ui.notifications.info(tKey("Enter.Notifications.AlreadyInside"))
         return
      }

      
      if (this.occupantsInside(vehicle) >= this.capacity(vehicle)) {
         ui.notifications.warn(tKey("Enter.Notifications.Full"))
         return
      }

      
      const positions = vehicle.getFlag(MODULE_ID, "crew") || []
      const posData = positions.find((p) => p.title === position)
      const maxAllowed = parseInt(posData?.max) || 1
      if (countOccupants(vehicle, position) >= maxAllowed) {
         ui.notifications.warn(
            tKey("Mount.PositionFull", { position, max: maxAllowed }),
         )
         return
      }

      if (game.user.isGM) {
         await this._doEnter(crewman, vehicle, position)
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "enterVehicle",
            crewman.uuid,
            vehicle.id,
            position,
         )
      } else {
         await this._doEnter(crewman, vehicle, position)
      }
   }

   
   
   
   static async _doEnter(crewman, vehicle, position) {
      if (!crewman || !vehicle) return
      const positions = vehicle.getFlag(MODULE_ID, "crew") || []
      const posData = positions.find((p) => p.title === position)
      const sceneId = canvas.scene?.id
      const token = crewman.getActiveTokens().find((t) => t.scene?.id === sceneId)

      
      let stash = null
      if (token) {
         const d = token.document
         stash = {
            tokenId: d.id,
            x: d.x,
            y: d.y,
            width: d.width,
            height: d.height,
            alpha: d.alpha,
            elevation: d.elevation,
         }
      }

      const effect = {
         name: tKey("Markers.MountedOnPosition", {
            siege: vehicle.name,
            position,
         }),
         type: "effect",
         img: validImg(posData?.icon, DEFAULT_PERSON_IMG),
         system: {
            level: { value: 1 },
            description: {
               value: tKey("Enter.MarkerDescription", {
                  vehicle: vehicle.name,
                  position,
               }),
            },
            tokenIcon: { show: false },
            rules: this._buildStrikeRules(vehicle, position),
         },
         flags: {
            [MODULE_ID]: {
               position,
               siegeId: vehicle.id,
               siegeUuid: vehicle.uuid,
               isEntered: true,
               enteredSceneId: sceneId,
               tokenStash: stash,
               
               
               rank:
                  (crewman.getFlag(MODULE_ID, "rankByVehicle") || {})[
                     vehicle.id
                  ] || null,
            },
         },
      }
      await crewman.createEmbeddedDocuments("Item", [effect])

      
      
      
      
      
      if (token) {
         const vehicleToken = vehicle.getActiveTokens?.()[0]
         const place = vehicleToken
            ? { x: vehicleToken.document.x, y: vehicleToken.document.y }
            : { x: token.document.x, y: token.document.y }
         await token.document.update(
            {
               x: place.x,
               y: place.y,
               width: 0.2,
               height: 0.2,
               alpha: 0,
               [`flags.${MODULE_ID}.enteredHidden`]: true,
            },
            { siegeEntering: true },
         )
         this._deleteSequencerEffectsForToken(token, "enter")
         
         try {
            token.release?.()
         } catch (e) {
            
         }
      }

      SiegeSFXManager.play(vehicle, "enter")
      const { SiegeCrewManager } = await import("./crew.mjs")
      await SiegeCrewManager.updateSiegeSpeed(vehicle)
      const { VehicleLoadManager } = await import("./vehicle-load.mjs")
      await VehicleLoadManager.sync(vehicle)

      
      if (globalThis.siegeSocket)
         globalThis.siegeSocket.executeForEveryone("refreshCrewHud", vehicle.id)
      const { CrewHUD } = await import("../ui/crew-hud.mjs")
      CrewHUD.refreshFor(vehicle.id)

      ui.notifications.info(
         tKey("Enter.Notifications.Entered", {
            crewman: crewman.name,
            vehicle: vehicle.name,
         }),
      )
   }

   
   static async exitVehicle(crewman, vehicle) {
      if (!crewman) return
      const effect = crewman.itemTypes.effect.find(
         (e) =>
            e.getFlag(MODULE_ID, "isEntered") &&
            (!vehicle || e.getFlag(MODULE_ID, "siegeId") === vehicle.id),
      )
      if (!effect) return

      
      
      const { SiegeSettings } = await import("./settings.mjs")
      let applyElevation = false
      if (SiegeSettings.applyExitElevation()) {
         if (SiegeSettings.promptExitElevation()) {
            applyElevation = await foundry.applications.api.DialogV2.confirm({
               classes: ["siege-v2-dialog"],
               window: { title: tKey("Enter.ElevationPromptTitle") },
               content: `<p>${tKey("Enter.ElevationPrompt")}</p>`,
            }).catch(() => false)
         } else {
            applyElevation = true
         }
      }

      if (game.user.isGM) {
         await this._doExit(crewman, vehicle, applyElevation)
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "exitVehicle",
            crewman.uuid,
            vehicle?.id ?? null,
            applyElevation,
         )
      } else {
         await this._doExit(crewman, vehicle, applyElevation)
      }
   }

   
   
   
   
   static async _doExit(crewman, vehicle, applyElevation = false) {
      if (!crewman) return
      const effect = crewman.itemTypes.effect.find(
         (e) =>
            e.getFlag(MODULE_ID, "isEntered") &&
            (!vehicle || e.getFlag(MODULE_ID, "siegeId") === vehicle.id),
      )
      if (!effect) return

      const resolvedVehicle =
         vehicle || this._resolveActor(effect.getFlag(MODULE_ID, "siegeId"))
      const stash = effect.getFlag(MODULE_ID, "tokenStash")
      const sceneId = effect.getFlag(MODULE_ID, "enteredSceneId")
      const scene = game.scenes.get(sceneId) || canvas.scene

      
      let restore = null
      if (stash && scene) {
         const tokenDoc = scene.tokens.get(stash.tokenId)
         const vehicleToken = resolvedVehicle?.getActiveTokens?.()[0]

         const space = resolvedVehicle?.system?.details?.space || {}
         const vehicleHeight =
            Number(resolvedVehicle?.getFlag(MODULE_ID, "height")) ||
            Number(space.high) ||
            Number(space.height) ||
            Number(resolvedVehicle?.system?.attributes?.elevation) ||
            0
         const vehicleElevation = vehicleToken?.document?.elevation || 0
         const exitElevation = vehicleHeight + vehicleElevation
         console.log(
            `%c[Enter]`,
            "color:#0aa",
            `exit elevation for ${crewman.name}: height=${vehicleHeight} vehicleElev=${vehicleElevation} -> ${exitElevation}`,
            { space },
         )

         const place = this._adjacentSquare(
            vehicleToken,
            stash.width,
            stash.height,
         ) || { x: stash.x, y: stash.y }

         if (tokenDoc) {
            const data = {
               x: place.x,
               y: place.y,
               width: stash.width,
               height: stash.height,
               alpha: stash.alpha ?? 1,
               [`flags.${MODULE_ID}.enteredHidden`]: false,
            }
            
            
            
            const targetElevation = applyElevation
               ? exitElevation
               : stash.elevation ?? 0
            data.elevation = targetElevation
            restore = { tokenDoc, data, want: targetElevation }
         }
      }

      
      
      await crewman.deleteEmbeddedDocuments("Item", [effect.id], {
         siegeDropCascade: true,
      })

      if (restore?.tokenDoc) {
         await restore.tokenDoc.update(restore.data, { siegeExiting: true })
         
         const want = restore.want
         if (want !== null)
            setTimeout(() => {
               if ((restore.tokenDoc.elevation || 0) !== want)
                  restore.tokenDoc.update(
                     { elevation: want },
                     { siegeExiting: true },
                  )
            }, 200)
      }

      if (resolvedVehicle) {
         const { SiegeCrewManager } = await import("./crew.mjs")
         await SiegeCrewManager.updateSiegeSpeed(resolvedVehicle)
         const { VehicleLoadManager } = await import("./vehicle-load.mjs")
         await VehicleLoadManager.sync(resolvedVehicle)
         const { SiegeSFXManager } = await import("./sfx.mjs")
         SiegeSFXManager.play(resolvedVehicle, "exit")
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshCrewHud",
               resolvedVehicle.id,
            )
         const { CrewHUD } = await import("../ui/crew-hud.mjs")
         CrewHUD.refreshFor(resolvedVehicle.id)
      }

      ui.notifications.info(
         tKey("Enter.Notifications.Exited", {
            crewman: crewman.name,
            vehicle: resolvedVehicle?.name ?? "",
         }),
      )
   }

   
   
   static _adjacentSquare(vehicleToken, tokenWidth = 1, tokenHeight = 1) {
      if (!vehicleToken) return null
      const grid = canvas?.grid?.size || 100
      const vd = vehicleToken.document
      const vw = vd.width || 1
      const vh = vd.height || 1

      
      const candidates = []
      for (let cx = -1; cx <= vw; cx++) {
         candidates.push([cx, -1]) 
         candidates.push([cx, vh]) 
      }
      for (let cy = 0; cy < vh; cy++) {
         candidates.push([-1, cy]) 
         candidates.push([vw, cy]) 
      }

      
      for (let i = candidates.length - 1; i > 0; i--) {
         const j = Math.floor(Math.random() * (i + 1))
         ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
      }

      const occupied = (x, y) =>
         canvas.tokens.placeables.some((t) => {
            if (t.id === vehicleToken.id) return false
            const tw = (t.document.width || 1) * grid
            const th = (t.document.height || 1) * grid
            return (
               x < t.document.x + tw &&
               x + tokenWidth * grid > t.document.x &&
               y < t.document.y + th &&
               y + tokenHeight * grid > t.document.y
            )
         })

      for (const [ox, oy] of candidates) {
         const x = vd.x + ox * grid
         const y = vd.y + oy * grid
         if (!occupied(x, y)) return { x, y }
      }
      
      const [ox, oy] = candidates[0]
      return { x: vd.x + ox * grid, y: vd.y + oy * grid }
   }

   static _deleteSequencerEffectsForToken(token, reason = "enter") {
      const manager = globalThis.Sequencer?.EffectManager
      if (!manager || !token?.document) return
      const doc = token.document
      const sceneId = doc.parent?.id || canvas?.scene?.id || game.user?.viewedScene
      const queries = [
         { object: doc, sceneId },
         { source: doc, sceneId },
         { target: doc, sceneId },
         { origin: doc.uuid, sceneId },
      ].filter((query) => query.sceneId)
      const seen = new Set()
      const effects = []
      for (const query of queries) {
         let matches = []
         try {
            matches = manager.getEffects?.(query) || []
         } catch (err) {
            console.debug("[siege][sequencer] entry getEffects failed", {
               query,
               err,
            })
         }
         for (const effect of matches) {
            if (!effect || seen.has(effect)) continue
            seen.add(effect)
            effects.push(effect)
         }
      }
      console.debug(
         `[siege][sequencer] entry deleting effects token=${token.document.uuid} actor=${token.actor?.name} reason=${reason} count=${effects.length}`,
      )
      if (effects.length === 0) return
      try {
         Promise.resolve(manager.endEffects?.({ effects })).catch((err) =>
            console.debug("[siege][sequencer] entry endEffects failed", {
               token: token.document.uuid,
               reason,
               err,
            }),
         )
      } catch (err) {
         console.debug("[siege][sequencer] entry endEffects failed", {
            token: token.document.uuid,
            reason,
            err,
         })
      }
      if (manager.endEffects) return

      for (const effect of effects) {
         try {
            effect.end?.()
         } catch (err) {
            console.debug("[siege][sequencer] entry direct end failed", {
               effect,
               err,
            })
         }
      }
   }

   static _resolveActor(id) {
      if (!id) return null
      return (
         canvas?.tokens?.placeables?.find((t) => t.actor?.id === id)?.actor ||
         game.actors.get(id)
      )
   }

   
   
   static async _onDeleteItem(item, options) {
      if (!game.user.isGM) return
      if (options.siegeDropCascade || options.haulCascade) return
      if (
         item.type === "effect" &&
         item.getFlag(MODULE_ID, "isEntered") &&
         item.parent instanceof Actor
      ) {
         const stash = item.getFlag(MODULE_ID, "tokenStash")
         const sceneId = item.getFlag(MODULE_ID, "enteredSceneId")
         const scene = game.scenes.get(sceneId) || canvas.scene
         if (stash && scene) {
            const tokenDoc = scene.tokens.get(stash.tokenId)
            if (tokenDoc)
               await tokenDoc.update(
                  {
                     x: stash.x,
                     y: stash.y,
                     width: stash.width,
                     height: stash.height,
                     alpha: stash.alpha ?? 1,
                     elevation: stash.elevation ?? 0,
                     [`flags.${MODULE_ID}.enteredHidden`]: false,
                  },
                  { siegeExiting: true },
               )
         }
      }
   }
}
