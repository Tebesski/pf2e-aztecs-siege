import { MODULE_ID, DEFAULT_AMMO_IMG } from "../../constants.mjs"
import { slugify, tKey } from "../../utils.mjs"
import { SiegeSFXManager } from "../sfx.mjs"
import { AmmunitionManager } from "../ammunition.mjs"
import { staticMethods } from "./helpers.mjs"

class SocketAmmoLoadMixin {


   static async reloadStrike(vehicle, action, amount = null, options = {}) {
      const { AmmunitionManager } = await import("../ammunition.mjs")
      if (game.user.isGM || (vehicle?.isOwner && !globalThis.siegeSocket)) {
         return AmmunitionManager.reloadStrike(vehicle, action, amount, options)
      } else if (globalThis.siegeSocket) {
         options = { ...options, sourceUserId: game.user.id }
         const flag = action?.getFlag?.(MODULE_ID, "siegeAction") || {}
         const supportedSlugs = AmmunitionManager.ammoSlugsForAction(flag)
         let slug = slugify(options.slug || options.ammoSlug || "")
         if (!slug || !supportedSlugs.includes(slug)) {
            if (supportedSlugs.length === 1) slug = supportedSlugs[0]
            else {
               const choice = await AmmunitionManager.promptAmmoTypeChoice(
                  vehicle,
                  action,
                  "reload",
                  { ...options, withAmount: amount == null },
               )
               if (choice && typeof choice === "object") {
                  slug = choice.slug
                  if (amount == null) amount = choice.amount
               } else slug = choice
            }
         }
         if (!slug) return false
         options.slug = slug
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



   static async unloadStrike(vehicle, action, amount = null, options = {}) {
      const { AmmunitionManager } = await import("../ammunition.mjs")
      const localOptions = { ...options }
      if (amount == null && !localOptions.pieceIds) {
         const loadedPieces = AmmunitionManager.getLoadedAmmoPieces(vehicle, action)
         if (loadedPieces.length > 1) {
            const pieceIds = await AmmunitionManager.promptChargedUnloadChoice(
               vehicle,
               action,
               loadedPieces,
            )
            if (!pieceIds) return false
            localOptions.pieceIds = pieceIds
         }
      }
      if (game.user.isGM || (!globalThis.siegeSocket && vehicle?.isOwner)) {
         return AmmunitionManager.unloadStrike(vehicle, action, amount, localOptions)
      } else if (globalThis.siegeSocket) {
         return globalThis.siegeSocket.executeAsGM(
            "unloadStrike",
            vehicle.id,
            action.id,
            amount,
            localOptions,
         )
      }
   }



   static async switchLoadedAmmo(vehicle, action) {
      const { AmmunitionManager } = await import("../ammunition.mjs")
      if (game.user.isGM || (!globalThis.siegeSocket && vehicle?.isOwner)) {
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
         const { deductAmmo } = await import("../../macros/action-roll.mjs")
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
            tKey("Notifications.SocketlibLoadRequired"),
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
}

export const socketAmmoLoadMethods = staticMethods(SocketAmmoLoadMixin)
