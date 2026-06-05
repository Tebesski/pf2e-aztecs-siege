import { MODULE_ID, DEFAULT_AMMO_IMG } from "../constants.mjs"
import { slugify, tKey, getAllActors } from "../utils.mjs"
import { SiegeSFXManager } from "./sfx.mjs"
import { AmmunitionManager } from "./ammunition.mjs"

const GROUND_STASH_IMG =
   "systems/pf2e/icons/equipment/adventuring-gear/alchemists-lab.webp"

export class SiegeSocketManager {
   static initHooks() {
      const registerSocket = () => {
         if (globalThis.siegeSocket) return
         globalThis.siegeSocket = socketlib.registerModule(MODULE_ID)

         globalThis.siegeSocket.register("playSFX", async (payload) => {
            const data =
               typeof payload === "string" ? { path: payload } : payload || {}
            const path = data.path || data.src
            if (!path) return
            if (globalThis.document?.hidden) return
            foundry.audio.AudioHelper.play(
               { src: path, volume: data.volume ?? 0.8 },
               false,
            )
         })

         globalThis.siegeSocket.register("playActorSFX", async (actorUuid, key, userId = null) => {
            const actor =
               (await fromUuid(actorUuid).catch(() => null)) ||
               game.actors.get(actorUuid)
            if (actor) await SiegeSFXManager._playLocal(actor, key, userId)
         })

         globalThis.siegeSocket.register("resolvePath", async (path) => {
            return await SiegeSFXManager.resolvePath(path)
         })

         globalThis.siegeSocket.register("resolvePathChoices", async (path) => {
            return await SiegeSFXManager.resolvePathChoices(path)
         })

         globalThis.siegeSocket.register(
            "updateSiegeSpeed",
            async (siegeUuid) => {
               const siege = await fromUuid(siegeUuid)
               if (!siege) return
               const { SiegeCrewManager } = await import("./crew.mjs")
               await SiegeCrewManager.updateSiegeSpeed(siege)
            },
         )

         globalThis.siegeSocket.register(
            "syncPortableState",
            async (siegeUuid, deletedItemId = null, forceDrop = false) => {
               const siege = await fromUuid(siegeUuid)
               if (!siege) return
               const { SiegePortableManager } = await import("./portable.mjs")
               await SiegePortableManager.syncPortableState(
                  siege,
                  deletedItemId,
                  forceDrop,
               )
            },
         )

         globalThis.siegeSocket.register(
            "executeSiegeLoad",
            this._executeSiegeLoad.bind(this),
         )

         globalThis.siegeSocket.register(
            "moveSiegeAndCrew",
            (siegeId, dx, dy, sourceTokenId) =>
               this._doMoveSiegeAndCrew(siegeId, dx, dy, sourceTokenId),
         )

         globalThis.siegeSocket.register(
            "modifySiegeItem",
            async (siegeUuid, action, data, context = {}) => {
               const siege = await fromUuid(siegeUuid)
               if (siege) await this._applyItemMod(siege, action, data, context)
            },
         )

         globalThis.siegeSocket.register(
            "haulRelease",
            async (haulerId, targetActorId, elevationData = null) => {
               const { HaulManager } = await import("./haul.mjs")
               await HaulManager.releaseTarget(
                  haulerId,
                  targetActorId,
                  elevationData,
               )
            },
         )

         globalThis.siegeSocket.register(
            "moveVehicleByRole",
            async (vehicleId, change, sourceUserId) => {
               await this._doMoveVehicleByRole(vehicleId, change, sourceUserId)
            },
         )

         globalThis.siegeSocket.register(
            "enterVehicle",
            async (crewmanUuid, vehicleId, position) => {
               const { VehicleEntryManager } = await import("./entry.mjs")
               const crewman = await fromUuid(crewmanUuid)
               const vehicle = game.actors.get(vehicleId)
               await VehicleEntryManager._doEnter(crewman, vehicle, position)
            },
         )

         globalThis.siegeSocket.register(
            "exitVehicle",
            async (crewmanUuid, vehicleId, applyElevation = false) => {
               const { VehicleEntryManager } = await import("./entry.mjs")
               const crewman = await fromUuid(crewmanUuid)
               const vehicle = vehicleId ? game.actors.get(vehicleId) : null
               await VehicleEntryManager._doExit(crewman, vehicle, applyElevation)
            },
         )

         globalThis.siegeSocket.register(
            "setCrewPortrait",
            async (actorUuid, data, scope = "all", vehicleId = null) => {
               const actor = await fromUuid(actorUuid)
               if (!actor) return
               if (scope === "vehicle" && vehicleId)
                  await actor.setFlag(
                     MODULE_ID,
                     `crewPortraitByVehicle.${vehicleId}`,
                     data,
                  )
               else await actor.setFlag(MODULE_ID, "crewPortrait", data)
            },
         )

         globalThis.siegeSocket.register("refreshCrewHud", async (vehicleId) => {
            const { CrewHUD } = await import("../ui/crew-hud.mjs")
            CrewHUD.refreshFor(vehicleId)
         })

         globalThis.siegeSocket.register(
            "refreshVehicleHud",
            async (vehicleId) => {
               const { VehicleHUD } = await import("../ui/vehicle-hud.mjs")
               VehicleHUD.refreshFor(vehicleId)
            },
         )

         globalThis.siegeSocket.register("toggleLaunched", async (vehicleId, actorUuid = null) => {
            const { VehicleLaunchManager } = await import("./launch.mjs")
            await VehicleLaunchManager._doToggle(vehicleId, actorUuid)
         })

         globalThis.siegeSocket.register(
            "reloadStrike",
            async (vehicleId, actionId, amount = null, options = {}) => {
               const { AmmunitionManager } = await import("./ammunition.mjs")
               const vehicle = game.actors.get(vehicleId)
               const action = vehicle?.items.get(actionId)
               if (vehicle && action) {
                  const result = await AmmunitionManager.reloadStrike(
                     vehicle,
                     action,
                     amount,
                     options,
                  )
                  globalThis.siegeSocket.executeForEveryone(
                     "refreshVehicleHud",
                     vehicleId,
                  )
                  return result
               }
               return false
            },
         )

         globalThis.siegeSocket.register(
            "deductAmmo",
            async (vehicleUuid, actionId, flag = {}) => {
               const siege = await fromUuid(vehicleUuid)
               const action = siege?.items.get(actionId)
               if (!siege || !action) return false
               const { deductAmmo } = await import("../macros/action-roll.mjs")
               const result = await deductAmmo(siege, flag, action, {
                  forceLocal: true,
               })
               if (result && siege.id) {
                  globalThis.siegeSocket.executeForEveryone(
                     "refreshVehicleHud",
                     siege.id,
                  )
               }
               return result
            },
         )

         globalThis.siegeSocket.register(
            "unloadStrike",
            async (vehicleId, actionId, amount = null) => {
               const { AmmunitionManager } = await import("./ammunition.mjs")
               const vehicle = game.actors.get(vehicleId)
               const action = vehicle?.items.get(actionId)
               if (vehicle && action) {
                  const result = await AmmunitionManager.unloadStrike(vehicle, action, amount)
                  globalThis.siegeSocket.executeForEveryone(
                     "refreshVehicleHud",
                     vehicleId,
                  )
                  return result
               }
               return false
            },
         )

         globalThis.siegeSocket.register(
            "switchLoadedAmmo",
            async (vehicleId, actionId, choice = null) => {
               const { AmmunitionManager } = await import("./ammunition.mjs")
               const vehicle = game.actors.get(vehicleId)
               const action = vehicle?.items.get(actionId)
               if (vehicle && action) {
                  const result = await AmmunitionManager.switchActiveLoadedAmmo(
                     vehicle,
                     action,
                     choice,
                  )
                  globalThis.siegeSocket.executeForEveryone(
                     "refreshVehicleHud",
                     vehicleId,
                  )
                  return result
               }
               return false
            },
         )

         globalThis.siegeSocket.register(
            "takeStashItem",
            async (vehicleId, itemId, userId) => {
               const { SiegeSocketManager } = await import("./sockets.mjs")
               await SiegeSocketManager._doTakeStashItem(
                  vehicleId,
                  itemId,
                  userId,
               )
               globalThis.siegeSocket.executeForEveryone(
                  "refreshVehicleHud",
                  vehicleId,
               )
            },
         )

         globalThis.siegeSocket.register(
            "putStashItem",
            async (vehicleId, itemUuid, userId) => {
               const { SiegeSocketManager } = await import("./sockets.mjs")
               await SiegeSocketManager._doPutStashItem(
                  vehicleId,
                  itemUuid,
                  userId,
               )
               globalThis.siegeSocket.executeForEveryone(
                  "refreshVehicleHud",
                  vehicleId,
               )
            },
         )

         globalThis.siegeSocket.register(
            "moveStashItem",
            async (vehicleId, itemId, targetUuid, userId) => {
               const { SiegeSocketManager } = await import("./sockets.mjs")
               await SiegeSocketManager._doMoveStashItem(
                  vehicleId,
                  itemId,
                  targetUuid,
                  userId,
               )
               globalThis.siegeSocket.executeForEveryone(
                  "refreshVehicleHud",
                  vehicleId,
               )
            },
         )

         globalThis.siegeSocket.register(
            "dropStashItemToGround",
            async (vehicleId, itemId, sceneId, x, y, userId) => {
               const { SiegeSocketManager } = await import("./sockets.mjs")
               await SiegeSocketManager._doDropStashItemToGround(
                  vehicleId,
                  itemId,
                  sceneId,
                  x,
                  y,
                  userId,
               )
               globalThis.siegeSocket.executeForEveryone(
                  "refreshVehicleHud",
                  vehicleId,
               )
            },
         )

         globalThis.siegeSocket.register("notifyUser", async (payload) => {
            const { tKey } = await import("../utils.mjs")
            const msg = payload.key ? tKey(payload.key, payload.data || {}) : payload.text
            if (payload.type === "error") ui.notifications.error(msg)
            else if (payload.type === "warn") ui.notifications.warn(msg)
            else ui.notifications.info(msg)
         })

         globalThis.siegeSocket.register(
            "changePosition",
            async (crewmanUuid, vehicleId, newPosition) => {
               const { VehicleEntryManager } = await import("./entry.mjs")
               await VehicleEntryManager._doChangePosition(
                  crewmanUuid,
                  vehicleId,
                  newPosition,
               )
            },
         )

         
         
         
         globalThis.siegeSocket.register(
            "promptSwapConsent",
            async (payload) => {
               const { tKey } = await import("../utils.mjs")
               const ok = await foundry.applications.api.DialogV2.confirm({
                  classes: ["siege-v2-dialog"],
                  window: { title: tKey("CrewHUD.SwitchRequestTitle") },
                  content: `<p>${tKey("CrewHUD.SwitchRequest", {
                     mover: payload.moverName,
                     you: payload.displacedName,
                     pos: payload.newPos,
                     cur: payload.oldPos,
                  })}</p>`,
               }).catch(() => false)
               return !!ok
            },
         )
      }

      Hooks.once("socketlib.ready", registerSocket)
      Hooks.once("ready", () => {
         if (game.modules.get("socketlib")?.active) registerSocket()
      })
   }

