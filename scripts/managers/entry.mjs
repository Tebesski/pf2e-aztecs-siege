import { MODULE_ID, DEFAULT_PERSON_IMG } from "../constants.mjs"
import {
   isSiege,
   isEnterableVehicle,
   validImg,
   countOccupants,
   buildMountedSiegeRules,
   tKey,
   getAllActors,
} from "../utils.mjs"
import { SiegeSFXManager } from "./sfx.mjs"

export class VehicleEntryManager {
   static initHooks() {
      Hooks.on("deleteItem", (item, options, userId) =>
         this._onDeleteItem(item, options, userId),
      )
      Hooks.on("createItem", (item) => this._onCrewSelectionItemChange(item))
      Hooks.on("updateItem", (item) => this._onCrewSelectionItemChange(item))
      Hooks.on("deleteItem", (item) => this._onCrewSelectionItemChange(item))
      Hooks.on("updateActor", (actor, changes) =>
         this._onCrewHpChange(actor, changes),
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

static _userOwnsActor(user, actor) {
      if (!user || !actor) return false
      if (actor.testUserPermission?.(user, "OWNER")) return true
      const own = actor.ownership || {}
      const lvl = own[user.id] ?? own.default ?? 0
      return lvl >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
   }

   static _positionEffectFor(actor, vehicle) {
      if (!actor || !vehicle) return null
      return actor.itemTypes.effect.find(
         (e) =>
            this._effectMatchesVehicle(e, vehicle) &&
            e.getFlag(MODULE_ID, "position"),
      )
   }

   static _effectMatchesVehicle(effect, vehicle) {
      if (!effect || !vehicle) return false
      const siegeId = effect.getFlag(MODULE_ID, "siegeId")
      const siegeUuid = effect.getFlag(MODULE_ID, "siegeUuid")
      const ids = new Set(
         [
            vehicle.id,
            vehicle.token?.actorId,
            vehicle.token?.baseActor?.id,
            vehicle.prototypeToken?.actorId,
         ].filter(Boolean),
      )
      return ids.has(siegeId) || (!!siegeUuid && siegeUuid === vehicle.uuid)
   }

   static _crewVehicleEffect(actor) {
      if (!actor || actor.type === "vehicle") return null
      return actor.itemTypes.effect.find(
         (effect) =>
            effect.getFlag(MODULE_ID, "siegeId") &&
            effect.getFlag(MODULE_ID, "position"),
      )
   }

   static vehicleForCrewman(actor) {
      const effect = this._crewVehicleEffect(actor)
      return this._resolveActor(effect?.getFlag(MODULE_ID, "siegeId"))
   }

   static isCrewOfVehicle(actor, vehicle) {
      return !!this._positionEffectFor(actor, vehicle)
   }

   static vehicleCrewActors(vehicle) {
      const seen = new Map()
      if (!vehicle) return []
      for (const actor of getAllActors()) {
         if (!actor || seen.has(actor.uuid || actor.id)) continue
         if (this.isCrewOfVehicle(actor, vehicle))
            seen.set(actor.uuid || actor.id, actor)
      }
      return [...seen.values()]
   }

   static userOwnedCrewActors(vehicle, user = game.user) {
      return this.vehicleCrewActors(vehicle).filter(
         (actor) => user?.isGM || this._userOwnsActor(user, actor),
      )
   }

   static ownedTokenActorsOnActiveScene(user = game.user) {
      if (!user || user.isGM) return []
      const sceneId = canvas?.scene?.id || user.viewedScene
      if (!sceneId) return []
      const scene = game.scenes.get(sceneId)
      const tokenDocs =
         canvas?.scene?.id === sceneId
            ? (canvas?.tokens?.placeables || []).map((token) => token.document)
            : Array.from(scene?.tokens || [])
      const actors = new Map()
      for (const tokenDoc of tokenDocs) {
         const actor =
            tokenDoc?.actor ||
            tokenDoc?.object?.actor ||
            (tokenDoc?.actorId ? game.actors.get(tokenDoc.actorId) : null)
         if (!actor || actor.type === "vehicle") continue
         if (!this._userOwnsActor(user, actor)) continue
         actors.set(actor.uuid || actor.id, actor)
      }
      return [...actors.values()]
   }

   static singleOwnedSceneActor(user = game.user) {
      const actors = this.ownedTokenActorsOnActiveScene(user)
      return actors.length === 1 ? actors[0] : null
   }

   static _selectedCrewMap(user = game.user) {
      return foundry.utils.deepClone(
         user?.getFlag?.(MODULE_ID, "selectedCrewByVehicle") || {},
      )
   }

   static _preferredFallbackCrew(vehicle, ownedCrew, user = game.user) {
      const target = Array.from(user?.targets ?? [])[0]?.actor
      if (
         target &&
         ownedCrew.some((actor) => actor.uuid === target.uuid || actor.id === target.id)
      )
         return target

      const sceneActor = this.singleOwnedSceneActor(user)
      if (
         sceneActor &&
         ownedCrew.some(
            (actor) => actor.uuid === sceneActor.uuid || actor.id === sceneActor.id,
         )
      )
         return sceneActor

      const controlled = canvas?.tokens?.controlled
         ?.map((token) => token.actor)
         .find((actor) =>
            ownedCrew.some((crew) => crew.uuid === actor?.uuid || crew.id === actor?.id),
         )
      if (controlled) return controlled

      if (
         user?.character &&
         ownedCrew.some(
            (actor) =>
               actor.uuid === user.character.uuid || actor.id === user.character.id,
         )
      )
         return user.character

      return ownedCrew[0] || null
   }

   static targetedCrewman(user = game.user) {
      if (!user) return null
      for (const target of user.targets ?? []) {
         const actor = target?.actor
         if (!actor || actor.type === "vehicle") continue
         if (!user.isGM && !this._userOwnsActor(user, actor)) continue
         if (this._crewVehicleEffect(actor)) return actor
      }
      return null
   }

   static targetedOwnedActor(user = game.user) {
      if (!user) return null
      for (const target of user.targets ?? []) {
         const actor = target?.actor
         if (!actor || actor.type === "vehicle") continue
         if (user.isGM || this._userOwnsActor(user, actor)) return actor
      }
      return null
   }

   static targetedCrewVehicle(user = game.user) {
      return this.vehicleForCrewman(this.targetedCrewman(user))
   }

   static targetedCrewmanForVehicle(vehicle, user = game.user) {
      if (!vehicle || !user) return null
      const target = this.targetedCrewman(user)
      if (!target) return null
      return this.isCrewOfVehicle(target, vehicle) ? target : null
   }

   static selectedCrewmanForVehicle(vehicle, user = game.user) {
      if (!vehicle || !user) return null
      const ownedCrew = this.userOwnedCrewActors(vehicle, user)
      const selectedMap = this._selectedCrewMap(user)
      const selectedUuid = selectedMap[vehicle.id]
      const selected = ownedCrew.find(
         (actor) => actor.uuid === selectedUuid || actor.id === selectedUuid,
      )
      if (selected) return selected

      const fallback = this._preferredFallbackCrew(vehicle, ownedCrew, user)
      if (user.id === game.user?.id) this._storeSelectedCrew(vehicle, fallback)
      return fallback
   }

   static async setSelectedCrewForVehicle(vehicle, actorOrUuid) {
      if (!vehicle || !game.user) return null
      const uuid =
         typeof actorOrUuid === "string" ? actorOrUuid : actorOrUuid?.uuid
      const ownedCrew = this.userOwnedCrewActors(vehicle, game.user)
      const selected = ownedCrew.find(
         (actor) => actor.uuid === uuid || actor.id === uuid,
      )
      await this._storeSelectedCrew(vehicle, selected, true)
      return selected || null
   }

   static ensureSelectedCrewForVehicle(vehicle, user = game.user) {
      return this.selectedCrewmanForVehicle(vehicle, user)
   }

   static activeCrewmanForVehicle(vehicle, user = game.user) {
      const sceneActor = this.singleOwnedSceneActor(user)
      return (
         this.targetedOwnedActor(user) ||
         (sceneActor && this.isCrewOfVehicle(sceneActor, vehicle)
            ? sceneActor
            : null) ||
         this.selectedCrewmanForVehicle(vehicle, user)
      )
   }

   static _storeSelectedCrew(vehicle, actor, awaitWrite = false) {
      if (!vehicle || !game.user) return awaitWrite ? Promise.resolve() : undefined
      const selectedMap = this._selectedCrewMap(game.user)
      const nextUuid = actor?.uuid || null
      if (nextUuid) selectedMap[vehicle.id] = nextUuid
      else delete selectedMap[vehicle.id]
      const current = game.user.getFlag(MODULE_ID, "selectedCrewByVehicle") || {}
      if (current[vehicle.id] === selectedMap[vehicle.id]) {
         return awaitWrite ? Promise.resolve() : undefined
      }
      const write = game.user.setFlag(
         MODULE_ID,
         "selectedCrewByVehicle",
         selectedMap,
      )
      if (awaitWrite) return write
      Promise.resolve(write).catch(() => {})
      return undefined
   }

   static _onCrewSelectionItemChange(item) {
      if (!(item?.parent instanceof Actor)) return
      if (!item.getFlag?.(MODULE_ID, "position")) return
      const vehicleId = item.getFlag(MODULE_ID, "siegeId")
      if (!vehicleId) return
      const vehicle = this._resolveActor(vehicleId)
      if (!vehicle) return
      this.ensureSelectedCrewForVehicle(vehicle)
      import("../ui/vehicle-hud.mjs").then((m) =>
         m.VehicleHUD.refreshFor(vehicle.id),
      )
      import("../ui/actions-hotkey-panel.mjs").then((m) =>
         m.ActionsHotkeyPanel.refreshFor(vehicle.id),
      )
   }

   static _onCrewHpChange(actor, changes) {
      if (!(actor instanceof Actor)) return
      const data = changes || {}
      const hpPaths = [
         "system.attributes.hp.value",
         "system.attributes.hp.max",
         "system.attributes.hp.temp",
      ]
      const changed = hpPaths.some(
         (path) =>
            foundry.utils.hasProperty(data, path) ||
            Object.prototype.hasOwnProperty.call(data, path),
      )
      if (!changed) return
      const effect = this._crewVehicleEffect(actor)
      const vehicle = this._resolveActor(effect?.getFlag(MODULE_ID, "siegeId"))
      if (!vehicle) return
      import("../ui/crew-hud.mjs").then((m) => m.CrewHUD.refreshFor(vehicle.id))
   }

   static userVehicleRole(user, vehicle) {
      if (!user || !vehicle) return null
      const roleEffectFor = (actor) => {
         const eff = this._positionEffectFor(actor, vehicle)
         return eff?.getFlag(MODULE_ID, "position") || null
      }
      for (const actor of game.actors) {
         const owns = this._userOwnsActor(user, actor)
         const role = owns ? roleEffectFor(actor) : null
         if (owns && (role === "Driver" || role === "Operator"))
            return role
      }
      for (const t of canvas?.tokens?.placeables ?? []) {
         const actor = t.actor
         if (!actor) continue
         const owns = this._userOwnsActor(user, actor)
         const role = owns ? roleEffectFor(actor) : null
         if (owns && (role === "Driver" || role === "Operator"))
            return role
      }
      return null
   }

static _vehFlag(vehicle, key) {
      if (!vehicle) return undefined
      let v = vehicle.getFlag?.(MODULE_ID, key)
      if (v === undefined || v === null) {
         const base =
            vehicle.token?.baseActor ||
            (vehicle.id ? game.actors.get(vehicle.id) : null)
         v = base?.getFlag?.(MODULE_ID, key)
      }
      return v
   }

   static canUserDrive(user, vehicle) {
      const drivable = !!this._vehFlag(vehicle, "drivable")
      if (!drivable) return false
      return this.userVehicleRole(user, vehicle) === "Driver"
   }

static canUserRotate(user, vehicle) {
      const drivable = !!this._vehFlag(vehicle, "drivable")
      const rotatable = !!this._vehFlag(vehicle, "rotatable")
      const role = this.userVehicleRole(user, vehicle)
      if (drivable && role === "Driver") return true
      if (rotatable && (role === "Driver" || role === "Operator")) return true
      return false
   }

   static _moveAction(vehicle) {
      return vehicle?.items?.find(
         (i) =>
            i.type === "action" &&
            i.name === tKey("ActionTemplates.Move.Name"),
      )
   }

   static _mountedMovePositionsFor(user, vehicle) {
      const positions = []
      for (const actor of getAllActors()) {
         if (!this._userOwnsActor(user, actor)) continue
         const effect = this._positionEffectFor(actor, vehicle)
         const position = effect?.getFlag(MODULE_ID, "position")
         if (position) positions.push(position)
      }
      return positions
   }

   static canUserMoveMountedSiege(user, vehicle) {
      if (!user || !vehicle || this.isEnterable(vehicle) || !isSiege(vehicle))
         return false
      const moveAction = this._moveAction(vehicle)
      if (!moveAction) return false
      const positions = this._mountedMovePositionsFor(user, vehicle)
      if (positions.length === 0) return false
      const allowed =
         moveAction.getFlag(MODULE_ID, "siegeAction")?.crewAccess || []
      return allowed.length === 0 || positions.some((p) => allowed.includes(p))
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
         "system.rules": buildMountedSiegeRules(vehicle, newPosition, crewman),
         [`flags.${MODULE_ID}.position`]: newPosition,
      })
      const { SiegeCrewManager } = await import("./crew.mjs")
      await SiegeCrewManager.syncCrewPositionExtras(crewman, vehicle, newPosition)
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

   static _buildStrikeRules(vehicle, position, actor = null) {
      
      if (!isSiege(vehicle)) return []
      return buildMountedSiegeRules(vehicle, position, actor)
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
      if (this._userOwnsActor(game.user, crewman))
         await this.setSelectedCrewForVehicle(vehicle, crewman)
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
            rules: this._buildStrikeRules(vehicle, position, crewman),
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
      const { SiegeCrewManager } = await import("./crew.mjs")
      await SiegeCrewManager.syncCrewPositionExtras(crewman, vehicle, position)

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
         this._detargetEnteredToken(token)
      }

      SiegeSFXManager.play(vehicle, "enter")
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

   static _detargetEnteredToken(token) {
      if (!token?.document?.uuid) return
      try {
         token.setTarget?.(false, { user: game.user, releaseOthers: false })
      } catch {
      }
      try {
         globalThis.siegeSocket?.executeForEveryone(
            "detargetToken",
            token.document.uuid,
         )
      } catch {
      }
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
      const resolvedVehicle =
         vehicle || this._resolveActor(effect.getFlag(MODULE_ID, "siegeId"))
      if (resolvedVehicle) this.ensureSelectedCrewForVehicle(resolvedVehicle)
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

const { SiegeCrewManager } = await import("./crew.mjs")
      await SiegeCrewManager.removeCrewPositionExtras(
         crewman,
         resolvedVehicle || effect.getFlag(MODULE_ID, "siegeId"),
      )

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
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
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
         } catch {
         }
         for (const effect of matches) {
            if (!effect || seen.has(effect)) continue
            seen.add(effect)
            effects.push(effect)
         }
      }
      if (effects.length === 0) return
      try {
         Promise.resolve(manager.endEffects?.({ effects })).catch(() => {})
      } catch {
      }
      if (manager.endEffects) return

      for (const effect of effects) {
         try {
            effect.end?.()
         } catch {
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