   static async _applyItemMod(siege, action, data, context = {}) {
      if (action === "create")
         await siege.createEmbeddedDocuments("Item", data, context)
      else if (action === "update")
         await siege.updateEmbeddedDocuments("Item", data, context)
      else if (action === "delete")
         await siege.deleteEmbeddedDocuments("Item", data, context)
   }

   static _isSyntheticTokenActor(actor) {
      return !!(
         actor?.isToken ||
         actor?.token?.parent?.documentName === "Scene" ||
         (globalThis.Scene && actor?.token?.parent instanceof Scene)
      )
   }

   
   
   static async takeStashItem(vehicleId, itemId, userId) {
      if (game.user.isGM) {
         await this._doTakeStashItem(vehicleId, itemId, userId)
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
               vehicleId,
            )
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "takeStashItem",
            vehicleId,
            itemId,
            userId,
         )
      }
   }

   
   static async putStashItem(vehicleId, itemUuid, userId) {
      if (game.user.isGM) {
         await this._doPutStashItem(vehicleId, itemUuid, userId)
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
               vehicleId,
            )
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "putStashItem",
            vehicleId,
            itemUuid,
            userId,
         )
      }
   }

   
   
   static async moveStashItem(vehicleId, itemId, targetUuid, userId) {
      if (game.user.isGM) {
         await this._doMoveStashItem(vehicleId, itemId, targetUuid, userId)
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
               vehicleId,
            )
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "moveStashItem",
            vehicleId,
            itemId,
            targetUuid,
            userId,
         )
      }
   }

   static async dropStashItemToGround(vehicleId, itemId, sceneId, x, y, userId) {
      if (game.user.isGM) {
         await this._doDropStashItemToGround(vehicleId, itemId, sceneId, x, y, userId)
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeForEveryone(
               "refreshVehicleHud",
               vehicleId,
            )
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "dropStashItemToGround",
            vehicleId,
            itemId,
            sceneId,
            x,
            y,
            userId,
         )
      }
   }

   
   
   static async _doMoveStashItem(vehicleId, itemId, targetUuid, userId) {
      const { tKey } = await import("../utils.mjs")
      const vehicle = game.actors.get(vehicleId)
      const item = vehicle?.items.get(itemId)
      if (!vehicle || !item) return
      const target = await fromUuid(targetUuid)
      const targetActor =
         target?.documentName === "Actor" ? target : target?.actor
      if (!targetActor) return
      if (targetActor.id === vehicle.id) return
      const data = item.toObject()
      delete data._id
      delete data.ownership
      await targetActor.createEmbeddedDocuments("Item", [data])
      await vehicle.deleteEmbeddedDocuments("Item", [item.id])
      if (globalThis.siegeSocket)
         globalThis.siegeSocket.executeAsUser("notifyUser", userId, {
            type: "info",
            key: "Stash.MovedTo",
            data: { name: item.name, target: targetActor.name },
         })
   }

   static async _doDropStashItemToGround(
      vehicleId,
      itemId,
      sceneId,
      x,
      y,
      userId,
   ) {
      const vehicle = game.actors.get(vehicleId)
      const item = vehicle?.items.get(itemId)
      const scene = game.scenes.get(sceneId) || canvas?.scene
      if (!vehicle || !item || !scene) return

      const data = item.toObject()
      delete data._id
      delete data.ownership

      const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3
      const actor = await Actor.create({
         name: item.name,
         type: "loot",
         img: GROUND_STASH_IMG,
         ownership: { default: owner },
         flags: { [MODULE_ID]: { isGroundStash: true } },
      })
      if (!actor) return

      await actor.createEmbeddedDocuments("Item", [data])
      await scene.createEmbeddedDocuments("Token", [
         {
            name: actor.name,
            actorId: actor.id,
            actorLink: true,
            x,
            y,
            width: 1,
            height: 1,
            img: GROUND_STASH_IMG,
            texture: { src: GROUND_STASH_IMG },
            disposition: CONST.TOKEN_DISPOSITIONS?.NEUTRAL ?? 0,
            flags: { [MODULE_ID]: { isGroundStash: true } },
         },
      ])
      await vehicle.deleteEmbeddedDocuments("Item", [item.id])
      if (globalThis.siegeSocket)
         globalThis.siegeSocket.executeAsUser("notifyUser", userId, {
            type: "info",
            key: "Stash.DroppedOnGround",
            data: { name: item.name },
         })
   }

   static async _doTakeStashItem(vehicleId, itemId, userId) {
      const { tKey } = await import("../utils.mjs")
      const vehicle = game.actors.get(vehicleId)
      const item = vehicle?.items.get(itemId)
      const user = game.users.get(userId)
      const target = user?.character
      if (!vehicle || !item) return
      if (!target) {
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeAsUser("notifyUser", userId, {
               type: "warn",
               key: "Stash.NoCharacter",
            })
         return
      }
      const data = item.toObject()
      delete data._id
      delete data.ownership
      await target.createEmbeddedDocuments("Item", [data])
      await vehicle.deleteEmbeddedDocuments("Item", [item.id])
      if (globalThis.siegeSocket)
         globalThis.siegeSocket.executeAsUser("notifyUser", userId, {
            type: "info",
            key: "Stash.Took",
            data: { name: item.name },
         })
   }

   
   
   
   static async _doPutStashItem(vehicleId, itemUuid, userId) {
      const vehicle = game.actors.get(vehicleId)
      if (!vehicle) return
      const item = await fromUuid(itemUuid)
      if (!item) return
      if (item.parent?.id === vehicle.id) return
      const data = item.toObject()
      delete data._id
      delete data.ownership
      await vehicle.createEmbeddedDocuments("Item", [data])
      
      const sourceActor = item.parent
      if (sourceActor && sourceActor.documentName === "Actor" && sourceActor.id !== vehicle.id) {
         try {
            await sourceActor.deleteEmbeddedDocuments("Item", [item.id])
         } catch (e) {
            
         }
      }
      if (globalThis.siegeSocket)
         globalThis.siegeSocket.executeAsUser("notifyUser", userId, {
            type: "info",
            key: "Stash.Stored",
            data: { name: item.name },
         })
   }

   
   static async reloadStrike(vehicle, action, amount = null, options = {}) {
      const { AmmunitionManager } = await import("./ammunition.mjs")
      if (game.user.isGM || (vehicle?.isOwner && !globalThis.siegeSocket)) {
         return AmmunitionManager.reloadStrike(vehicle, action, amount, options)
      } else if (globalThis.siegeSocket) {
         options = { ...options, sourceUserId: game.user.id }
         const flag = action?.getFlag?.(MODULE_ID, "siegeAction") || {}
         const supportedSlugs = AmmunitionManager.ammoSlugsForAction(flag)
         let slug = slugify(options.slug || options.ammoSlug || "")
         if (!slug || !supportedSlugs.includes(slug)) {
            slug =
               supportedSlugs.length === 1
                  ? supportedSlugs[0]
                  : await AmmunitionManager.promptAmmoTypeChoice(
                       vehicle,
                       action,
                       "reload",
                       options,
                    )
         }
         if (slug) options.slug = slug
         const loadedPieces = AmmunitionManager.getLoadedAmmoPieces(
            vehicle,
            action,
         )
         const loadedSlugs = AmmunitionManager._loadedAmmoTypeSlugs(
            vehicle,
            action,
            loadedPieces,
         )
         const targetCandidates = AmmunitionManager._candidateSlugs(vehicle, slug)
         if (
            slug &&
            loadedSlugs.size > 0 &&
            ![...loadedSlugs].every((loadedSlug) =>
               targetCandidates.has(loadedSlug),
            )
         ) {
            const confirmed =
               await AmmunitionManager._confirmReplaceLoadedAmmoType(
                  vehicle,
                  action,
                  slug,
               )
            if (!confirmed) return false
            options.replaceLoadedAmmoType = true
         }
         const sources = await AmmunitionManager.collectLoadSources(
            vehicle,
            options.crewmanUuid || options.crewman,
            { includeAdjacent: options.useAdjacent !== false },
         )
         if (
            slug &&
            !options.replaceLoadedAmmoType &&
            (AmmunitionManager.ammoUsesCharges(vehicle, slug) ||
               AmmunitionManager.ammoUsesChargesFromSources(
                  vehicle,
                  slug,
                  sources,
               )) &&
            AmmunitionManager.getLoadedAmmoPieces(vehicle, action).length > 0
         ) {
            const choice = await AmmunitionManager.promptChargedReloadChoice(
               vehicle,
               action,
               slug,
               {
                  ...options,
                  available: AmmunitionManager.getAvailableLoadUnitsFromSources(
                     vehicle,
                     slug,
                     sources,
                  ),
               },
            )
            if (!choice) return false
            Object.assign(options, choice)
         }
         return globalThis.siegeSocket.executeAsGM(
            "reloadStrike",
            vehicle.id,
            action.id,
            amount,
            options,
         )
      }
   }

   
   static async unloadStrike(vehicle, action, amount = null) {
      if (vehicle?.isOwner) {
         const { AmmunitionManager } = await import("./ammunition.mjs")
         return AmmunitionManager.unloadStrike(vehicle, action, amount)
      } else if (globalThis.siegeSocket) {
         return globalThis.siegeSocket.executeAsGM(
            "unloadStrike",
            vehicle.id,
            action.id,
            amount,
         )
      }
   }

   static async switchLoadedAmmo(vehicle, action) {
      const { AmmunitionManager } = await import("./ammunition.mjs")
      if (vehicle?.isOwner) {
         return AmmunitionManager.switchActiveLoadedAmmo(vehicle, action)
      } else if (globalThis.siegeSocket) {
         const choice = await AmmunitionManager.promptSwitchLoadedAmmoChoice(
            vehicle,
            action,
         )
         if (!choice) return false
         return globalThis.siegeSocket.executeAsGM(
            "switchLoadedAmmo",
            vehicle.id,
            action.id,
            choice,
         )
      }
      return false
   }

   static async deductAmmo(vehicle, action, flag = {}) {
      if (game.user.isGM || !globalThis.siegeSocket) {
         const { deductAmmo } = await import("../macros/action-roll.mjs")
         return deductAmmo(vehicle, flag, action, { forceLocal: true })
      }
      const result = await globalThis.siegeSocket.executeAsGM(
         "deductAmmo",
         vehicle.uuid,
         action.id,
         flag,
      )
      if (!result) ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
      return result
   }

   static async modifySiegeItem(siegeUuid, action, data, context = {}) {
      const siege = await fromUuid(siegeUuid)
      const shouldRouteToGM =
         !game.user.isGM &&
         globalThis.siegeSocket &&
         (!siege?.isOwner || this._isSyntheticTokenActor(siege))
      if (siege && !shouldRouteToGM) {
         await this._applyItemMod(siege, action, data, context)
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "modifySiegeItem",
            siegeUuid,
            action,
            data,
            context,
         )
      } else {
         ui.notifications.error("Socketlib module required.")
      }
   }

   static async executeLoad(
      siegeUuid,
      choice,
      extracts,
      crewmanUuid,
      ammoProcured,
      flagTakeAdjacent,
   ) {
      if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "executeSiegeLoad",
            siegeUuid,
            choice,
            extracts,
            crewmanUuid,
            ammoProcured,
            flagTakeAdjacent,
         )
      } else if (game.user.isGM) {
         await this._executeSiegeLoad(
            siegeUuid,
            choice,
            extracts,
            crewmanUuid,
            ammoProcured,
            flagTakeAdjacent,
         )
      } else {
         ui.notifications.error(
            "Socketlib module must be installed and active for players to load weapons.",
         )
      }
   }

   static async _executeSiegeLoad(
      siegeUuid,
      choice,
      extracts,
      crewmanUuid,
      ammoProcured,
      flagTakeAdjacent,
   ) {
      const siege = await fromUuid(siegeUuid)
      const crewman = await fromUuid(crewmanUuid)
      if (!siege || !crewman) return

      const rawAmmoTypes = siege.getFlag(MODULE_ID, "ammunitionTypes") || {}
      const safeAmmoTypes = Object.values(rawAmmoTypes)
      const tInfo = safeAmmoTypes.find(
         (t) => t.slug === choice.slug || slugify(t.name) === choice.slug,
      )

      for (const ex of extracts) {
         const item = await fromUuid(ex.uuid)
         if (!item) continue
         const newQty = item.system.quantity - ex.take
         if (newQty <= 0) await item.delete()
         else await item.update({ "system.quantity": newQty })
      }

      const existingAmmo = siege.items.find(
         (i) =>
            AmmunitionManager.isAmmoItem(i) &&
            (i.system?.slug || slugify(i.name)) === choice.slug,
      )

      if (existingAmmo) {
         await existingAmmo.update({
            "system.quantity": existingAmmo.system.quantity + ammoProcured,
         })
      } else {
         const sourceItem = await this._findOrFetchSource(choice.slug)
         if (sourceItem) {
            const itemData = sourceItem.toObject()
            itemData.system.quantity = ammoProcured
            delete itemData._id
            delete itemData.ownership
            await siege.createEmbeddedDocuments("Item", [itemData])
         } else {
            await siege.createEmbeddedDocuments("Item", [
               {
                  name: tInfo.name,
                  type: "consumable",
                  img: DEFAULT_AMMO_IMG,
                  system: {
                     category: "ammo",
                     slug: choice.slug,
                     quantity: ammoProcured,
                  },
               },
            ])
         }
      }

      ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman }),
         content: tKey("Chat.AmmoLoaded", {
            crewman: crewman.name,
            qty: ammoProcured,
            name: tInfo.name,
            siege: siege.name,
         }),
      })
      SiegeSFXManager.play(siege, `load-${choice.slug}`)
   }

   static async _findOrFetchSource(slug) {
      const direct = game.items.find(
         (i) =>
            AmmunitionManager.isAmmoItem(i) &&
            (i.system?.slug || slugify(i.name)) === slug,
      )
      if (direct) return direct

      for (const pack of game.packs.filter((p) => p.documentName === "Item")) {
         const index =
            pack.index.length > 0
               ? pack.index
               : await pack.getIndex({ fields: ["system.slug"] })
         const entry = index.find(
            (e) => (e.system?.slug || slugify(e.name)) === slug,
         )
         if (entry) return pack.getDocument(entry._id)
      }
      return null
   }

   
   
   
   static async _doMoveVehicleByRole(vehicleRef, change, sourceUserId) {
      
      let vehicleToken = null
      let vehicle = null
      const fromToken = await fromUuid(vehicleRef).catch(() => null)
      if (fromToken?.documentName === "Token") {
         vehicleToken = fromToken
         vehicle = fromToken.actor
      } else {
         vehicle = game.actors.get(vehicleRef)
         vehicleToken = vehicle?.getActiveTokens()[0]?.document ?? null
      }
      if (!vehicle || !vehicleToken) return
      const user = game.users.get(sourceUserId)
      if (!user) return

      const { VehicleEntryManager } = await import("./entry.mjs")
      const { VehicleLaunchManager } = await import("./launch.mjs")
      const { VehicleLoadManager } = await import("./vehicle-load.mjs")
      const wantsMove = change.x !== undefined || change.y !== undefined
      const wantsRotate = change.rotation !== undefined
      const canDrive = VehicleEntryManager.canUserDrive(user, vehicle, true)
      const canRotate = VehicleEntryManager.canUserRotate(user, vehicle, true)
      
      
      const needsIgnition = vehicle.getFlag(MODULE_ID, "needsIgnition") === true
      const launched = VehicleLaunchManager.isLaunched(vehicle)
      console.log(
         "%c[Drive GM]",
         "color:#a0a",
         `move ${vehicle.name} by ${user.name} (id=${sourceUserId}): change=${JSON.stringify(change)} wantsMove=${wantsMove} wantsRotate=${wantsRotate} canDrive=${canDrive} canRotate=${canRotate} launched=${launched}`,
      )

      if (needsIgnition && !launched) {
         
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeAsUser(
               "notifyUser",
               sourceUserId,
               { type: "warn", key: "CrewHUD.NotLaunched" },
            )
         return
      }
      await VehicleLoadManager.sync(vehicle)
      if (wantsMove && VehicleLoadManager.isAtMax(vehicle)) {
         if (globalThis.siegeSocket)
            globalThis.siegeSocket.executeAsUser(
               "notifyUser",
               sourceUserId,
               { type: "warn", key: "VehicleLoad.MaxBulkMoveBlocked" },
            )
         return
      }
      if (wantsMove && !canDrive) return
      if (wantsRotate && !wantsMove && !canRotate) return

      const dx = change.x !== undefined ? change.x - vehicleToken.x : 0
      const dy = change.y !== undefined ? change.y - vehicleToken.y : 0

      const update = { _id: vehicleToken.id }
      if (change.x !== undefined) update.x = change.x
      if (change.y !== undefined) update.y = change.y
      if (change.rotation !== undefined) update.rotation = change.rotation

      const scene = vehicleToken.parent ?? canvas.scene
      await scene.updateEmbeddedDocuments("Token", [update], {
         siegeSyncMovement: true,
      })

      if (wantsMove && (dx !== 0 || dy !== 0)) {
         const vehBaseId = vehicle.id
         const crewUpdates = []
         for (const t of scene.tokens) {
            const a = t.actor
            if (!a) continue
            const linked = a.itemTypes.effect.some(
               (e) =>
                  e.getFlag(MODULE_ID, "siegeId") === vehBaseId &&
                  (e.getFlag(MODULE_ID, "isEntered") ||
                     e.getFlag(MODULE_ID, "position")),
            )
            if (!linked || t.id === vehicleToken.id) continue
            crewUpdates.push({ _id: t.id, x: t.x + dx, y: t.y + dy })
         }
         if (crewUpdates.length > 0)
            await scene.updateEmbeddedDocuments("Token", crewUpdates, {
               siegeSyncMovement: true,
            })
      }
   }

   static async _doMoveSiegeAndCrew(siegeId, dx, dy, sourceTokenId = null) {
      const siege = game.actors.get(siegeId)
      if (!siege) return
      const updates = []
      const siegeTokens = siege.getActiveTokens().map((t) => t.document)
      if (siegeTokens.length > 0 && siegeTokens[0].id !== sourceTokenId) {
         updates.push({
            _id: siegeTokens[0].id,
            x: siegeTokens[0].x + dx,
            y: siegeTokens[0].y + dy,
         })
      }
      for (const actor of getAllActors()) {
         if (!actor) continue
         const isLifting = actor.itemTypes.effect.some(
            (e) =>
               e.getFlag(MODULE_ID, "isLiftingEffect") &&
               e.getFlag(MODULE_ID, "siegeId") === siegeId &&
               e.system.badge?.value > 0,
         )
         if (!isLifting) continue
         const tokens = actor.getActiveTokens().map((t) => t.document)
         for (const t of tokens) {
            if (t.id !== sourceTokenId)
               updates.push({ _id: t.id, x: t.x + dx, y: t.y + dy })
         }
      }
      if (updates.length > 0 && canvas.scene) {
         await canvas.scene.updateEmbeddedDocuments("Token", updates, {
            siegeSyncMovement: true,
         })
      }
   }

   static async moveSiegeAndCrew(siegeId, dx, dy, sourceTokenId = null) {
      if (game.user.isGM) {
         await this._doMoveSiegeAndCrew(siegeId, dx, dy, sourceTokenId)
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "moveSiegeAndCrew",
            siegeId,
            dx,
            dy,
            sourceTokenId,
         )
      }
   }

   
   
   static async requestSwapConsent(displaced, mover, vehicle, newPos, oldPos) {
      const payload = {
         moverName: mover.name,
         displacedName: displaced.name,
         newPos,
         oldPos,
      }
      
      const owner = game.users.find(
         (u) =>
            u.active &&
            !u.isGM &&
            displaced.testUserPermission(u, "OWNER"),
      )
      if (owner && owner.id !== game.user.id && globalThis.siegeSocket) {
         try {
            return await globalThis.siegeSocket.executeAsUser(
               "promptSwapConsent",
               owner.id,
               payload,
            )
         } catch (e) {
            return false
         }
      }
      
      const { tKey } = await import("../utils.mjs")
      return await foundry.applications.api.DialogV2.confirm({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("CrewHUD.SwitchRequestTitle") },
         content: `<p>${tKey("CrewHUD.SwitchRequest", {
            mover: payload.moverName,
            you: payload.displacedName,
            pos: newPos,
            cur: oldPos,
         })}</p>`,
      }).catch(() => false)
   }

   
   static async moveVehicleByRole(vehicleId, change) {
      if (game.user.isGM) {
         await this._doMoveVehicleByRole(vehicleId, change, game.user.id)
      } else if (globalThis.siegeSocket) {
         await globalThis.siegeSocket.executeAsGM(
            "moveVehicleByRole",
            vehicleId,
            change,
            game.user.id,
         )
      }
   }
}
